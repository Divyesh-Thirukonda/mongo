import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlan, classifyIntent } from "../lib/intent-router";
import type { Intent, RoutingDecision } from "../lib/types";

function intent(id: string, text: string, patch: Partial<Intent> = {}): Intent {
  return { id, sessionId: "session", authorId: "alex", text, createdAt: "2026-09-26T12:00:00.000Z", revision: 1, status: "accepted", ...patch };
}
async function withoutProvider<T>(work: () => Promise<T>) {
  const prior = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try { return await work(); }
  finally { if (prior === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prior; }
}
async function fakeProvider<T>(fetcher: typeof fetch, work: () => Promise<T>) {
  const priorKey = process.env.OPENROUTER_API_KEY, priorFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-only-key";
  globalThis.fetch = fetcher;
  try { return await work(); }
  finally { globalThis.fetch = priorFetch; if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = priorKey; }
}
const reply = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { headers: { "Content-Type": "application/json" } });
const decision = (relation: RoutingDecision["relation"], parents: string[], acceptance: string[]): RoutingDecision => ({ relation, parentIntentIds: parents, acceptance, summary: acceptance[0], reason: "Source-backed relation", source: "rules" });

test("Stripe connection and newest-three NEW labels remain a dependency with both authors", async () => {
  await withoutProvider(async () => {
    const first = intent("stripe", "Connect Stripe and display its product catalog.");
    const second = intent("badges", "Add a NEW label to the latest 3 products.", { authorId: "sam", revision: 2 });
    second.decision = await classifyIntent(second, [first]);
    assert.equal(second.decision.relation, "depend");
    assert.deepEqual(second.decision.parentIntentIds, [first.id]);
    const plan = buildPlan([second, first], 2);
    assert.deepEqual(plan.steps.map((step) => step.intentIds[0]), ["stripe", "badges"]);
    assert.deepEqual(plan.steps[1].dependsOn, ["step-stripe"]);
    assert.ok(plan.constraints.some((constraint) => constraint.authorId === "alex" && constraint.text === first.text));
    assert.ok(plan.constraints.some((constraint) => constraint.authorId === "sam" && constraint.text === second.text));
  });
});

test("equivalent repeats avoid new work and opposition blocks without replacing the earlier author", async () => {
  await withoutProvider(async () => {
    const original = intent("original", "Add a NEW badge to the latest 3 products.");
    const repeated = intent("repeat", "Please add the NEW badge to the newest three products.", { authorId: "sam" });
    repeated.decision = await classifyIntent(repeated, [original]);
    assert.equal(repeated.decision.relation, "duplicate");
    repeated.status = "duplicate";
    assert.equal(buildPlan([original, repeated], 2).steps.length, 1);
    for (const text of ["Remove the NEW badge from products.", "Rename the NEW label to FRESH."]) {
      const incoming = intent("opposition", text, { authorId: "jordan", status: "blocked", revision: 3 });
      incoming.decision = await classifyIntent(incoming, [original]);
      assert.equal(incoming.decision.relation, "conflict");
      const plan = buildPlan([original, incoming], 3);
      assert.equal(plan.steps.find((step) => step.intentIds[0] === incoming.id)?.status, "blocked");
      assert.equal(plan.constraints[0].authorId, "alex");
      assert.equal(original.status, "accepted");
    }
  });
});

test("generic semantic routing calls the provider once with bounded records and validates provenance", async () => {
  const originals = Array.from({ length: 25 }, (_, index) => intent(`source-${index}`, `Build release coordination ${index}. ${"detail ".repeat(300)}`, { revision: index }));
  const incoming = intent("incoming", "Let reviewers approve the release before deployment.", { authorId: "jordan" });
  let calls = 0;
  await fakeProvider(async (_url, options) => {
    calls++;
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.max_tokens, 700);
    assert.equal(payload.response_format.type, "json_schema");
    assert.equal(payload.tools, undefined);
    const records = JSON.parse(payload.messages[1].content.split("\n")[1]);
    assert.equal(records.existing.length, 16);
    assert.ok(records.existing.every((item: { text: string }) => item.text.length <= 1200));
    return reply({ relation: "depend", summary: "Require release approval", reason: "Approval uses the release coordination work.", parentIntentIds: [records.existing[0].id], acceptance: ["Reviewers can approve a release before deployment."] });
  }, async () => {
    const result = await classifyIntent(incoming, originals);
    assert.equal(result.source, "openrouter");
    assert.equal(result.relation, "depend");
    assert.ok(result.acceptance.includes(incoming.text));
    assert.ok(originals.some((item) => item.id === result.parentIntentIds[0]));
  });
  assert.equal(calls, 1);
});

