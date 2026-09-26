# Converge

Converge lets a team guide one coding agent without losing each other's requirements. One person asks for a Stripe product catalog; another asks for `NEW` labels on the three latest products. The harness preserves both authors, identifies the dependency, and steers Codex toward the combined implementation. Conflicting requirements wait for an explicit decision.

Built for the **Long Horizon Engineering** track: attributed intent, live steering, protected verification, bounded working context, and recoverable source checkpoints. The workspace shows actual agent events, changes, checks, and Atlas state.

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

1. Create a workspace and submit “Connect Stripe and display the product catalog”.
2. Share an invitation. Join with a second guest identity in another browser or the native guest window.
3. Submit “Add NEW to the 3 most recently added Stripe products”. The worker sends `turn/steer` if the first turn is active; otherwise it continues the same coding thread.
4. Open **Preview** for the actual generated website. **Changes** contains source diffs and protected checks.
5. Submit “Remove all NEW badges” to exercise conflict arbitration. Choose which direction to keep; both original requests remain in the ledger.
6. Inspect **Memory**, pause, and resume. Atlas checkpoints preserve requirements and the controlled source manifest across worker restarts.
7. Select a node in **Activity**, open **Change this step**, and describe a correction. The new direction retains its author and a link to the original step; the old history remains visible.
8. Select a saved checkpoint and choose **Restore this checkpoint** to return to its files and request decisions. The worker stops its coding process first, saves an undo checkpoint, restores, and pauses. Resume or submit a new direction when ready. Older checkpoints without saved request decisions support corrections but cannot restore the full state.

The catalog uses a **Stripe-compatible fixture**, including pagination and inactive products. No live Stripe account, checkout, or payment processing is connected. Starter prompts fill the composer without submitting work.

**Preview** bundles the workspace's `index.html` (or `public/index.html`) with local JavaScript, TypeScript, CSS, and SVG assets. It is interactive, refreshes as the worker saves files, and is shared through Atlas. It runs in an isolated iframe without access to session cookies or external connections. It does not start arbitrary application servers or install dependencies; unsupported imports show an actionable error. Source stays in `.converge/workspaces/<session-id>` on the worker (or `CONVERGE_DATA_DIR/workspaces/<session-id>`).

**Connect Codex** issues a workspace-scoped MCP credential that expires after seven days. It exposes shared context, changes, and progress reporting to an external Codex client; it cannot impersonate a human intent submission. The Mac app can add the connection to Codex directly; browser users copy the setup command. The companion skill is in `integrations/codex-plugin/converge`. Treat the connection command and invitation URL as private access links.

## Execution and limits

- A dedicated Codex app-server edits a per-session local repository. Agent tools have sandboxed workspace access, no network, no external MCP tools, and no approval bypass.
- OpenRouter supplies real routing/coding inference. Routing can explicitly fall back to conservative rules; coding errors remain visible.
- Better Auth provides cookie-based anonymous and email/password identities. Every workspace API checks membership. Email verification and password recovery are not configured for this demo.
- Atlas preserves intents, final trajectory items, checkpoints, and source manifests. Legacy sessions without memberships stay unlisted.
- History actions use membership checks, idempotency keys, and revision checks. A pending restore blocks concurrent mutations, retains its original recovery point across restarts, and clears the prior Codex thread so stale working context cannot overwrite the restored direction.
- Source checkpoints include supported root web files and text files in `src`, `tests`, `public`, and `assets`, with a 40-file / 1 MB limit. Unsupported files inside those directories fail capture rather than silently disappearing. Secrets, symlinks, and invalid paths are rejected.
- Trusted assertions run outside generated code. Unsupported acceptance criteria require review; generated tests cannot declare the work complete.
- Working context is capped at 16,000 characters and 64 active requirements. Mandatory requirements that cannot fit stop execution instead of being dropped.
- Each fixed hour admits at most **30 routing/turn operations per workspace, 60 per owner, and 100 across the database**, reserved atomically. These are admission limits, not token, dollar, or provider-subrequest caps. API/auth limits also apply; exhausted work remains saved for a later resume.

## Codex source and validation

The [Codex fork](https://github.com/Divyesh-Thirukonda/codex-converge) is pinned as `vendor/codex` at `d57fc7e6c298e6191f4cb8e4e096942edc2b4032`. The app launches the installed compatible runtime through `lib/codex-bridge.ts`; it has not rebuilt that fork into the running binary.

```sh
npm run typecheck
npm test
npm run verify:store
npm run build
npm run desktop:package
```

`npm test` includes auth projections, origin checks, transport isolation, revision/context behavior, source recovery, and protected verification. Optional Atlas integration tests exercise real account linking and atomic budget contention; they create and clean up their own records without model calls:

```sh
CONVERGE_AUTH_INTEGRATION=1 node --conditions=react-server --env-file=.env.local --import tsx --test tests/auth-isolation.test.ts
CONVERGE_BUDGET_INTEGRATION=1 node --conditions=react-server --env-file=.env.local --import tsx --test tests/model-budget.test.ts
CONVERGE_ATLAS_HISTORY_TEST=1 node --conditions=react-server --env-file=.env.local --import tsx --test tests/history-integration.test.ts
```

Packaging produces `dist/Converge-darwin-arm64/Converge.app`, an unsigned local Apple Silicon demo. Use `CONVERGE_APP_URL` during packaging for the public UI; the bundle includes its worker and trusted fixture/verifier. Credentials and workspaces remain external; `CONVERGE_ENV_FILE` and `CONVERGE_DATA_DIR` override their locations. Codex itself is not bundled.

See [the architecture](docs/ARCHITECTURE.md) for access boundaries and recovery. The supported verifier covers the storefront fixture, not arbitrary application correctness. No billion-token endurance result is claimed. The earlier AEGIS application remains in Git tag `archive/aegis-final`.
