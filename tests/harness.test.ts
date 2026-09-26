import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAction,
  applyAgentRecommendation,
  baselinePolicy,
  createInitialRun,
  derivePolicy,
  incidentVariant,
  stepRun,
} from "../lib/simulation";
import {
  canExecuteContainment,
  compactHarnessContext,
  ensureHarness,
  MAX_HARNESS_MESSAGES,
  MAX_HARNESS_SUMMARY_CHARS,
  progressThreatCollaboration,
  recordAgentReasoning,
  validateRoleRecommendation,
} from "../lib/war-room-harness";
import type { MemoryRecall } from "../lib/harness-types";
import type { SimulationRun } from "../lib/types";

function finish(initial: SimulationRun): SimulationRun {
  let run = initial;
  for (
    let count = 0;
    count < 50 && !["contained", "breached"].includes(run.status);
    count++
  )
    run = stepRun(run);
  return run;
}
function advance(initial: SimulationRun, ticks: number): SimulationRun {
  let run = initial;
  for (let count = 0; count < ticks; count++) run = stepRun(run);
  return run;
}
const recall: MemoryRecall = {
  matches: [
    {
      memoryId: "memory-previous",
      runId: "previous",
      similarity: 0.94,
      relationship: "related",
      summary: "A workstation intrusion crossed the identity boundary.",
      outcome: "contained",
      reason: "Matching technique and connected entry type",
    },
  ],
  watchNodeIds: ["workstation-01", "database"],
  anticipate: true,
  context: "Watch prior entry paths, but demand fresh evidence.",
  contextChars: 49,
  maxContextChars: 4000,
  considered: 1,
};

test("previews initialize harness state without inventing prior memory", () => {
  const run = createInitialRun();
  assert.equal(run.harness?.version, 1);
  assert.equal(run.harness?.phase, "monitor");
  assert.equal(run.harness?.recall.anticipate, false);
  assert.equal(run.variant, "original");
});

test("each automatic containment follows the five-role evidence and approval chain", () => {
  const run = finish(createInitialRun());
  const harness = ensureHarness(run);
  assert.ok(harness.tasks.some((task) => task.executedBy === "bastion"));
  for (const task of harness.tasks.filter((task) => task.executedBy)) {
    assert.equal(task.approvedBy, "nexus");
    assert.equal(task.status, "contained");
    const chain = harness.messages.filter(
      (message) =>
        message.nodeId === task.nodeId &&
        message.evidenceIds.some((id) => task.evidenceIds.includes(id)),
    );
    const expected = [
      ["sentinel", "observation"],
      ["cipher", "assessment"],
      ["trace", "handoff"],
      ["bastion", "proposal"],
      ["nexus", "approval"],
      ["bastion", "execution"],
    ];
    for (const [index, [actor, kind]] of expected.entries()) {
      const message = chain.find(
        (entry) => entry.from === actor && entry.kind === kind,
      )!;
      assert.ok(message, `${actor} ${kind} must exist`);
      assert.ok(
        message.evidenceIds.every((id) =>
          run.events.some(
            (event) => event.id === id && event.kind === "attack",
          ),
        ),
      );
      if (index > 0) {
        const previous = chain.find(
          (entry) =>
            entry.from === expected[index - 1][0] &&
            entry.kind === expected[index - 1][1],
        )!;
        assert.equal(message.inReplyTo, previous.id);
      }
    }
  }
  assert.equal(harness.phase, "review");
});

test("tampered handoffs and role bypass cannot authorize isolation", () => {
  let run = advance(
    createInitialRun("ransomware", 42, { autoDefend: false }),
    6,
  );
  assert.equal(
    canExecuteContainment(run, "workstation-01", "bastion").allowed,
    false,
  );
  run = applyAction(run, { type: "auto-defend", enabled: true });
  assert.equal(progressThreatCollaboration(run, "workstation-01"), true);
  assert.equal(
    canExecuteContainment(run, "workstation-01", "cipher").allowed,
    false,
  );
  const handoff = run.harness!.messages.find(
    (message) =>
      message.nodeId === "workstation-01" && message.kind === "handoff",
  )!;
  handoff.inReplyTo = "forged-assessment";
  assert.equal(
    canExecuteContainment(run, "workstation-01", "bastion").allowed,
    false,
  );
  assert.match(
    canExecuteContainment(run, "workstation-01", "bastion").reason,
    /handoff/,
  );
});

test("manual mode continues collaboration but never issues automatic approvals", () => {
  const run = finish(
    createInitialRun("supply-chain", 51, { autoDefend: false }),
  );
  assert.ok(
    run.harness!.messages.some((message) => message.kind === "proposal"),
  );
  assert.ok(
    run.harness!.messages.every(
      (message) => message.kind !== "approval" && message.kind !== "execution",
    ),
  );
  assert.ok(run.nodes.every((node) => node.status !== "isolated"));
});

