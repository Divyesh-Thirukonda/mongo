import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceCampaign, startCampaign } from "../lib/campaigns";
import {
  getCampaign,
  getRun,
  listIncidentMemories,
  mutateCampaign,
  mutateRun,
  importIncidentMemories,
  getPolicy,
} from "../lib/db";
import { stepRun } from "../lib/simulation";

// Unit tests intentionally use the isolated process-local adapter; live Atlas is verified separately.
test("a ten-incident campaign learns, transfers a variant, and retains cited anticipation", async () => {
  let campaign = await startCampaign({
    memoryScope: "test-ten",
    episodes: 10,
    seed: 42,
  });
  for (let i = 0; i < 600 && campaign.status !== "complete"; i++)
    campaign = await advanceCampaign(campaign.id, campaign.revision);
  assert.equal(campaign.status, "complete");
  assert.equal(campaign.results.length, 10);
  assert.equal(new Set(campaign.runIds).size, 10);
  const first = campaign.results[0],
    second = campaign.results[1],
    seventh = campaign.results[6],
    tenth = campaign.results[9];
  assert.equal(first.recalled, 0);
  assert.ok(second.recalled > 0);
  assert.ok(second.integrity > first.integrity);
  assert.equal(seventh.variant, "lateral-shift");
  assert.ok(seventh.recalled > 0);
  assert.ok(tenth.anticipated);
  const memories = await listIncidentMemories(campaign.scope);
  assert.equal(memories.length, 10);
  assert.ok(
    memories.every(
      (m) =>
        m.narrative.howItHappened &&
        m.narrative.motive.hypothesis &&
        m.evidence.length,
    ),
  );
  assert.equal((await advanceCampaign(campaign.id)).results.length, 10);
});

test("resume reconciles a committed run tick after a lost campaign checkpoint", async () => {
  let campaign = await startCampaign({
    memoryScope: "test-resume",
    episodes: 1,
  });
  campaign = await advanceCampaign(campaign.id, 0);
  const id = campaign.activeRunId!;
  assert.equal(campaign.activeRunTick, 0);
  await mutateRun(id, stepRun);
  campaign = await advanceCampaign(campaign.id, campaign.revision);
  assert.equal(campaign.activeRunTick, 1);
  assert.equal(
    (await getRun(id))?.tick,
    1,
    "resumption must not repeat the interrupted advancement",
  );
  campaign = await advanceCampaign(campaign.id, campaign.revision);
  assert.equal((await getRun(id))?.tick, 2);
  await assert.rejects(
    () => advanceCampaign(campaign.id, 0),
    /checkpoint changed/,
  );
});

test("campaign leases exclude concurrent workers and release after failure", async () => {
  const campaign = await startCampaign({ memoryScope: "test-lock" });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const active = mutateCampaign(campaign.id, async (state) => {
    entered();
    await hold;
    return state;
  });
  await started;
  await assert.rejects(
    () => advanceCampaign(campaign.id),
    /already in progress/,
  );
  release();
  await active;
  await assert.rejects(
    () =>
      mutateCampaign(campaign.id, async () => {
        throw new Error("interrupted");
      }),
    /interrupted/,
  );
  await advanceCampaign(campaign.id);
  assert.ok((await getCampaign(campaign.id))?.activeRunId);
});

test("Git memory import is idempotent, immutable, and cannot promote a policy", async () => {
  let campaign = await startCampaign({
    memoryScope: "test-import-source",
    episodes: 1,
  });
  for (let i = 0; i < 60 && campaign.status !== "complete"; i++)
    campaign = await advanceCampaign(campaign.id);
  const [source] = await listIncidentMemories(campaign.scope);
  const imported = { ...source, scope: "test-import-destination" };
  assert.deepEqual(await importIncidentMemories([imported], imported.scope), {
    inserted: 1,
    existing: 0,
  });
  assert.deepEqual(await importIncidentMemories([imported], imported.scope), {
    inserted: 0,
    existing: 1,
  });
  await assert.rejects(
    () =>
      importIncidentMemories(
        [{ ...imported, outcome: "breached" }],
        imported.scope,
      ),
    /Conflicting/,
  );
  await assert.rejects(
    () =>
      importIncidentMemories(
        [
          { ...imported, id: "should-not-commit", runId: "should-not-commit" },
          { ...imported, outcome: "breached" },
        ],
        imported.scope,
      ),
    /Conflicting/,
  );
  assert.equal(
    (await listIncidentMemories(imported.scope)).length,
    1,
    "a rejected import cannot leave earlier records committed",
  );
  assert.equal(
    (await getPolicy(imported.scenarioId, imported.scope)).version,
    1,
  );
  assert.equal(
    (await listIncidentMemories(imported.scope))[0].outcome,
    source.outcome,
  );
});
