# Converge

**Different minds. One direction.**

Converge is a local Mac workspace where several people guide one coding agent without losing each other's requirements. Alex can ask for a Stripe product catalog while Sam asks for `NEW` labels on the three latest products. Converge records both authors, identifies the dependency, and steers the running Codex turn toward the combined implementation. Incompatible requests stop for an explicit choice instead of silently overwriting earlier work.

Built for the **Long Horizon Engineering** track: the core is a persistent execution harness with attributed intent, live steering, protected verification, bounded working context, and recoverable source checkpoints. The UI displays actual agent activity, diffs, checks, and Atlas state.

## Run locally

Requirements: macOS, Node.js 24 or newer, npm, Git, a compatible installed Codex app-server executable, an OpenRouter API key, and access to the provisioned MongoDB Atlas sandbox. Atlas must allow the machine's network address and the database user must be able to read, write, create collections/indexes, and use transactions.

```sh
npm ci
node node_modules/electron/install.js
git submodule update --init vendor/codex
cp .env.example .env.local
```

Set these values in `.env.local`:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | URI for the provisioned Atlas sandbox; required, with no in-memory fallback |
| `MONGODB_DB` | Database name; the existing sandbox configuration uses `aegis`, with separate `cv_` collections for Converge |
| `OPENROUTER_API_KEY` | Server/worker credential for real model inference |
| `OPENROUTER_MODEL` | Model used for semantic intent routing |
| `CONVERGE_CODE_MODEL` | Model used by Codex through OpenRouter's Responses API |
| `CONVERGE_CODEX_BINARY` | Optional override; defaults to `/Applications/ChatGPT.app/Contents/Resources/codex` |

Use models available to your OpenRouter account and compatible with the selected API. Keys remain in the local environment file, outside the renderer and packaged application.

Launch the native client:

```sh
npm run desktop
```

The launcher starts a loopback Next.js server and coding worker. It can reuse an already healthy Converge server and only stops child processes it owns. Alternatively, run the web client and worker in separate terminals:

```sh
npm run dev
npm run worker
```

Open [the local workspace](http://127.0.0.1:3000). `/api/health` reports Atlas connectivity; the session also reports whether a worker heartbeat is current. A configured key alone is not proof that a model call has succeeded.

## Two-person demo

1. Create a session. As **Alex**, send: “Connect Stripe and display the product catalog”.
2. Use **Share session → Open collaborator window**. The second native window opens the same session as **Sam**. In a browser, use **Open as Sam** or copy the session link.
3. While the agent is working, send: “Add NEW to the 3 most recently added Stripe products”. Watch the attributed dependency and the agent's actual activity. If the first turn is still active, the worker sends a real `turn/steer`; if it has finished, the amendment continues in the same coding thread.
4. Inspect **Changes** for the generated source diff, independently checked results, and catalog fixture preview. Prices in the preview are dollars.
5. Send “Remove all NEW badges” to exercise conflict arbitration. Choose whether to retain the earlier requirement or replace it; the choice remains in the intent history.
6. Use **Memory** to inspect durable checkpoints. Pause and resume the session to continue from saved requirements and source state.

The starter prompts only fill the composer. They do not submit work automatically. The catalog uses a **Stripe-compatible fixture**, including pagination and inactive products; no live Stripe account, checkout, or payment processing is connected.

## What is real

- **Codex execution:** a dedicated stdio app-server process edits a per-session local repository and emits real tool and turn events.
- **OpenRouter inference:** semantic routing uses a bounded structured request; coding uses the app-server's OpenRouter provider. Conservative routing rules are an explicit fallback. Coding failures are surfaced rather than replaced by a scripted result.
- **MongoDB Atlas persistence:** sessions, attributed intents, events, raw final trajectory records, memory checkpoints, and source manifests survive the UI and worker processes. Presence and worker liveness are separate expiring records.
- **Live collaboration:** compatible new requirements can steer the current turn. Conflicts interrupt execution until a person chooses a resolution. Duplicate requests preserve provenance without requiring another coding turn.
- **Independent verification:** trusted assertions run outside the generated repository against a controlled fixture. A generated test claiming success cannot mark the session complete. Unknown acceptance criteria require review.
- **Bounded active memory:** the default context is at most 16,000 characters. All active requirements are retained; if they cannot fit, execution stops rather than dropping one. The durable archive is not loaded wholesale into the prompt.

## Codex fork and runtime

The actual fork is [Divyesh-Thirukonda/codex-converge](https://github.com/Divyesh-Thirukonda/codex-converge), pinned as the `vendor/codex` Git submodule at `d57fc7e6c298e6191f4cb8e4e096942edc2b4032`.

The demo currently launches the **installed compatible Codex runtime** through `lib/codex-bridge.ts`. It does **not** claim to execute a newly compiled binary from the fork. The fork is included as pinned source; the Converge collaboration, persistence, steering, and verification harness is implemented in this repository.

## Checks and Mac packaging

```sh
npm run typecheck
npm test
npm run verify:store
npm run build
npm run desktop:package
```

Packaging produces `dist/Converge-darwin-arm64/Converge.app` with the Next.js standalone runtime, bundled worker, fixture, and verifier. It is a local Apple Silicon demo build, not a signed/notarized distribution. Credentials and working data stay outside the bundle. The launcher records this machine's external environment/data paths; set `CONVERGE_ENV_FILE` and `CONVERGE_DATA_DIR` when using different locations. Packaging does not rebuild or bundle the Codex fork binary.

A recorded live run is in [docs/verified-demo.json](docs/verified-demo.json): two authors, one acknowledged live steer, four protected checks passing, source restoration after restarting the worker, duplicate suppression, and conflict resolution through two native windows. The provider interrupted the first turn; a resumed turn completed the same Codex thread.

Run `npm run verify:collaboration` with the app or web server and worker running to exercise real inference. It creates a new demo session and uses OpenRouter credits. `npm run verify:store` checks Atlas transactions and cleans up its own test records.

The automated suite covers intent relationships and conflict preservation, context bounds and source attribution, app-server transport/lifecycle isolation, and source checkpoint validation/recovery. See [the architecture](docs/ARCHITECTURE.md) for the protocols and limits.

## Current scope

Alex, Sam, and Jordan are local demonstration personas, not authenticated accounts. Shared URLs identify a local session; they do not provide cloud execution or an authenticated remote collaboration service. Execution runs on the local Mac, with Atlas for persistence and OpenRouter for inference. The supported verification surface is the Stripe-compatible fixture, not arbitrary application correctness. No billion-token or large-scale reliability result is claimed.

The earlier AEGIS application is retained in the Git tag `archive/aegis-final`.
