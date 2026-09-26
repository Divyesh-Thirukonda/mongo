import { z } from "zod";
import { mutateRun, storageStatus, StoreError } from "@/lib/db";
import { applyAction } from "@/lib/simulation";
import { apiError, body, json, rateLimit, validId } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("isolate"), nodeId: z.string().min(1).max(60) })
    .strict(),
  z
    .object({ type: z.literal("restore"), nodeId: z.string().min(1).max(60) })
    .strict(),
  z
    .object({ type: z.literal("scan"), nodeId: z.string().min(1).max(60) })
    .strict(),
  z.object({ type: z.literal("auto-defend"), enabled: z.boolean() }).strict(),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    validId(id);
    const action = await body(request, actionSchema);
    await rateLimit(request, "action", 60, 60);
    const run = await mutateRun(id, (previous) => {
      try {
        return applyAction(previous, action);
      } catch (error) {
        throw new StoreError(
          error instanceof Error ? error.message : "Invalid defense action",
          400,
        );
      }
    });
    return json({ run, storage: storageStatus() });
  } catch (error) {
    return apiError(error);
  }
}
