import "server-only";
import { randomUUID } from "node:crypto";
import type { ClientSession, Db } from "mongodb";
import { z } from "zod";
import { consumeRateLimit, limitUserAction, requireMembership } from "./access";
import { buildPlan } from "./intent-router";
import { readSourceCheckpoint } from "./source-checkpoint";
import { database, redact, StoreError, transaction } from "./store";
import type { Identity, Intent, MemoryCheckpoint, Session, TrajectoryEvent } from "./types";

export const historyActionSchema = z.object({
  action: z.enum(["revise", "restore"]),
  target: z.object({ type: z.enum(["intent", "event", "checkpoint"]), id: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/) }).strict(),
  text: z.string().trim().max(4000).optional(),
  expectedRevision: z.number().int().nonnegative(),
  requestId: z.string().uuid(),
}).strict().superRefine((input, ctx) => {
  if (input.action === "revise" && !input.text) ctx.addIssue({ code: "custom", message: "Describe the new direction.", path: ["text"] });
  if (input.action === "restore" && input.target.type !== "checkpoint") ctx.addIssue({ code: "custom", message: "Choose a source checkpoint to restore.", path: ["target"] });
});
export type HistoryActionInput = z.infer<typeof historyActionSchema>;
type SessionDoc = Session & { _id: string; eventSequence: number };
type IntentDoc = Intent & { _id: string; requestId: string };
type HistoryResult = { ok: true; action: "revise" | "restore"; revision: number; intentId?: string; requestId: string; status: "applied" | "queued" | "failed" };
type HistoryDoc = { _id: string; sessionId: string; authorId: string; input: HistoryActionInput; result: HistoryResult; createdAt: string; error?: string };
const now = () => new Date().toISOString();
const active = (intent: Intent) => !["superseded", "duplicate"].includes(intent.status);
const cleanIntent = ({ _id, requestId, ...intent }: IntentDoc): Intent => { void _id; void requestId; return intent; };

async function eventInTx(db: Db, tx: ClientSession, sessionId: string, input: Omit<TrajectoryEvent, "id" | "sessionId" | "sequence" | "createdAt">) {
  const session = await db.collection<SessionDoc>("cv_sessions").findOneAndUpdate({ _id: sessionId }, { $inc: { eventSequence: 1, "metrics.archivedEvents": 1 }, $set: { updatedAt: now() } }, { session: tx, returnDocument: "after" });
  if (!session) throw new StoreError("Session not found", 404);
  const id = randomUUID();
  await db.collection<TrajectoryEvent & { _id: string }>("cv_events").insertOne({ ...input, title: redact(input.title), detail: redact(input.detail), _id: id, id, sessionId, sequence: session.eventSequence, createdAt: now() }, { session: tx });
}

/** A correction replaces only the selected choice. Dependent work stops for explicit review. */
export function revisionScope(intents: Intent[], targetIds: string[]): { retireIds: string[]; blockedIds: string[] } {
  const retire = new Set(targetIds);
  // Selecting either side of a resolved conflict revisits that decision, including
  // chains of replacements. Neither discarded nor currently selected alternatives
  // should silently remain an authoritative constraint on the correction.
  let related = true;
  while (related) {
    related = false;
    for (const intent of intents) {
      if (intent.decision?.relation !== "conflict" || !intent.resolution || !(retire.has(intent.id) || intent.decision.parentIntentIds.some((id) => retire.has(id)))) continue;
      for (const id of [intent.id, ...intent.decision.parentIntentIds]) {
        if (!retire.has(id)) { retire.add(id); related = true; }
      }
    }
  }
  const blocked = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const intent of intents) {
      if (retire.has(intent.id) || blocked.has(intent.id) || !active(intent) || intent.decision?.relation !== "depend") continue;
      if (intent.decision.parentIntentIds.some((id) => retire.has(id) || blocked.has(id))) { blocked.add(intent.id); changed = true; }
    }
  }
  return { retireIds: [...retire], blockedIds: [...blocked] };
}

