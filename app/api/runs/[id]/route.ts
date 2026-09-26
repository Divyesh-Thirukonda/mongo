import { getRun, storageStatus, StoreError } from "@/lib/db";
import { apiError, json, validId } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    validId(id);
    const run = await getRun(id);
    if (!run) throw new StoreError("Exercise not found", 404);
    return json({ run, storage: storageStatus() });
  } catch (error) {
    return apiError(error);
  }
}
