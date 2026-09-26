# AEGIS — the agent cyber range

A 3D security operations building backed by a **Long Horizon Engineering** harness. Five specialist defenders share evidence, request containment approval, and carry incident memory into the next attack. A resumable ten-attack campaign measures adaptation across recurring attacks and new variants. The architectural interface stays focused on watching and inspecting the war room.

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

1. Orbit and zoom around the building. Toggle **Exploded floors** and **Cutaway**, switch to the top-down camera, or select a level in the campus plan. The bottom toolbar reveals network links, agents, and threat paths.
2. Select **Ransomware outbreak (Operation Blackout)**, turn **Use learned policy** off, and launch an exercise. Five specialists detect, classify, trace, contain, and coordinate the intrusion. Click a room or agent to inspect it. Scan or isolate assets from the inspector; isolation protects neighbors but lowers availability. Select **Manual** defense to see the cost of delayed intervention.
3. Let the incident finish. Scrub the timeline to inspect previous network states and open the incident archive to revisit the run.
4. Open **Agent memory**. The harness evaluates the current and proposed policy on the incident seed plus two held-out seeds. A candidate must improve the mean score without regressing on any tested seed.
5. Launch the same scenario with learned policy enabled. Compare the response time, integrity, and number of affected assets. Toggle **AI reasoning** for live model analysis and bounded defensive decisions.

With seed 42, AI disabled, and no human intervention, the verified first adaptation produces:

| Scenario           | Baseline integrity | Adapted integrity | First response |
| ------------------ | -----------------: | ----------------: | -------------- |
| Operation Blackout |                90% |               96% | 10s → 4s       |
| Ghost in the Build |                85% |               96% | 10s → 4s       |
| Silent Siphon      |                92% |               97% | 10s → 4s       |

These are simulation measurements, not claims about real-world security effectiveness. The harness adapts a small, explicit defense policy; it does not retrain model weights or rewrite application code.

## Ten attacks, one persistent memory

With the development server running and Atlas connected:

```sh
npm run campaign -- --episodes 10 --scope shared --seed 42
```

The command prints a campaign ID and a resume command. Stop it at any point and resume from another process or machine connected to the same Atlas database:

```sh
npm run campaign -- --resume <campaign-id>
```

Attack 1 establishes the first incident report. Later attacks retrieve relevant evidence and the locally evaluated policy. Attack 7 changes the entry point and propagation timing. Attack 10 introduces delayed detection and slower propagation. Anticipation activates only after recalling three successful incidents with cited entry-and-defense evidence; episode number alone cannot enable it.

The [verified Atlas campaign](docs/verified-campaign.json) completed all ten incidents, including a server restart at checkpoint revision 20:

| Attack | Behavior                                           | Integrity | First response |
| ------ | -------------------------------------------------- | --------: | -------------: |
| 1      | No prior incident memory                           |       90% |            10s |
| 2      | Recalls attack 1; evaluated policy v2              |       96% |             4s |
| 7      | Transfers prior defense to lateral-shift variant   |       97% |             2s |
| 10     | Evidence-backed anticipation; low-and-slow variant |       97% |             2s |

These campaign episodes use different seeds. The per-incident evaluator separately compares baseline and candidate on matched seeds. This run used deterministic specialists; a separate live OpenRouter check verified the model council with retrieved memory and current handoffs.

Each report records the observed intrusion, uncertain motive hypotheses, outcome, successful defenses, failures, next actions, recalled source IDs, metrics, and evaluation evidence. Atlas retains the archive while each agent receives a bounded context. An explicit worker advances the campaign; closing it saves progress rather than leaving an invisible background job running.

Share the learned incident history through this repository:

```sh
npm run memory:export -- --scope shared --push
# On a teammate's machine, after pulling and reviewing the bundle:
npm run memory:import -- --scope shared
```

Imported reports inform recall. Imported policy recommendations never become active automatically. See [harness design](docs/HARNESS.md) and [Git memory sharing](docs/MEMORY-SHARING.md) for the protocols and trust boundaries.

## Architecture

```text
Next.js + React Three Fiber war room
       │ validated same-origin HTTP requests
       ▼
Next.js route handlers ──► optional OpenRouter council
       │                       │ validated isolate / scan / monitor
       ▼                       ▼
Seeded graph simulation + evidence-linked specialist handoffs
       │
       ├──► Atlas runs: canonical snapshots, events, metrics, replay
       ├──► Atlas events: searchable evidence projection
       ├──► Atlas incident memories ──► bounded recall ──► next exercise
       ├──► Three-seed evaluator ──► Atlas policies ──► next exercise
       └──► Atlas campaign checkpoints + portable Git memory bundles
```

