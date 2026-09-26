import { z } from "zod";
import { advanceCampaign } from "@/lib/campaigns";
import { storageStatus } from "@/lib/db";
import { apiError, body, json, rateLimit, validId } from "../../../_shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    validId(id);
    const input = await body(
      request,
      z
        .object({ expectedRevision: z.number().int().min(0).optional() })
        .strict(),
    );
    await rateLimit(request, "campaign-advance", 240, 60);
    return json({
      campaign: await advanceCampaign(id, input.expectedRevision),
      storage: storageStatus(),
    });
  } catch (error) {
    return apiError(error);
  }
}
