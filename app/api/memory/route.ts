import { listPolicies, storageStatus } from "@/lib/db";
import { apiError, json } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return json({ policies: await listPolicies(), storage: storageStatus() });
  } catch (error) {
    return apiError(error);
  }
}
