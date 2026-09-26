import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIntentGraph, graphHistoryTarget } from "../lib/intent-graph";
import type { Intent, SessionSnapshot, TrajectoryEvent } from "../lib/types";

const at = (second: number) => new Date(Date.UTC(2026, 8, 26, 12, 0, second)).toISOString();
function intent(id: string, revision: number, authorId = "real-alice", parents: string[] = []): Intent {
  return { id, sessionId: "session", revision, authorId, createdAt: at(revision), text: `Original request ${id}`, status: "accepted",
    decision: { relation: parents.length ? "depend" : "start", parentIntentIds: parents, summary: `Build ${id}`, reason: "Grounded dependency", acceptance: [`Preserve ${id}`], source: "rules" } };
}
function event(id: string, sequence: number, kind: TrajectoryEvent["kind"] = "tool", turnId?: string): TrajectoryEvent {
  return { id, sessionId: "session", sequence, createdAt: at(sequence + 10), kind, actor: "Codex", title: `Event ${id}`, detail: `Source evidence ${id}`, intentIds: [], ...(turnId ? { turnId } : {}) };
}
function snapshot(intents: Intent[] = [], events: TrajectoryEvent[] = []): SessionSnapshot {
  return { session: { id: "session", name: "Shared work", goal: "Build together", createdAt: at(0), updatedAt: at(59), revision: intents.length, processedRevision: 0, status: "running",
    plan: { summary: "Shared plan", steps: [], constraints: [], revision: intents.length },
    metrics: { turns: 2, toolCalls: 3, mergedIntents: 1, avoidedRuns: 0, checksPassed: 0, checksTotal: 0, contextChars: 0, archivedEvents: events.length, providerTokens: 0, steers: 1 } },
    intents, events, checkpoints: [], presence: [], participants: [{ id: "real-alice", name: "Alice Rivera", initials: "AR", color: "#6478b5", isAnonymous: false }, { id: "real-bob", name: "Bob Tan", initials: "BT", color: "#ac7853", isAnonymous: false }], currentUserId: "real-alice",
    worker: { online: true, engine: "Codex" }, storage: { mode: "atlas", connected: true } };
}

test("dependencies retain their real authors and precede children despite clock disagreement", () => {
  const parent = { ...intent("foundation", 1), createdAt: at(20) };
  const child = intent("badge", 2, "real-bob", ["foundation"]);
  const graph = buildIntentGraph(snapshot([child, parent]));
  assert.deepEqual(graph.nodes.map((node) => node.sourceId), ["foundation", "badge"]);
  assert.equal(graph.nodes[0].actor, "Alice Rivera");
  assert.equal(graph.nodes[1].actor, "Bob Tan");
  assert.equal(graph.nodes[0].createdAt, parent.createdAt);
  assert.deepEqual(graph.edges.filter((edge) => edge.kind === "dependency"), [{ id: "dependency:foundation:badge", from: "intent:foundation", to: "intent:badge", kind: "dependency", label: "depend" }]);
  assert.equal(graph.lanes.length, 3);
});

test("event order uses durable sequence and graph construction never mutates the snapshot", () => {
  const early = { ...event("early", 1), createdAt: at(50) };
  const late = { ...event("late", 2), createdAt: at(10) };
  const data = snapshot([intent("first", 1)], [late, early]);
  const before = structuredClone(data);
  const graph = buildIntentGraph(data, { compact: false });
  assert.deepEqual(graph.nodes.filter((node) => node.sequence).map((node) => node.sourceId), ["early", "late"]);
  assert.deepEqual(graph, buildIntentGraph({ ...data, intents: [...data.intents].reverse(), events: [...data.events].reverse() }, { compact: false }));
  assert.deepEqual(data, before);
});

test("only recorded turn IDs associate steering with an execution turn", () => {
  const first = { ...event("turn-a-start", 1, "agent", "turn-a"), title: "Working from the shared plan", intentIds: ["foundation"] };
  const planMerge = { ...event("planned-merge", 2, "merge"), intentIds: ["badge", "foundation"] };
  const second = { ...event("turn-b-start", 3, "agent", "turn-b"), title: "Working from the shared plan" };
  const steer = { ...event("acknowledged-steer", 4, "merge", "turn-a"), intentIds: ["badge", "foundation"] };
  const graph = buildIntentGraph(snapshot([intent("foundation", 1), intent("badge", 2, "real-bob", ["foundation"])], [steer, second, planMerge, first]), { compact: false });
  assert.equal(graph.nodes.find((node) => node.sourceId === "planned-merge")?.kind, "routing");
  assert.equal(graph.nodes.find((node) => node.sourceId === "acknowledged-steer")?.kind, "steer");
  assert.deepEqual(graph.edges.filter((edge) => edge.kind === "turn"), [{ id: "turn:turn-a-start:acknowledged-steer", from: "event:turn-a-start", to: "event:acknowledged-steer", kind: "turn", label: "same turn · turn-a" }]);
  assert.ok(!graph.nodes.some((node) => node.sourceId === "turn-a"));
});

