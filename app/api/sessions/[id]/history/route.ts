import { requireUser } from "@/lib/access";
import { historyActionSchema, requestHistoryAction } from "@/lib/history";
import { body, failure, json, validId } from "../../../_shared";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    validId(id);
    const input = await body(request, historyActionSchema);
    const user = await requireUser(request);
    return json(await requestHistoryAction(id, user, input));
  } catch (error) { return failure(error); }
}