test("unknown, superseded, and foreign-session model parents fail closed to honest rules", async () => {
  const incoming = intent("incoming", "Add independent release notes.");
  const existing = [intent("active", "Build an administration page."), intent("old", "Older request", { status: "superseded" }), intent("foreign", "Other work", { sessionId: "other" })];
  for (const invalidParent of ["fabricated", "old", "foreign"]) {
    await fakeProvider(async () => reply({ relation: "depend", summary: "Release notes", reason: "Unsupported parent", parentIntentIds: [invalidParent], acceptance: [incoming.text] }), async () => {
      const result = await classifyIntent(incoming, existing);
      assert.equal(result.source, "rules");
      assert.ok(!result.parentIntentIds.includes(invalidParent));
      assert.match(result.reason, /invalid classification/);
    });
  }
});

test("provider failures retain arbitrary intent exactly and do not retry paid classification", async () => {
  const incoming = intent("incoming", "Explore a tactile constellation interface that supports keyboard navigation and low vision.");
  let calls = 0;
  await fakeProvider(async () => { calls++; throw new DOMException("Timed out", "TimeoutError"); }, async () => {
    const result = await classifyIntent(incoming, [intent("older", "Implement billing settings.")]);
    assert.equal(result.source, "rules");
    assert.equal(result.relation, "parallel");
    assert.deepEqual(result.acceptance, [incoming.text]);
  });
  assert.equal(calls, 1);
});

test("fulfilled constraints remain in future plans, blocked prerequisites propagate, and cycles cannot run", () => {
  const fulfilled = intent("fulfilled", "Keep all actions keyboard accessible.", { status: "fulfilled", decision: decision("start", [], ["Tab order must remain logical."]) });
  const blocked = intent("blocked", "Delete the required keyboard controls.", { status: "blocked", decision: decision("conflict", [fulfilled.id], ["Delete controls."]), revision: 2 });
  const child = intent("child", "Restyle the affected control area.", { decision: decision("depend", [blocked.id], ["Restyle controls."]), revision: 3 });
  const sources = [fulfilled, blocked, child], before = structuredClone(sources);
  const plan = buildPlan(sources, 3);
  assert.equal(plan.steps[0].status, "done");
  assert.ok(plan.constraints.some((item) => item.text === "Tab order must remain logical." && item.intentId === fulfilled.id));
  assert.equal(plan.steps[2].status, "blocked");
  assert.deepEqual(sources, before);
  const a = intent("a", "First dependent task", { decision: decision("depend", ["b"], ["A"]) });
  const b = intent("b", "Second dependent task", { decision: decision("depend", ["a"], ["B"]) });
  assert.ok(buildPlan([a, b], 4).steps.every((step) => step.status === "blocked"));
});

test("an explicit human replacement can proceed after its conflicting source is retired", () => {
  const original = intent("old-label", "Add a NEW label.", { status: "superseded" });
  const replacement = intent("new-label", "Rename the NEW label to FRESH.", {
    authorId: "jordan", revision: 2, resolution: "replace-existing",
    decision: decision("conflict", [original.id], ["The label is FRESH."]),
  });
  const plan = buildPlan([original, replacement], 2);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].status, "pending");
  assert.deepEqual(plan.steps[0].dependsOn, []);
  assert.ok(plan.constraints.every((constraint) => constraint.intentId === replacement.id));
  assert.deepEqual(replacement.decision!.parentIntentIds, [original.id], "Resolution preserves historical provenance.");
});

test('integration dependencies work beyond a particular provider',async()=>{
 await withoutProvider(async()=>{
  const first=intent('issues','Connect GitHub and load repository issues.');
  const second=intent('sort','Sort the latest GitHub issues by date.',{revision:2});
  const result=await classifyIntent(second,[first]);assert.equal(result.relation,'depend');assert.deepEqual(result.parentIntentIds,[first.id]);
 });
});
