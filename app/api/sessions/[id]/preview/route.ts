import { requireUser, requireMembership, consumeRateLimit } from "@/lib/access";
import { database } from "@/lib/store";
import type { WebsitePreview } from "@/lib/website-preview";
import { json, failure, validId, validateWriteOrigin } from "../../../_shared";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    validateWriteOrigin(request);
    const { id } = await context.params;
    validId(id);
    const user = await requireUser(request);
    await requireMembership(id, user);
    await consumeRateLimit("preview-reads", user.id, 120, 60);
    const stored = await (await database()).collection<WebsitePreview & { _id: string; sessionId: string }>("cv_previews").findOne({ _id: id, sessionId: id });
    if (!stored) return json({ preview: null });
    const { _id, sessionId, ...preview } = stored;
    void _id; void sessionId;
    return json({ preview });
  } catch (error) { return failure(error); }
}
