import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { historyActionSchema, revisionScope } from "../lib/history";
import type { Intent } from "../lib/types";
const intent = (id: string, status: Intent["status"] = "accepted", parents: string[] = [], relation: NonNullable<Intent["decision"]>["relation"] = "start"): Intent => ({ id, sessionId: "one", authorId: "owner", text: id, revision: 1, createdAt: "2026-09-26T00:00:00.000Z", status, decision: { relation, parentIntentIds: parents, acceptance: [id], reason: id, summary: id, source: "rules" } });

test("revising a wrong conflict choice retires both alternatives and blocks dependent work", () => {
  const old = intent("space"), chosen = { ...intent("medieval", "superseded", ["space"], "conflict"), resolution: "keep-existing" as const };
  const dependent = intent("castles", "accepted", ["space"], "depend"), grandchild = intent("drawbridge", "accepted", ["castles"], "depend"), unrelated = intent("flap");
  assert.deepEqual(revisionScope([old, chosen, dependent, grandchild, unrelated], ["medieval"]), { retireIds: ["medieval", "space"], blockedIds: ["castles", "drawbridge"] });
  assert.equal(unrelated.status, "accepted");
});

test("ordinary event corrections preserve existing requirements and audit identity", () => {
  const original = intent("game");
  assert.deepEqual(revisionScope([original], []), { retireIds: [], blockedIds: [] });
  assert.equal(original.text, "game");
});

test("history actions require stable request identity, a current revision, and correction text", () => {
  const action = { action: "revise", target: { type: "event", id: randomUUID() }, expectedRevision: 4, requestId: randomUUID(), text: "Use the space theme instead" };
  assert.equal(historyActionSchema.parse(action).text, action.text);
  assert.equal(historyActionSchema.safeParse({ ...action, text: " " }).success, false);
  assert.equal(historyActionSchema.safeParse({ ...action, expectedRevision: -1 }).success, false);
  assert.equal(historyActionSchema.safeParse({ ...action, action: "restore" }).success, false);
  assert.equal(historyActionSchema.safeParse({ ...action, actorId: "someone-else" }).success, false);
  assert.equal(historyActionSchema.safeParse({ ...action, action: "restore", text: undefined, target: { type: "checkpoint", id: "checkpoint-123" } }).success, true);
});


test("selecting the discarded side also retires its currently chosen conflict counterpart", () => {
  const discarded = intent("space", "superseded");
  const chosen = { ...intent("medieval", "accepted", ["space"], "conflict"), resolution: "replace-existing" as const };
  assert.deepEqual(revisionScope([discarded, chosen, intent("unrelated")], ["space"]), { retireIds: ["space", "medieval"], blockedIds: [] });
});