test("missing parents are explicit gaps, never fabricated branch nodes", () => {
  const data = snapshot([intent("badge", 2, "real-bob", ["unloaded-parent"])], [event("last", 100, "verification")]);
  data.session.metrics.archivedEvents = 100;
  const graph = buildIntentGraph(data);
  const child = graph.nodes.find((node) => node.sourceId === "badge")!;
  assert.deepEqual(child.references, [{ type: "intent", id: "unloaded-parent", available: false }]);
  assert.match(child.warnings[0], /outside this view/);
  assert.ok(!graph.nodes.some((node) => node.sourceId === "unloaded-parent"));
  assert.ok(!graph.edges.some((edge) => edge.from === "intent:unloaded-parent"));
  assert.equal(graph.history.totalEvents, 100);
  assert.equal(graph.history.loadedEvents, 1);
});

test("compact mode preserves observed turn anchors and exposes filtered checkpoint sources", () => {
  const data = snapshot([], [event("first-tool", 1, "tool", "turn-a"), event("hidden-tool", 2, "tool", "turn-a"), event("verify", 3, "verification", "turn-a")]);
  data.checkpoints = [{ id: "memory-1", sessionId: "session", createdAt: at(20), revision: 1, summary: "Checkpoint evidence", intentIds: [], decisions: [], eventCount: 3, contextChars: 300, sourceEventIds: ["hidden-tool", "verify"] }];
  const overview = buildIntentGraph(data);
  assert.ok(overview.nodes.some((node) => node.sourceId === "first-tool" && node.kind === "tool"));
  assert.ok(!overview.nodes.some((node) => node.sourceId === "hidden-tool"));
  assert.equal(overview.history.filteredEvents, 1);
  const checkpoint = overview.nodes.find((node) => node.id === "checkpoint:memory-1")!;
  assert.equal(checkpoint.createdAt, at(20));
  assert.deepEqual(checkpoint.references, [{ type: "event", id: "hidden-tool", available: false }, { type: "event", id: "verify", available: true }]);
  const all = buildIntentGraph(data, { compact: false });
  assert.ok(all.edges.some((edge) => edge.from === "event:hidden-tool" && edge.to === checkpoint.id && edge.kind === "source"));
});

test("view limits use recent records and discard foreign-session sources", () => {
  const data = snapshot([intent("one", 1), intent("two", 2, "real-bob", ["one"])], [event("one", 1), event("two", 2), event("three", 3), { ...event("foreign", 10), sessionId: "another" }]);
  const graph = buildIntentGraph(data, { maxEvents: 2, maxIntents: 1, compact: false });
  assert.equal(graph.history.omittedEvents, 1);
  assert.equal(graph.history.omittedIntents, 1);
  assert.deepEqual(graph.nodes.filter((node) => node.sequence).map((node) => node.sourceId), ["two", "three"]);
  assert.ok(!graph.nodes.some((node) => node.sourceId === "foreign"));
  assert.equal(graph.nodes.find((node) => node.kind === "intent")?.references[0].available, false);
});

test("cyclic source relationships are surfaced without hanging or losing records", () => {
  const graph = buildIntentGraph(snapshot([intent("one", 1, "real-alice", ["two"]), intent("two", 2, "real-bob", ["one"])]));
  assert.equal(graph.nodes.length, 2);
  assert.ok(graph.nodes.some((node) => node.warnings.some((warning) => warning.includes("cycle"))));
});

test("connected reports have separate provenance and cannot impersonate observed turns", () => {
  const observed = { ...event("observed", 1, "agent", "shared-id"), title: "Working from the shared plan" };
  const report: TrajectoryEvent = { ...event("report", 2, "agent"), source: "connected-agent", externalTrajectoryId: "shared-id", actorUserId: "real-bob", title: "Working from the shared plan" };
  const reportedTool: TrajectoryEvent = { ...event("reported-tool", 3, "tool"), source: "connected-agent", externalTrajectoryId: "shared-id", actorUserId: "real-bob" };
  const observedTool = event("observed-tool", 4, "tool", "shared-id");
  const graph = buildIntentGraph(snapshot([], [observed, report, reportedTool, observedTool]), { compact: false });
  const node = graph.nodes.find((value) => value.sourceId === "report")!;
  assert.equal(node.kind, "connected");
  assert.equal(node.source, "connected-agent");
  assert.equal(node.laneId, "connected");
  assert.equal(node.actor, "Connected Codex · Bob Tan");
  assert.equal(node.externalTrajectoryId, "shared-id");
  assert.equal(node.turnId, undefined);
  assert.equal(graph.nodes.find((value) => value.sourceId === "observed")?.kind, "turn");
  assert.equal(graph.nodes.find((value) => value.sourceId === "reported-tool")?.kind, "reported-tool");
  assert.deepEqual(graph.edges.filter((edge) => edge.kind === "turn").map(({ from, to }) => ({ from, to })), [{ from: "event:observed", to: "event:observed-tool" }]);
  assert.deepEqual(graph.edges.filter((edge) => edge.kind === "reported").map(({ from, to }) => ({ from, to })), [{ from: "event:report", to: "event:reported-tool" }]);
});