function savedState(checkpoint: MemoryCheckpoint, intents: Intent[]): NonNullable<MemoryCheckpoint["intentState"]> {
  if (!checkpoint.intentState) throw new StoreError("This older checkpoint has no saved request decisions. Choose Change direction instead.", 409);
  const ids = new Set<string>();
  const source = new Map(intents.map((intent) => [intent.id, intent]));
  for (const row of checkpoint.intentState) {
    const intent = source.get(row.id);
    if (ids.has(row.id) || !intent || intent.sessionId !== checkpoint.sessionId || intent.revision > checkpoint.revision || !["queued", "accepted", "blocked", "fulfilled", "superseded", "duplicate"].includes(row.status)) throw new StoreError("Checkpoint request state does not match this workspace.", 409);
    if (row.decision?.parentIntentIds.some((id) => !source.has(id) || source.get(id)!.sessionId !== checkpoint.sessionId)) throw new StoreError("Checkpoint request state refers to another workspace.", 409);
    ids.add(row.id);
  }
  if (intents.some((intent) => intent.revision <= checkpoint.revision && !ids.has(intent.id))) throw new StoreError("Checkpoint request state is incomplete. Choose Change direction instead.", 409);
  return checkpoint.intentState;
}

function correction(sessionId: string, userId: string, text: string, revision: number, parentIds: string[], context: string): Intent {
  return { id: randomUUID(), sessionId, authorId: userId, text, revision, createdAt: now(), status: "accepted", decision: { relation: "extend", summary: text.slice(0, 180), reason: context, parentIntentIds: parentIds, acceptance: [text], source: "rules" } };
}

