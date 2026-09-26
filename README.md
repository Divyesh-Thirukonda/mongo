# AEGIS — the agent cyber range

A 3D incident command room where five specialist defenders contain a synthetic cyber attack, preserve an evidence trail, and improve their next response through a counterfactual evaluation harness.

The network is a simulation. AEGIS does not scan real hosts, run exploits, or modify production infrastructure. The named agent roles are deterministic specialists by default. The optional live council uses a real OpenRouter model and can choose constrained actions on simulated assets.

## Run locally

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Add these **server-only** environment variables to `.env.local`:

```dotenv
MONGODB_URI=mongodb+srv://<database-user>:<password>@<sandbox-host>/?retryWrites=true&w=majority
MONGODB_DB=aegis
OPENROUTER_API_KEY=<your-key>
OPENROUTER_MODEL=google/gemini-3.8-flash
```

Use the provisioned Atlas sandbox in the [project organization](https://cloud.mongodb.com/v2#/org/69ef9daf03d2ce35c2657862/projects). Its connection string must identify that sandbox; the organization URL alone is not a database connection string. Configure a database user with read/write access to the application database and permit the application's connection source in Atlas network access. Never commit `.env.local` or expose either credential through `NEXT_PUBLIC_` variables.

`GET /api/health` verifies the actual Atlas connection. Without a URI, the app explicitly reports **session memory only**. With a URI that cannot connect, writes fail visibly instead of silently switching to memory. The in-memory fallback is for local exploration; it does not provide durable or shared storage on serverless deployments.

## The demo

1. Select **Ransomware outbreak (Operation Blackout)**, turn **Use learned defense policy** off, and launch an exercise. Five specialists detect, classify, trace, contain, and coordinate the intrusion.
2. Click an asset to inspect it, scan it, or isolate it. Isolation protects neighboring assets but lowers availability. Disable autonomous defense to see the cost of delayed intervention.
3. Let the incident finish. Scrub the timeline to inspect previous network states and open the incident archive to revisit the run.
4. Open **Agent memory**. The harness replays the incident seed with the current policy and a proposed policy, scores integrity and uptime, and promotes the candidate only if it improves the result.
5. Launch the same scenario with learned policy enabled. Compare the response time, integrity, and number of affected assets. Toggle **AI reasoning** for live model analysis and bounded defensive decisions.

With seed 42, AI disabled, and no human intervention, the verified first adaptation produces:

| Scenario           | Baseline integrity | Adapted integrity | First response |
| ------------------ | -----------------: | ----------------: | -------------- |
| Operation Blackout |                90% |               96% | 10s → 4s       |
| Ghost in the Build |                85% |               96% | 10s → 4s       |
| Silent Siphon      |                92% |               97% | 10s → 4s       |

These are simulation measurements, not claims about real-world security effectiveness. The harness adapts a small, explicit defense policy; it does not retrain model weights or rewrite application code.

## Architecture

```text
Next.js + React Three Fiber war room
       │ validated same-origin HTTP requests
       ▼
Next.js route handlers ──► optional OpenRouter council
       │                       │ validated isolate / scan / monitor
       ▼                       ▼
Seeded graph simulation + five defender roles
       │
       ├──► Atlas runs: canonical snapshots, events, metrics, replay
       ├──► Atlas events: searchable evidence projection
       └──► Counterfactual evaluator ──► Atlas policies ──► next exercise
```

- `lib/simulation.ts` contains pure, seeded transition functions. Three attack scenarios propagate across a twelve-asset graph, with deterministic detection, containment, damage, availability, and evidence generation. A tick represents two simulated seconds.
- `lib/agents.ts` calls OpenRouter from the server. JSON Schema plus Zod validate one to three decisions. The model may scan known assets or isolate detected compromised assets when autonomous defense is enabled. All other behavior stays inside the simulation.
- `lib/db.ts` stores full runs and replay snapshots, evidence, learned policies, and rate-limit counters in MongoDB. Cached connection pooling supports serverless reuse. Per-run leases and expected-tick checks prevent concurrent steps from advancing the same state twice.
- Policy improvement compares two bounded rollouts of the same scenario and seed. The score is `0.65 × integrity + 0.35 × uptime − 0.1 × exfiltratedMB − 30 if breached`. Each accepted revision stores its source incident, tested scores, and integrity measurements.
- Run and event documents expire after seven days. Policy documents persist. The canonical run document includes its complete event evidence; the separate evidence projection and policy update follow the guarded snapshot commit and are idempotent, but are not one multi-document transaction.

## API

All run responses include `{run, storage: {mode, persisted}}`; `persisted: true` is returned only after successful Atlas operations.

| Method | Endpoint               | Purpose                                                                                   |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`          | Actual database connection state and AI configuration                                     |
| `POST` | `/api/runs`            | Create a run; accepts `scenarioId`, `seed`, `autoDefend`, `aiEnabled`, `useLearnedPolicy` |
| `GET`  | `/api/runs`            | Most recent 20 runs                                                                       |
| `GET`  | `/api/runs/:id`        | Full state, metrics, events, and replay                                                   |
| `POST` | `/api/runs/:id/step`   | Advance once; optionally require `expectedTick`                                           |
| `POST` | `/api/runs/:id/action` | `{type: "isolate" \| "restore" \| "scan", nodeId}` or `{type: "auto-defend", enabled}`    |
| `GET`  | `/api/memory`          | Current scenario policies and evaluation evidence                                         |

AI is off by default. When enabled, it is consulted every four ticks, at most four times per exercise and forty times per hour across the deployment. Each request is capped at 1,600 completion tokens and ten seconds. Failed, unavailable, or invalid model responses leave the deterministic defenders active and report the fallback honestly. OpenRouter model availability was checked against its public models endpoint; the model can be overridden through the environment.

The current demo is a shared synthetic workspace without account authentication. It is intended for a controlled hackathon demonstration. A production training service would additionally require tenant isolation, authentication, per-user budgets, and broader policy evaluation across held-out scenarios.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

The engine tests cover deterministic replay, immutable transitions, all three defended and undefended outcomes, measured policy improvement, deduplicated learning, intervention effects, invalid actions, terminal-state behavior, and snapshot consistency. API verification additionally covers create/read/step/action, invalid input, simultaneous step conflicts, same-origin browser requests, and a real OpenRouter response with applied simulated defensive actions.

Useful references: [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs), and [OpenRouter reasoning budgets](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
