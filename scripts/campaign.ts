import type { Campaign } from "../lib/harness-types";

const args = process.argv.slice(2);
function value(flag: string, fallback?: string) {
  const at = args.indexOf(flag);
  if (at < 0) return fallback;
  const next = args[at + 1];
  if (!next || next.startsWith("--"))
    throw new Error(`Missing value for ${flag}`);
  return next;
}
const base = value("--base-url", "http://localhost:3000")!;
const limit = Number(value("--max-advances", "2000"));
const resume = value("--resume");
if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
  throw new Error("max-advances must be 1–5000");
async function request(path: string, body?: unknown) {
  const url = new URL(path, base);
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    });
  } catch (error) {
    throw Object.assign(
      error instanceof Error ? error : new Error("Campaign request failed"),
      { retryable: true },
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    // Gateways can return HTML, so preserve their HTTP status for retry policy.
    throw Object.assign(
      new Error(`Invalid API response (HTTP ${response.status})`),
      {
        status: response.ok ? undefined : response.status,
        retryable: response.ok,
      },
    );
  }
  if (!response.ok) {
    const error = Object.assign(
      new Error(result.error ?? `HTTP ${response.status}`),
      { status: response.status },
    );
    throw error;
  }
  if (result.storage?.mode !== "atlas" || !result.storage?.persisted)
    throw new Error("A durable campaign requires a verified Atlas connection.");
  return result.campaign as Campaign;
}
async function main() {
  // Creation is sent once: an uncertain response must not create a second campaign.
  let campaign = resume
    ? await request(`/api/campaigns/${encodeURIComponent(resume)}`)
    : await request("/api/campaigns", {
        scenarioId: value("--scenario", "ransomware"),
        seed: Number(value("--seed", "42")),
        episodes: Number(value("--episodes", "10")),
        memoryScope: value("--scope", "shared"),
        aiEnabled: args.includes("--ai"),
      });
  console.log(
    `Campaign ${campaign.id} | memory ${campaign.scope} | ${campaign.completedEpisodes}/${campaign.totalEpisodes}`,
  );
  console.log(`Resume with: npm run campaign -- --resume ${campaign.id}`);
  let failures = 0;
  for (let i = 0; i < limit && campaign.status !== "complete"; i++) {
    const completed = campaign.completedEpisodes;
    const submittedRevision = campaign.revision;
    let refreshRequired = false;
    while (true) {
      try {
        if (refreshRequired) {
          campaign = await request(`/api/campaigns/${campaign.id}`);
          refreshRequired = false;
          // The failed response may have followed a successful commit. Reconcile
          // that advancement without submitting the same logical tick again.
          if (
            campaign.status === "complete" ||
            campaign.revision !== submittedRevision
          ) {
            failures = 0;
            break;
          }
        }
        campaign = await request(`/api/campaigns/${campaign.id}/advance`, {
          expectedRevision: campaign.revision,
        });
        failures = 0;
        break;
      } catch (error) {
        const { status, retryable } = error as {
          status?: number;
          retryable?: boolean;
        };
        const transient =
          retryable === true || [409, 429, 502, 503, 504].includes(status ?? 0);
        if (!transient || ++failures > 6) throw error;
        // This remains set when the recovery GET itself fails. A POST is never
        // retried until a fresh checkpoint has been read successfully.
        refreshRequired = true;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            status === 429 ? 10000 : Math.min(5000, 500 * 2 ** failures),
          ),
        );
      }
    }
    if (campaign.completedEpisodes > completed) {
      const result = campaign.results.at(-1)!;
      console.log(JSON.stringify(result));
    }
  }
  console.log(
    JSON.stringify({
      campaignId: campaign.id,
      status: campaign.status,
      completed: campaign.completedEpisodes,
      total: campaign.totalEpisodes,
      scope: campaign.scope,
      revision: campaign.revision,
    }),
  );
  if (campaign.status !== "complete")
    console.log("Checkpoint saved. Resume with the command above.");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Campaign failed");
  process.exitCode = 1;
});