export async function requestHistoryAction(sessionId: string, user: Identity, raw: HistoryActionInput): Promise<HistoryResult> {
  const input = historyActionSchema.parse(raw);
  await requireMembership(sessionId, user);
  await consumeRateLimit("history", user.id, 20, 60);
  const key = `${sessionId}:${input.requestId}`;
  // Immutable checkpoints can be validated before the transaction; references are rechecked inside it.
  const prior = await (await database()).collection<HistoryDoc>("cv_history_actions").findOne({ _id: key });
  if (prior) {
    if (prior.authorId !== user.id || JSON.stringify(prior.input) !== JSON.stringify(input)) throw new StoreError("This request ID belongs to another history action.", 409);
    return prior.result;
  }
  await limitUserAction(user, input.action === "revise" || input.text ? "intent" : "retry", sessionId);
  const restore = input.action === "restore" ? await readSourceCheckpoint(sessionId, input.target.id) : null;
  if (input.action === "restore" && !restore) throw new StoreError("The selected source checkpoint is unavailable.", 409);
  return transaction(async (db, tx) => {
    const actions = db.collection<HistoryDoc>("cv_history_actions");
    const duplicate = await actions.findOne({ _id: key }, { session: tx });
    if (duplicate) {
      if (duplicate.authorId !== user.id || JSON.stringify(duplicate.input) !== JSON.stringify(input)) throw new StoreError("This request ID belongs to another history action.", 409);
      return duplicate.result;
    }
    if (!await db.collection("cv_memberships").findOne({ sessionId, userId: user.id }, { session: tx })) throw new StoreError("Workspace unavailable to this account.", 404);
    const sessions = db.collection<SessionDoc>("cv_sessions");
    const current = await sessions.findOne({ _id: sessionId }, { session: tx });
    if (!current) throw new StoreError("Session not found", 404);
    if (current.revision !== input.expectedRevision) throw new StoreError("The workspace changed. Review the latest history and submit your direction again.", 409);
    if (current.historyRequest) throw new StoreError("A checkpoint restore is already waiting for the worker.", 409);
    const col = db.collection<IntentDoc>("cv_intents");
    const intents = (await col.find({ sessionId }, { session: tx }).sort({ revision: 1 }).toArray()).map(cleanIntent);
    const revision = current.revision + 1;
    let result: HistoryResult;
    if (restore) {
      const state = savedState(restore.checkpoint, intents);
      if (input.text && state.filter((row) => !["superseded", "duplicate"].includes(row.status)).length >= 64) throw new StoreError("The checkpoint already has 64 active requests. Restore without a new direction first.", 409);
      const historyRequest = { id: input.requestId, checkpointId: restore.checkpoint.id, authorId: user.id, revision, createdAt: now(), ...(input.text ? { text: input.text } : {}) };
      await sessions.updateOne({ _id: sessionId, revision: current.revision }, { $set: { revision, historyRequest, pauseRequested: false, status: current.activeTurnId ? "running" : "planning", updatedAt: now() } }, { session: tx });
      await eventInTx(db, tx, sessionId, { historyAction: { action: input.action, target: input.target, requestId: input.requestId, fromRevision: current.revision, toRevision: revision }, kind: "system", actor: user.name, actorUserId: user.id, title: "Checkpoint restore requested", detail: `Restore checkpoint ${restore.checkpoint.id} (revision ${restore.checkpoint.revision}) at a stopped-agent boundary. ${input.text ? `Then apply: ${input.text}` : "Pause after restoring saved files and request decisions."} Later history is preserved.`, intentIds: restore.checkpoint.intentIds });
      result = { ok: true, action: "restore", revision, requestId: input.requestId, status: "queued" };
    } else {
      let targets: string[] = [], context = "";
      if (input.target.type === "intent") {
        const target = intents.find((intent) => intent.id === input.target.id);
        if (!target) throw new StoreError("The selected request is not in this workspace.", 404);
        targets = [target.id]; context = `User correction of request ${target.id}. Original text and history are retained.`;
      } else if (input.target.type === "event") {
        const event = await db.collection<TrajectoryEvent & { _id: string }>("cv_events").findOne({ sessionId, id: input.target.id }, { session: tx });
        if (!event) throw new StoreError("The selected event is not in this workspace.", 404);
        // Routing/conflict records list the new choice first. Generic tool/agent records do not revoke requirements.
        if (["conflict", "routing"].includes(event.kind) && event.intentIds[0]) targets = [event.intentIds[0]];
        context = `User correction at event ${event.id}: ${event.title}. Preserve unrelated accepted requirements.`;
      } else {
        const checkpoint = await db.collection<MemoryCheckpoint & { _id: string }>("cv_checkpoints").findOne({ _id: input.target.id, sessionId }, { session: tx });
        if (!checkpoint) throw new StoreError("The selected checkpoint is not in this workspace.", 404);
        context = `User correction from checkpoint ${checkpoint.id}. Current source is retained; this is a change of direction, not an exact source restore.`;
      }
      const scope = revisionScope(intents, targets);
      await col.updateMany({ sessionId, id: { $in: scope.retireIds } }, { $set: { status: "superseded" } }, { session: tx });
      for (const id of scope.blockedIds) {
        const before = intents.find((intent) => intent.id === id)!;
        await col.updateOne({ sessionId, id }, { $set: { status: "blocked", decision: { ...before.decision!, relation: "conflict", parentIntentIds: scope.retireIds, reason: "The requirement this work depended on was revised. Review whether this dependent request should still apply." } }, $unset: { resolution: "" } }, { session: tx });
      }
      const intent = correction(sessionId, user.id, input.text!, revision, targets, context);
      const activeCount = await col.countDocuments({ sessionId, status: { $nin: ["superseded", "duplicate"] } }, { session: tx });
      if (activeCount >= 64) throw new StoreError("There are 64 active requests. Revise an existing request before adding another direction.", 409);
      await col.insertOne({ ...intent, _id: `${sessionId}:history:${input.requestId}`, requestId: input.requestId }, { session: tx });
      const next = (await col.find({ sessionId }, { session: tx }).sort({ revision: 1 }).toArray()).map(cleanIntent);
      await sessions.updateOne({ _id: sessionId }, { $set: { revision, plan: buildPlan(next, revision), pauseRequested: false, status: current.activeTurnId ? "running" : "planning", updatedAt: now() }, $unset: { error: "" } }, { session: tx });
      await eventInTx(db, tx, sessionId, { historyAction: { action: input.action, target: input.target, requestId: input.requestId, fromRevision: current.revision, toRevision: revision }, kind: "intent", actor: user.name, actorUserId: user.id, title: "Direction revised", detail: `${context}\n${input.text}\n${scope.retireIds.length} earlier choices retired; ${scope.blockedIds.length} dependent requests need review.`, intentIds: [intent.id, ...scope.retireIds, ...scope.blockedIds] });
      result = { ok: true, action: "revise", revision, requestId: input.requestId, intentId: intent.id, status: "applied" };
    }
    await actions.insertOne({ _id: key, sessionId, authorId: user.id, input, result, createdAt: now() }, { session: tx });
    return result;
  });
}