test("model tools enforce role permissions and leave rejected requests observable", () => {
  const run = advance(createInitialRun(), 3);
  applyAgentRecommendation(
    run,
    "isolate",
    "workstation-01",
    "Isolate the suspected workstation immediately.",
    "cipher",
    99,
  );
  assert.equal(
    run.nodes.find((node) => node.id === "workstation-01")?.status,
    "compromised",
  );
  assert.equal(run.harness!.guardrailRejections, 1);
  assert.equal(
    validateRoleRecommendation(run, "nexus", "scan", "database").allowed,
    false,
  );
  assert.equal(
    validateRoleRecommendation(run, "sentinel", "scan", "database").allowed,
    true,
  );
  applyAgentRecommendation(
    run,
    "scan",
    "database",
    "Inspect the database telemetry for current anomalies.",
    "sentinel",
    95,
  );
  assert.equal(
    run.nodes.find((node) => node.id === "database")?.detected,
    false,
  );
});

test("recall anticipates watched compromise earlier without treating healthy memory matches as evidence", () => {
  const policy = {
    ...baselinePolicy("ransomware"),
    isolationDelay: 2,
    scanCadence: 1,
    version: 2,
  };
  const plain = finish(createInitialRun("ransomware", 42, { policy }));
  const anticipated = finish(
    createInitialRun("ransomware", 42, { policy, recall }),
  );
  assert.ok(anticipated.metrics.responseTime < plain.metrics.responseTime);
  assert.ok(anticipated.metrics.integrity >= plain.metrics.integrity);
  assert.equal(
    anticipated.nodes.find((node) => node.id === "database")?.status,
    "healthy",
  );
  assert.ok(
    anticipated.harness!.messages.some(
      (message) =>
        message.kind === "recall" &&
        message.nodeId === "database" &&
        message.content.includes("keep asset online"),
    ),
  );
  assert.ok(
    anticipated.harness!.tasks.every((task) => task.evidenceIds.length > 0),
  );
});

test("variant changes alter the actual entry, timing, and delayed detection", () => {
  const original = advance(createInitialRun("ransomware", 42), 1);
  const shifted = advance(
    createInitialRun("ransomware", 42, { variant: "lateral-shift" }),
    2,
  );
  const slow = advance(
    createInitialRun("ransomware", 42, { variant: "low-and-slow" }),
    3,
  );
  assert.equal(
    original.nodes.find((node) => node.status === "compromised")?.id,
    "workstation-01",
  );
  assert.equal(
    shifted.nodes.find((node) => node.status === "compromised")?.id,
    "workstation-02",
  );
  assert.equal(
    slow.nodes.find((node) => node.status === "compromised")?.id,
    "file-server",
  );
  assert.ok(
    incidentVariant("ransomware", "low-and-slow").spreadInterval >
      incidentVariant("ransomware").spreadInterval,
  );
  assert.equal(finish(slow).tick >= 25, true);
});

test("learned policy transfers to lateral-shift and is evaluated on held-out seeds", () => {
  const first = finish(createInitialRun("ransomware", 42, { id: "initial" }));
  const policy = derivePolicy(first);
  const baseline = finish(
    createInitialRun("ransomware", 818, { variant: "lateral-shift" }),
  );
  const adapted = finish(
    createInitialRun("ransomware", 818, { variant: "lateral-shift", policy }),
  );
  assert.ok(adapted.metrics.integrity > baseline.metrics.integrity);
  assert.match(policy.lesson, /two held-out seeds/);
  assert.equal(policy.evidence?.evaluation?.validation?.cases.length, 3);
  assert.equal(
    policy.evidence?.evaluation?.validation?.cases[0].seed,
    first.seed,
  );
  assert.equal(
    policy.evidence?.evaluation?.baselineIntegrity,
    first.metrics.integrity,
  );
  assert.equal(policy.evidence?.evaluation?.validation?.noRegression, true);
  const evaluatedShift = derivePolicy(
    { ...adapted, id: "shift-evaluation" },
    policy,
  );
  assert.match(evaluatedShift.lesson, /lateral-shift/);
});

test("no improvement does not increment the defense policy version", () => {
  const policy = {
    ...baselinePolicy("ransomware"),
    version: 3,
    isolationDelay: 1,
    scanCadence: 1,
  };
  const run = finish(
    createInitialRun("ransomware", 31, { id: "saturated", policy }),
  );
  const next = derivePolicy(run, policy);
  assert.equal(next.version, 3);
  assert.equal(next.evidence?.evaluation?.accepted, false);
  assert.ok(next.learnedFrom.includes(run.id));
});

test("message compaction is bounded and preserves pending causal approvals", () => {
  let run = advance(
    createInitialRun("ransomware", 42, { autoDefend: false }),
    6,
  );
  run = applyAction(run, { type: "auto-defend", enabled: true });
  progressThreatCollaboration(run, "workstation-01");
  for (let index = 0; index < 250; index++)
    recordAgentReasoning(
      run,
      "nexus",
      `Bounded situational update ${index}: continue evidence monitoring.`,
    );
  compactHarnessContext(run);
  assert.ok(run.harness!.messages.length <= MAX_HARNESS_MESSAGES);
  assert.ok(run.harness!.compactedSummary.length <= MAX_HARNESS_SUMMARY_CHARS);
  assert.ok(run.harness!.contextCompactions > 0);
  assert.equal(
    canExecuteContainment(run, "workstation-01", "bastion").allowed,
    true,
  );
});
