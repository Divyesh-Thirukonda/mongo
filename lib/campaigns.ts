import "server-only";
import { randomUUID } from "node:crypto";
import { consultAgents } from "./agents";
import {
  getPolicy,
  getRun,
  insertCampaign,
  insertRun,
  recallCandidates,
  mutateCampaign,
  mutateRun,
  StoreError,
  validateMemoryScope,
} from "./db";
import { recallMemories } from "./incident-memory";
import { createInitialRun, stepRun } from "./simulation";
import type { Campaign, IncidentVariant } from "./harness-types";
import type { ScenarioId, SimulationRun } from "./types";

export function campaignVariant(episode: number): IncidentVariant {
  return episode < 7
    ? "original"
    : episode < 10
      ? "lateral-shift"
      : "low-and-slow";
}

export async function prepareRun(input: {
  scenarioId: ScenarioId;
  seed: number;
  id?: string;
  autoDefend?: boolean;
  aiEnabled?: boolean;
  useLearnedPolicy?: boolean;
  variant?: IncidentVariant;
  memoryScope?: string;
  campaign?: { id: string; episode: number };
}): Promise<SimulationRun> {
  const scope = validateMemoryScope(input.memoryScope ?? "shared");
  const variant = input.variant ?? "original";
  const learn = input.useLearnedPolicy ?? true;
  const [policy, memories] = await Promise.all([
    learn ? getPolicy(input.scenarioId, scope) : undefined,
    learn ? recallCandidates(scope, input.scenarioId) : [],
  ]);
  const run = createInitialRun(input.scenarioId, input.seed, {
    id: input.id ?? randomUUID(),
    createdAt: new Date().toISOString(),
    autoDefend: input.autoDefend ?? true,
    aiEnabled: input.aiEnabled ?? false,
    policy,
    variant,
    memoryScope: scope,
    campaign: input.campaign,
    recall: recallMemories(memories, input.scenarioId, variant),
  });
  run.status = "running";
  return run;
}

export async function startCampaign(input: {
  scenarioId?: ScenarioId;
  seed?: number;
  episodes?: number;
  aiEnabled?: boolean;
  memoryScope?: string;
}): Promise<Campaign> {
  const now = new Date().toISOString();
  const campaign: Campaign = {
    id: randomUUID(),
    scope: validateMemoryScope(input.memoryScope ?? "shared"),
    scenarioId: input.scenarioId ?? "ransomware",
    status: "running",
    totalEpisodes: input.episodes ?? 10,
    completedEpisodes: 0,
    runIds: [],
    seed: input.seed ?? 42,
    aiEnabled: input.aiEnabled ?? false,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    results: [],
  };
  if (
    !Number.isInteger(campaign.totalEpisodes) ||
    campaign.totalEpisodes < 1 ||
    campaign.totalEpisodes > 30
  )
    throw new StoreError("Campaigns support 1–30 episodes", 400);
  await insertCampaign(campaign);
  return campaign;
}

/** One durable tick per request: a worker can stop, restart, or resume on another machine. */
export async function advanceCampaign(
  id: string,
  expectedRevision?: number,
): Promise<Campaign> {
  return mutateCampaign(id, async (campaign) => {
    if (
      expectedRevision !== undefined &&
      campaign.revision !== expectedRevision
    )
      throw new StoreError(
        "Campaign checkpoint changed; refresh before advancing",
        409,
      );
    if (campaign.status === "complete") return campaign;
    const episode = campaign.completedEpisodes + 1;
    const runId = campaign.activeRunId ?? `${campaign.id}-e${episode}`;
    let run = await getRun(runId);
    if (!run) {
      run = await prepareRun({
        id: runId,
        scenarioId: campaign.scenarioId,
        seed: (campaign.seed + (episode - 1) * 37) % 2147483647,
        variant: campaignVariant(episode),
        memoryScope: campaign.scope,
        campaign: { id: campaign.id, episode },
        aiEnabled: campaign.aiEnabled,
      });
      await insertRun(run);
    } else if (
      campaign.activeRunId &&
      run.tick <= (campaign.activeRunTick ?? 0) &&
      run.status !== "contained" &&
      run.status !== "breached"
    ) {
      run = await mutateRun(run.id, (previous) =>
        consultAgents(stepRun(previous)),
      );
    }
    campaign.activeRunId = run.id;
    campaign.activeRunTick = run.tick;
    if (!campaign.runIds.includes(run.id)) campaign.runIds.push(run.id);
    if (run.status === "contained" || run.status === "breached") {
      // getRun repairs an interrupted memory finalization before this checkpoint advances.
      if (!run.learned) run = (await getRun(run.id))!;
      if (!run.learned)
        throw new StoreError(
          "Incident memory is not committed yet; retry this checkpoint",
          409,
        );
      campaign.results.push({
        episode,
        runId: run.id,
        variant: run.variant ?? "original",
        integrity: run.metrics.integrity,
        responseTime: run.metrics.responseTime,
        outcome: run.status,
        recalled: run.harness?.recall.matches.length ?? 0,
        anticipated: run.harness?.recall.anticipate ?? false,
        policyVersion: run.policy.version,
      });
      campaign.completedEpisodes = episode;
      delete campaign.activeRunId;
      delete campaign.activeRunTick;
      if (episode >= campaign.totalEpisodes) campaign.status = "complete";
    }
    campaign.revision++;
    campaign.updatedAt = new Date().toISOString();
    return campaign;
  });
}
