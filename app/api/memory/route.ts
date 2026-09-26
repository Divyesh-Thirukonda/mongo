import {
  listPolicies,
  listIncidentMemories,
  storageStatus,
  validateMemoryScope,
} from "@/lib/db";
import { apiError, json } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const scope = validateMemoryScope(
      new URL(request.url).searchParams.get("scope") ?? "shared",
    );
    const [policies, incidents] = await Promise.all([
      listPolicies(scope),
      listIncidentMemories(scope),
    ]);
    return json({
      policies,
      incidents,
      scope,
      track: "long-horizon-engineering",
      storage: storageStatus(),
    });
  } catch (error) {
    return apiError(error);
  }
}
