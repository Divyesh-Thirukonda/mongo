import { getDatabaseHealth } from "@/lib/db";
import { aiConfiguration } from "@/lib/agents";
import { json } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return json({
    database: await getDatabaseHealth(),
    ai: aiConfiguration(),
    simulation: true,
  });
}
