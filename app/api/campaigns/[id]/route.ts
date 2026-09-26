import { getCampaign, storageStatus, StoreError } from "@/lib/db";
import { apiError, json, validId } from "../../_shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    validId(id);
    const campaign = await getCampaign(id);
    if (!campaign) throw new StoreError("Campaign not found", 404);
    return json({ campaign, storage: storageStatus() });
  } catch (error) {
    return apiError(error);
  }
}
