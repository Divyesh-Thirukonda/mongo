import { z } from "zod";
import { startCampaign } from "@/lib/campaigns";
import { listCampaigns, storageStatus } from "@/lib/db";
import { apiError, body, json, rateLimit } from "../_shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return json({ campaigns: await listCampaigns(), storage: storageStatus() });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const input = await body(
      request,
      z
        .object({
          scenarioId: z
            .enum(["ransomware", "supply-chain", "exfiltration"])
            .default("ransomware"),
          seed: z.number().int().min(0).max(2147483647).default(42),
          episodes: z.number().int().min(1).max(30).default(10),
          aiEnabled: z.boolean().default(false),
          memoryScope: z
            .string()
            .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
            .default("shared"),
        })
        .strict(),
    );
    await rateLimit(request, "campaign-create", 10, 3600);
    return json(
      { campaign: await startCampaign(input), storage: storageStatus() },
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
