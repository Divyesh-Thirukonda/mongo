import { createHash } from "node:crypto";
import { z } from "zod";
import { claimBudget, StoreError } from "@/lib/db";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const origin = request.headers.get("origin");
  // Next's dev proxy and deployment proxies rewrite Host; they retain the browser-facing host here.
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0].trim() ??
    request.headers.get("host") ??
    new URL(request.url).host;
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new StoreError("Invalid request origin.", 400);
    }
    if (originHost !== host)
      throw new StoreError(
        "Cross-origin simulation writes are not permitted.",
        403,
      );
  }
  const text = await request.text();
  if (text.length > 4096)
    throw new StoreError("Request body exceeds the 4 KB limit.", 413);
  try {
    return schema.parse(text ? JSON.parse(text) : {});
  } catch {
    throw new StoreError(
      "Invalid request. Check the scenario, action, or tick values.",
      400,
    );
  }
}

export async function rateLimit(
  request: Request,
  scope: string,
  limit = 100,
  window = 60,
): Promise<void> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const identity = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  if (!(await claimBudget(`${scope}:${identity}`, limit, window)))
    throw new StoreError(
      "Request limit reached. Please wait before trying again.",
      429,
    );
}

export function apiError(error: unknown): Response {
  return json(
    {
      error:
        error instanceof StoreError
          ? error.message
          : "The operation could not be completed. Check the service connection and retry.",
    },
    error instanceof StoreError ? error.status : 503,
  );
}

export function validId(id: string): void {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id))
    throw new StoreError("Invalid exercise ID", 400);
}
