# Converge

Converge lets a team guide one coding agent without losing each other's requirements. Requests remain attributed, related requests are combined, and conflicting requirements wait for an explicit human decision.

Built for **Long Horizon Engineering**: durable intent, decisions, trajectories, recoverable source, bounded working context, and measured project checks in MongoDB Atlas.

## Try the shared app

Open [Converge](https://converge-codex.vercel.app), choose a guest name or sign in, and create a workspace. Share an invitation with another browser or use the native client's isolated guest window. Joining requires an explicit confirmation; knowing a workspace ID does not grant access. Guests can create an account or sign in later without losing their memberships.

The public Next.js app handles authentication and collaboration. MongoDB Atlas stores shared state. **Coding runs on a connected Mac worker**, using Codex and OpenRouter; Vercel does not execute generated code. The workspace reports worker availability. A connected worker is required for submitted intents to progress.

The public deployment has passed an HTTP check with two separate guest cookies, nonmember denial, invitation join, shared participants, and scoped Codex MCP context/progress calls. This is a functional demo, not a production security or endurance certification.

## Run locally

Requirements: macOS, Node.js 24+, npm, Git, a compatible installed Codex app-server, OpenRouter access, and the provisioned MongoDB Atlas sandbox. Atlas must allow the worker's network address and support transactions and collection/index creation.

```sh
npm ci
node node_modules/electron/install.js
git submodule update --init vendor/codex
cp .env.example .env.local
```

Set the external environment file:

| Variable | Used by |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DB` | API and worker; the sandbox uses database `aegis` with separate `cv_` collections |
| `BETTER_AUTH_SECRET` | API only; generate at least 32 random characters |
| `BETTER_AUTH_URL` | API's exact origin; local default `http://127.0.0.1:3000` |
| `CONVERGE_PUBLIC_URL` | Optional canonical invitation origin; set to the public HTTPS origin when sharing online |
| `OPENROUTER_API_KEY` | Worker only; never needed by the public frontend/API deployment |
| `OPENROUTER_MODEL`, `CONVERGE_CODE_MODEL` | Worker routing and coding models respectively |
| `CONVERGE_CODEX_BINARY` | Optional worker executable; defaults to `/Applications/ChatGPT.app/Contents/Resources/codex` |

Use models available to your OpenRouter account and compatible with the selected API. Credentials stay out of the renderer, source control, and packaged application.

```sh
npm run desktop
```

The native launcher starts a loopback server and worker. Alternatively, run `npm run dev` and `npm run worker` in separate terminals, then open [the local workspace](http://127.0.0.1:3000).

To use the public UI with a local worker, point both services at the same Atlas database. Run `npm run worker` locally, or launch the native client with `CONVERGE_APP_URL=https://converge-codex.vercel.app npm run desktop`. That native mode opens the HTTPS app and starts its worker without starting a local web server. Set `BETTER_AUTH_URL` and `CONVERGE_PUBLIC_URL` to the canonical HTTPS origin in the Vercel deployment, alongside Atlas credentials and `BETTER_AUTH_SECRET`.

## Collaborative demo

1. Create a workspace and ask for a website, game, module, or another coding task.
2. Share an invitation and join as another guest. Add a related requirement while the worker runs; it steers the same coding thread.
3. Add a contradictory requirement. Both requests remain attributed and work stops for a human choice.
4. Review the generated **Preview**, source diff and project checks in **Changes**, and the recorded **Activity** graph.
5. Select a graph node and use **Change this step** to correct a decision. Use **Restore this checkpoint** to return to saved files and decisions without erasing history.
6. Run `npm run verify:recovery` for a repeatable, no-inference restart proof: one process saves a temporary workspace, another starts with an empty local directory and restores from Atlas. It compares source hashes, intent/decision records, trajectory persistence, and a new authenticated connection's checkpoint/conflict access. It cleans its own records. See `docs/verified-recovery.json` for the last result.

New workspaces have a neutral starter. Existing untouched legacy starter instructions are upgraded without deleting generated code. The available execution environment supports local JavaScript/TypeScript and Node tests; external services and dependency installation remain unavailable to the sandbox. Missing capabilities must be reported honestly.

**Preview** bundles the workspace's `index.html` (or `public/index.html`) with local JavaScript, TypeScript, CSS, and SVG assets. It is interactive, refreshes as the worker saves files, and is shared through Atlas. It runs in an isolated iframe without access to session cookies or external connections. It does not start arbitrary application servers or install dependencies; unsupported imports show an actionable error. Source stays in `.converge/workspaces/<session-id>` on the worker (or `CONVERGE_DATA_DIR/workspaces/<session-id>`).

**Connect Codex** issues a workspace-scoped MCP credential that expires after seven days. It exposes authentication/status, shared context, saved checkpoint files, changes, and progress reporting to an external Codex client; it cannot impersonate a human intent submission. The Mac app can add the connection to Codex directly; browser users copy the setup command. The companion skill is in `integrations/codex-plugin/converge`. Treat the connection command and invitation URL as private access links.

## Execution and limits

- A dedicated Codex app-server edits a per-session local repository. Agent tools have sandboxed workspace access, no network, no external MCP tools, and no approval bypass.
- OpenRouter supplies real routing/coding inference. Routing can explicitly fall back to conservative rules; coding errors remain visible.
- Better Auth provides cookie-based anonymous and email/password identities. Every workspace API checks membership. Email verification and password recovery are not configured for this demo.
- Atlas preserves intents, final trajectory items, checkpoints, and source manifests. Legacy sessions without memberships stay unlisted.
- History actions use membership checks, idempotency keys, and revision checks. A pending restore blocks concurrent mutations, retains its original recovery point across restarts, and clears the prior Codex thread so stale working context cannot overwrite the restored direction.
- Source checkpoints include supported root web files and text files in `src`, `tests`, `public`, and `assets`, with a 40-file / 1 MB limit. Unsupported files inside those directories fail capture rather than silently disappearing. Secrets, symlinks, and invalid paths are rejected.
- Project tests run in a bounded, read-only sandbox and HTML previews are compiled when present. Passing checks pause the session for human review; project-authored tests do not automatically fulfill every intent.
- Working context is capped at 16,000 characters and 64 active requirements. Mandatory requirements that cannot fit stop execution instead of being dropped.
- Each fixed hour admits at most **30 routing/turn operations per workspace, 60 per owner, and 100 across the database**, reserved atomically. These are admission limits, not token, dollar, or provider-subrequest caps. API/auth limits also apply; exhausted work remains saved for a later resume.

## Codex source and validation

The [Codex fork](https://github.com/Divyesh-Thirukonda/codex-converge) is pinned as `vendor/codex` at `d57fc7e6c298e6191f4cb8e4e096942edc2b4032`. The app launches the installed compatible runtime through `lib/codex-bridge.ts`; it has not rebuilt that fork into the running binary.

```sh
npm run typecheck
npm test
npm run verify:recovery
npm run build
npm run desktop:package
```

`npm test` includes auth projections, origin checks, transport isolation, revision/context behavior, source recovery, and sandboxed project verification. Optional Atlas integration tests exercise real account linking and atomic budget contention; they create and clean up their own records without model calls:

```sh
CONVERGE_AUTH_INTEGRATION=1 node --conditions=react-server --env-file=.env.local --import tsx --test tests/auth-isolation.test.ts
CONVERGE_BUDGET_INTEGRATION=1 node --conditions=react-server --env-file=.env.local --import tsx --test tests/model-budget.test.ts
CONVERGE_ATLAS_HISTORY_TEST=1 node --conditions=react-server --env-file=.env.local --import tsx --test tests/history-integration.test.ts
```

Packaging produces `dist/Converge-darwin-arm64/Converge.app`, an unsigned local Apple Silicon demo. Use `CONVERGE_APP_URL` during packaging for the public UI; the bundle includes its worker and trusted fixture/verifier. Credentials and workspaces remain external; `CONVERGE_ENV_FILE` and `CONVERGE_DATA_DIR` override their locations. Codex itself is not bundled.

See [the architecture](docs/ARCHITECTURE.md) for access boundaries and recovery. Automated project checks provide evidence, not proof of arbitrary application correctness. No billion-token endurance result is claimed. The earlier AEGIS application remains in Git tag `archive/aegis-final`.

## New Codex tasks and unattended conflicts

An invitation joins the Converge web workspace. It does **not** authenticate Codex automatically: each collaborator uses **Connect Codex** after joining. A fresh task using that connection reads the same Atlas workspace with `read_shared_context`, `check_status`, and `read_checkpoint`; it does not need the earlier task's in-memory conversation.

The plugin checks status before edit batches and waits on blocked conflicts, pauses, restores, and active managed work. If nobody is present, it leaves the decision blocked. Shared API routes enforce membership and worker leases/revision checks; connected agents cannot write managed files, resolve human conflicts, or certify completion. A status check is not a filesystem lock. Local Codex command permissions still belong to that Codex task, so this is not a guarantee that arbitrary local commands are intercepted.