- `lib/simulation.ts` contains pure, seeded transition functions. Three attack scenarios propagate across a twelve-asset graph, with deterministic detection, containment, damage, availability, and evidence generation. A tick represents two simulated seconds.
- `components/war-room-scene.tsx` renders the campus with React Three Fiber, instanced server equipment, animated floor transitions, moving agents, and network packets. `lib/building-layout.ts` maps the twelve network assets to physical rooms. `hooks/use-war-room.ts` serializes simulation commands and protects the client against stale responses. Replay shows historical room states and communications; agent positions are shown only in the current view.
- `lib/war-room-harness.ts` enforces Sentinel observation → Cipher assessment → Trace evidence handoff → Bastion containment proposal → Nexus approval → Bastion execution. Every stage references current incident evidence and its preceding message. Historical memory cannot authorize isolation.
- `lib/agents.ts` calls OpenRouter from the server. JSON Schema plus Zod validate one to three decisions; the harness then enforces role-specific tools and the same containment approval gate. The optional council uses one model request to produce specialist recommendations, not five independent model processes.
- `lib/db.ts` stores full runs, incident reports, policies, campaign checkpoints, and rate-limit counters. Per-run and per-campaign leases exclude concurrent mutations. A terminal incident's memory, policy update, and learned marker commit in one Atlas transaction; reads repair interrupted finalization.
- Policy improvement compares baseline and candidate rollouts on the same scenario and variant across three seeds. The score is `0.65 × integrity + 0.35 × uptime − 0.1 × exfiltratedMB − 30 if breached`. Each evaluation records all three cases; promotion requires a mean gain and no per-seed regression.
- Standalone runs and the searchable event projection expire after seven days. Campaign runs, campaign checkpoints, incident memories, and policies persist. Canonical campaign runs retain their event evidence independently of the projection.

## API

All run responses include `{run, storage: {mode, persisted}}`; `persisted: true` is returned only after successful Atlas operations.

| Method | Endpoint                     | Purpose                                                                                                                         |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`                | Actual database connection state and AI configuration                                                                           |
| `POST` | `/api/runs`                  | Create a run; accepts `scenarioId`, `seed`, `autoDefend`, `aiEnabled`, `useLearnedPolicy`, optional `variant` and `memoryScope` |
| `GET`  | `/api/runs`                  | Most recent 20 runs                                                                                                             |
| `GET`  | `/api/runs/:id`              | Full state, metrics, events, and replay                                                                                         |
| `POST` | `/api/runs/:id/step`         | Advance once; optionally require `expectedTick`                                                                                 |
| `POST` | `/api/runs/:id/action`       | `{type: "isolate" \| "restore" \| "scan", nodeId}` or `{type: "auto-defend", enabled}`                                          |
| `GET`  | `/api/memory?scope=shared`   | Policies, incident narratives, metrics, and evaluation evidence                                                                 |
| `POST` | `/api/campaigns`             | Create a campaign; accepts `scenarioId`, `seed`, `episodes`, `aiEnabled`, `memoryScope`                                         |
| `GET`  | `/api/campaigns/:id`         | Read the durable campaign checkpoint                                                                                            |
| `POST` | `/api/campaigns/:id/advance` | Advance one checkpoint; accepts `expectedRevision` for conflict detection                                                       |

AI is off by default. When enabled, it is consulted every four ticks, at most four times per exercise and forty times per hour across the deployment. Each request is capped at 1,600 completion tokens and ten seconds. Failed, unavailable, or invalid model responses leave the deterministic defenders active and report the fallback honestly. OpenRouter model availability was checked against its public models endpoint; the model can be overridden through the environment.

The current demo is a shared synthetic workspace without account authentication. It is intended for a controlled hackathon demonstration. A production training service would additionally require tenant isolation, authentication, per-user budgets, and broader policy evaluation across held-out scenarios.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

Tests cover deterministic replay, outcomes, policy evaluation, evidence-chain and tool-permission enforcement, context compaction, relevant recall, anticipation support, campaign crash recovery, concurrent workers, immutable imports, credential rejection, and bundle integrity. The campaign command requires verified Atlas persistence and refuses session-only storage. The project demonstrates bounded coherent memory over repeated incidents; it has not been tested at billions of tokens or weeks of continuous operation.

Useful references: [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs), and [OpenRouter reasoning budgets](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