/** Must be called after the old agent is stopped, with the live worker lease. */
export async function loadHistoryRestore(sessionId: string, owner: string) {
  const session = await (await database()).collection<SessionDoc>("cv_sessions").findOne({ _id: sessionId, leaseOwner: owner, leaseUntil: { $gt: now() } });
  if (!session) throw new StoreError("Worker lease changed before restore.", 409);
  if (!session.historyRequest) return null;
  if (session.activeTurnId) throw new StoreError("Stop the running agent before restoring files.", 409);
  if (session.revision !== session.historyRequest.revision) throw new StoreError("Workspace revision changed before restore.", 409);
  const source = await readSourceCheckpoint(sessionId, session.historyRequest.checkpointId);
  if (!source) throw new StoreError("Source checkpoint not found.", 409);
  const intents = (await (await database()).collection<IntentDoc>("cv_intents").find({ sessionId }).toArray()).map(cleanIntent);
  savedState(source.checkpoint, intents);
  return { request: session.historyRequest, ...source };
}

/** Persist the immutable undo point before the first filesystem mutation. */
export async function setHistoryRestoreBackup(sessionId: string, owner: string, requestId: string, checkpointId: string): Promise<void> {
  const source = await readSourceCheckpoint(sessionId, checkpointId);
  if (!source) throw new StoreError("The restore recovery checkpoint is unavailable.", 409);
  await transaction(async (db, tx) => {
    const sessions = db.collection<SessionDoc>("cv_sessions");
    const current = await sessions.findOne({ _id: sessionId, leaseOwner: owner, leaseUntil: { $gt: now() }, "historyRequest.id": requestId, activeTurnId: { $exists: false } }, { session: tx });
    if (!current || !current.historyRequest || current.historyRequest.revision !== current.revision || source.checkpoint.revision !== current.revision) throw new StoreError("Worker lease or restore recovery revision changed.", 409);
    if (current.historyRequest.recoveryCheckpointId) {
      if (current.historyRequest.recoveryCheckpointId !== checkpointId) throw new StoreError("A different immutable recovery checkpoint is already assigned to this restore.", 409);
      return;
    }
    if (current.sourceCheckpointId !== checkpointId) throw new StoreError("The restore backup must be the committed source checkpoint.", 409);
    const intents = (await db.collection<IntentDoc>("cv_intents").find({ sessionId }, { session: tx }).toArray()).map(cleanIntent);
    savedState(source.checkpoint, intents);
    await sessions.updateOne({ _id: sessionId }, { $set: { "historyRequest.recoveryCheckpointId": checkpointId } }, { session: tx });
  });
}

