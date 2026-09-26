import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPolicy, insertRun, listRuns, storageStatus } from "@/lib/db";
import { createInitialRun } from "@/lib/simulation";
import { apiError, body, json, rateLimit } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    scenarioId: z
      .enum(["ransomware", "supply-chain", "exfiltration"])
      .default("ransomware"),
    seed: z.number().int().min(0).max(2147483647).default(42),
    autoDefend: z.boolean().default(true),
    aiEnabled: z.boolean().default(false),
    useLearnedPolicy: z.boolean().default(true),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await body(request, createSchema);
    await rateLimit(request, "create", 40, 3600);
    const policy = input.useLearnedPolicy
      ? await getPolicy(input.scenarioId)
      : undefined;
    const run = createInitialRun(input.scenarioId, input.seed, {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      autoDefend: input.autoDefend,
      aiEnabled: input.aiEnabled,
      policy,
    });
    run.status = "running";
    await insertRun(run);
    return json({ run, storage: storageStatus() }, 201);
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(): Promise<Response> {
  try {
    return json({ runs: await listRuns(), storage: storageStatus() });
  } catch (error) {
    return apiError(error);
  }
}