test("legacy external turn identifiers remain self-reported groups, including deceptive titles", () => {
  const legacy = { ...event("legacy", 1, "agent", "external-012345abcdef-codex"), title: "Working from the shared plan" };
  const legacyTool = event("legacy-tool", 2, "tool", "external-012345abcdef-codex");
  const malformed: TrajectoryEvent = { ...event("wrong-turn-field", 3, "agent", "actual-managed-turn"), source: "connected-agent", title: "Working from the shared plan" };
  const graph = buildIntentGraph(snapshot([], [legacy, legacyTool, malformed]), { compact: false });
  assert.ok(graph.nodes.every((node) => node.source === "connected-agent" && node.turnId === undefined));
  assert.equal(graph.nodes[0].externalTrajectoryId, legacy.turnId);
  assert.ok(!graph.edges.some((edge) => edge.kind === "turn"));
  assert.equal(graph.edges.filter((edge) => edge.kind === "reported").length, 1);
});


test("history actions address source records, including checkpoint events versus saved checkpoints", () => {
  const data = snapshot([intent("request-one", 1)], [event("checkpoint-event", 1, "checkpoint")]);
  data.checkpoints = [{ id: "checkpoint-manifest", sessionId: "session", createdAt: at(22), revision: 1, summary: "Saved state", intentIds: ["request-one"], decisions: [], eventCount: 1, contextChars: 80, intentState: [] }];
  const graph = buildIntentGraph(data, { compact: false });
  assert.deepEqual(graphHistoryTarget(graph.nodes.find((node) => node.id === "intent:request-one")!), { type: "intent", id: "request-one" });
  assert.deepEqual(graphHistoryTarget(graph.nodes.find((node) => node.id === "event:checkpoint-event")!), { type: "event", id: "checkpoint-event" });
  assert.deepEqual(graphHistoryTarget(graph.nodes.find((node) => node.id === "checkpoint:checkpoint-manifest")!), { type: "checkpoint", id: "checkpoint-manifest" });
  assert.throws(() => graphHistoryTarget({ id: "checkpoint:another-record", sourceId: "checkpoint-manifest" }), /matching source/);
});


test("structured history actions connect corrections and restores to their exact selected sources", () => {
  const source = event("original-tool", 1, "tool");
  const correction: TrajectoryEvent = { ...event("correction", 2, "system"), historyAction: { action: "revise", target: { type: "event", id: source.id }, requestId: "request-revise", fromRevision: 1, toRevision: 2 } };
  const restore: TrajectoryEvent = { ...event("restore", 3, "system"), historyAction: { action: "restore", target: { type: "checkpoint", id: "saved-state" }, requestId: "request-restore", fromRevision: 2, toRevision: 3 } };
  const data = snapshot([intent("original-request", 1)], [source, correction, restore]);
  data.checkpoints = [{ id: "saved-state", sessionId: "session", createdAt: at(10), revision: 1, summary: "Saved state", intentIds: [], decisions: [], eventCount: 1, contextChars: 60 }];
  const graph = buildIntentGraph(data);
  assert.ok(graph.nodes.some((node) => node.id === "event:original-tool"), "overview keeps the selected source of a correction");
  assert.equal(graph.nodes.find((node) => node.id === "event:correction")?.kind, "revision");
  assert.equal(graph.nodes.find((node) => node.id === "event:restore")?.kind, "restore");
  assert.deepEqual(graph.edges.filter((edge) => edge.kind === "history").map(({ from, to }) => ({ from, to })), [
    { from: "event:original-tool", to: "event:correction" }, { from: "checkpoint:saved-state", to: "event:restore" },
  ]);
  assert.ok(graph.nodes.find((node) => node.id === "event:restore")?.references.some((reference) => reference.type === "checkpoint" && reference.id === "saved-state" && reference.available));
});

test("missing history sources stay explicit and connected reports cannot forge history-action edges", () => {
  const missing: TrajectoryEvent = { ...event("missing-source", 1, "system"), historyAction: { action: "revise", target: { type: "intent", id: "not-loaded" }, requestId: "request-missing", fromRevision: 1, toRevision: 2 } };
  const report: TrajectoryEvent = { ...event("report", 2, "agent"), source: "connected-agent", historyAction: { action: "restore", target: { type: "intent", id: "known" }, requestId: "untrusted", fromRevision: 2, toRevision: 3 } };
  const graph = buildIntentGraph(snapshot([intent("known", 1)], [missing, report]));
  assert.ok(!graph.edges.some((edge) => edge.kind === "history"));
  assert.ok(graph.nodes.find((node) => node.id === "event:missing-source")?.warnings.some((warning) => warning.includes("outside this view")));
  assert.equal(graph.nodes.find((node) => node.id === "event:report")?.historyAction, undefined);
  assert.equal(graph.nodes.find((node) => node.id === "event:report")?.kind, "connected");
});
