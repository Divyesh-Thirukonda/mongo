import { z } from "zod";
import { mutateRun, storageStatus, StoreError } from "@/lib/db";
import { consultAgents } from "@/lib/agents";
import { stepRun } from "@/lib/simulation";
import { apiError, body, json, rateLimit, validId } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    validId(id);
    const input = await body(
      request,
      z
        .object({ expectedTick: z.number().int().min(0).max(100).optional() })
        .strict(),
    );
    await rateLimit(request, "step", 100, 60);
    const run = await mutateRun(id, async (previous) => {
      if (
        input.expectedTick !== undefined &&
        previous.tick !== input.expectedTick
      )
        throw new StoreError(
          "The exercise advanced in another session. Refresh its state before stepping again.",
          409,
        );
      return consultAgents(stepRun(previous));
    });
    return json({ run, storage: storageStatus() });
  } catch (error) {
    return apiError(error);
  }
}