/** Files were restored by the stopped worker; publish the matching request state atomically. */
export async function completeHistoryRestore(sessionId: string, owner: string, requestId: string): Promise<void> {
  const restore = await loadHistoryRestore(sessionId, owner);
  if (!restore || restore.request.id !== requestId) throw new StoreError("The pending restore changed.", 409);
  if (!restore.request.recoveryCheckpointId) throw new StoreError("Save an immutable recovery checkpoint before restoring files.", 409);
  await transaction(async (db, tx) => {
    const sessions = db.collection<SessionDoc>("cv_sessions");
    const current = await sessions.findOne({ _id: sessionId, leaseOwner: owner, leaseUntil: { $gt: now() }, "historyRequest.id": requestId, activeTurnId: { $exists: false }, revision: restore.request.revision }, { session: tx });
    if (!current) throw new StoreError("Worker lease or restore revision changed.", 409);
    const col = db.collection<IntentDoc>("cv_intents");
    const intents = (await col.find({ sessionId }, { session: tx }).toArray()).map(cleanIntent);
    const state = savedState(restore.checkpoint, intents);
    await col.updateMany({ sessionId }, { $set: { status: "superseded" } }, { session: tx });
    for (const row of state) {
      await col.updateOne({ sessionId, id: row.id }, { $set: { status: row.status, ...(row.decision ? { decision: row.decision } : {}), ...(row.resolution ? { resolution: row.resolution } : {}) }, ...(!row.decision || !row.resolution ? { $unset: { ...(!row.decision ? { decision: "" as const } : {}), ...(!row.resolution ? { resolution: "" as const } : {}) } } : {}) }, { session: tx });
    }
    let intent: Intent | undefined;
    if (restore.request.text) {
      intent = correction(sessionId, restore.request.authorId, restore.request.text, current.revision, restore.checkpoint.intentIds, `New direction after restoring checkpoint ${restore.checkpoint.id}.`);
      const count = await col.countDocuments({ sessionId, status: { $nin: ["superseded", "duplicate"] } }, { session: tx });
      if (count >= 64) throw new StoreError("The saved checkpoint already has 64 active requests. Restore without a new direction first.", 409);
      await col.insertOne({ ...intent, _id: `${sessionId}:history:${requestId}`, requestId }, { session: tx });
    }
    const next = (await col.find({ sessionId }, { session: tx }).sort({ revision: 1 }).toArray()).map(cleanIntent);
    await sessions.updateOne({ _id: sessionId }, { $set: { sourceCheckpointId: restore.checkpoint.id, plan: buildPlan(next, current.revision), processedRevision: Math.min(current.processedRevision, restore.checkpoint.revision), pauseRequested: !intent, status: intent ? "planning" : "paused", updatedAt: now() }, $unset: { historyRequest: "", codexThreadId: "", activeTurnId: "", artifact: "", error: "" } }, { session: tx });
    await db.collection<HistoryDoc>("cv_history_actions").updateOne({ _id: `${sessionId}:${requestId}` }, { $set: { "result.status": "applied", ...(intent ? { "result.intentId": intent.id } : {}) } }, { session: tx });
    await eventInTx(db, tx, sessionId, { historyAction: { action: "restore", target: { type: "checkpoint", id: restore.checkpoint.id }, requestId, fromRevision: restore.checkpoint.revision, toRevision: current.revision }, kind: "system", actor: "Converge", actorUserId: restore.request.authorId, title: "Checkpoint restored", detail: `Files and request decisions from ${restore.checkpoint.id} (revision ${restore.checkpoint.revision}) restored as revision ${current.revision}. Later events remain in history. ${intent ? "The new direction will run in a fresh coding thread." : "Work is paused. Resume when ready, or use Change direction to continue differently."}`, intentIds: [...restore.checkpoint.intentIds, ...(intent ? [intent.id] : [])] });
  });
}

export async function failHistoryRestore(sessionId: string, owner: string, requestId: string, message: string): Promise<void> {
  await transaction(async (db, tx) => {
    const result = await db.collection<SessionDoc>("cv_sessions").updateOne({ _id: sessionId, leaseOwner: owner, leaseUntil: { $gt: now() }, "historyRequest.id": requestId }, { $set: { pauseRequested: true, status: "error", error: redact(message).slice(0, 1000), updatedAt: now() }, $unset: { historyRequest: "", activeTurnId: "" } }, { session: tx });
    if (!result.matchedCount) throw new StoreError("Worker lease or restore request changed.", 409);
    await db.collection<HistoryDoc>("cv_history_actions").updateOne({ _id: `${sessionId}:${requestId}` }, { $set: { "result.status": "failed", error: redact(message).slice(0, 1000) } }, { session: tx });
    await eventInTx(db, tx, sessionId, { kind: "system", actor: "Converge", title: "Checkpoint restore stopped", detail: redact(message).slice(0, 1000), intentIds: [] });
  });
}
