import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAction,
  createInitialRun,
  derivePolicy,
  stepRun,
} from "../lib/simulation";
import { SCENARIOS } from "../lib/scenarios";
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

test("the same seed and actions reproduce the whole incident", () => {
  const one = finish(createInitialRun("ransomware", 93));
  const two = finish(createInitialRun("ransomware", 93));
  assert.deepEqual(one, two);
  assert.equal(one.status, "contained");
  assert.ok(one.events.some((event) => event.kind === "attack"));
  assert.ok(one.events.some((event) => event.kind === "defense"));
});

test("transitions do not mutate earlier snapshots", () => {
  const initial = createInitialRun();
  const copy = structuredClone(initial);
  const next = stepRun(initial);
  assert.deepEqual(initial, copy);
  assert.equal(next.tick, 1);
  assert.equal(
    next.nodes.filter((node) => node.status === "compromised").length,
    1,
  );
  assert.ok(initial.nodes.every((node) => node.status === "healthy"));
});

for (const scenario of SCENARIOS) {
  test(`${scenario.id}: autonomous defenders preserve more integrity than no defense`, () => {
    const defended = finish(createInitialRun(scenario.id, 42));
    const undefended = finish(
      createInitialRun(scenario.id, 42, { autoDefend: false }),
    );
    assert.equal(defended.status, "contained");
    assert.equal(undefended.status, "breached");
    assert.ok(defended.metrics.integrity > undefended.metrics.integrity);
    assert.ok(
      undefended.nodes.some(
        (node) => node.zone === "core" && node.compromisedAt !== undefined,
      ),
    );
  });

  test(`${scenario.id}: evidence changes the next policy and improves measured outcome`, () => {
    const baseline = finish(
      createInitialRun(scenario.id, 42, { id: `baseline-${scenario.id}` }),
    );
    const policy = derivePolicy(baseline);
    const adapted = finish(
      createInitialRun(scenario.id, 42, {
        id: `adapted-${scenario.id}`,
        policy,
      }),
    );
    assert.equal(policy.version, 2);
    assert.equal(policy.isolationDelay, 2);
    assert.equal(policy.evidence?.evaluation?.accepted, true);
    assert.ok(
      policy.evidence!.evaluation!.candidateScore >
        policy.evidence!.evaluation!.baselineScore,
    );
    assert.equal(adapted.status, "contained");
    assert.ok(
      adapted.metrics.integrity > baseline.metrics.integrity,
      `${adapted.metrics.integrity} should exceed ${baseline.metrics.integrity}`,
    );
    assert.ok(adapted.metrics.responseTime < baseline.metrics.responseTime);
    assert.ok(
      adapted.nodes.filter((node) => node.compromisedAt !== undefined).length <
        baseline.nodes.filter((node) => node.compromisedAt !== undefined)
          .length,
    );
    assert.deepEqual(
      derivePolicy(baseline, policy),
      policy,
      "reprocessing one run must not duplicate learning",
    );
  });
}

test("isolation blocks propagation and has a visible availability cost", () => {
  let run = stepRun(createInitialRun("ransomware", 42, { autoDefend: false }));
  run = applyAction(run, { type: "isolate", nodeId: "workstation-01" });
  assert.equal(
    run.nodes.find((node) => node.id === "workstation-01")?.status,
    "isolated",
  );
  assert.ok(run.metrics.uptime < 100);
  for (let count = 0; count < 5; count++) run = stepRun(run);
  assert.equal(run.metrics.compromised, 0);
  assert.equal(
    run.nodes.filter((node) => node.compromisedAt !== undefined).length,
    1,
  );
});

test("invalid assets and impossible restoration are rejected", () => {
  const run = createInitialRun();
  assert.throws(
    () => applyAction(run, { type: "isolate", nodeId: "external-host" }),
    /Unknown/,
  );
  assert.throws(
    () => applyAction(run, { type: "restore", nodeId: "database" }),
    /Only isolated/,
  );
});

test("manual interventions replace the tick snapshot so replay includes the latest state", () => {
  let run = stepRun(createInitialRun());
  run = applyAction(run, { type: "scan", nodeId: "workstation-01" });
  run = applyAction(run, { type: "isolate", nodeId: "workstation-01" });
  assert.equal(
    run.snapshots.filter((snapshot) => snapshot.tick === 1).length,
    1,
  );
  assert.equal(run.history.filter((point) => point.tick === 1).length, 1);
  assert.equal(
    run.snapshots.at(-1)?.nodes.find((node) => node.id === "workstation-01")
      ?.status,
    "isolated",
  );
  assert.equal(run.snapshots.at(-1)?.metrics.uptime, run.metrics.uptime);
});

test("terminal runs cannot advance or accept interventions", () => {
  const run = finish(createInitialRun());
  assert.deepEqual(stepRun(run), run);
  assert.throws(
    () => applyAction(run, { type: "scan", nodeId: "database" }),
    /ended/,
  );
});

test("replay history and risk values remain bounded for a whole exercise", () => {
  const run = finish(
    createInitialRun("supply-chain", 88, { autoDefend: false }),
  );
  assert.ok(run.snapshots.length <= 50);
  for (const entry of run.snapshots)
    for (const node of entry.nodes) {
      assert.ok(node.health >= 0 && node.health <= 100);
      assert.ok(node.risk >= 0 && node.risk <= 100);
    }
  assert.equal(run.snapshots.at(-1)?.tick, run.tick);
});
