# brain-app (Braintunnel)

Hono + Svelte + pi-agent-core web app: Chat (agentic), Wiki browser, and Inbox (ripmail). **Product name:** **Braintunnel** (macOS bundle: `Braintunnel.app`). The repository and many env vars remain `brain-app` / `BRAIN_*` for historical reasons.

> **Cloud agents:** For fast setup without Rust/desktop tooling, see **[CLOUD-AGENTS.md](./CLOUD-AGENTS.md)**.

## Development rules

### Early development (no backward compatibility)

The app is in **early development** with a **near-zero user base**. Optimize for velocity and simplicity, not preserving old state.

- **No backward compatibility by default.** Do not maintain compatibility layers, dual code paths, or “read old + write new” behavior for local data, APIs, or on-disk formats unless [PRODUCTIZATION.md](docs/PRODUCTIZATION.md) (or an explicit product decision) says otherwise.
- **No data migrations.** When SQLite schema, config files, cache layout, or any persisted format changes, **delete local data / reset stores / start fresh** as needed. Document breaking changes in commits or PRs; do not ship migration scripts for developer-local or pre-release data.
- **Avoid compatibility complexity.** Prefer a clean break and re-seeding over version flags, upgrade steps, or defensive readers for superseded formats.
- **Agent diagnostics** (`$BRAIN_HOME/var/agent-diagnostics/`): dev-only JSONL/JSON. **Never** migrate old log files, **never** add code that reads legacy on-disk shapes. Change schema (e.g. `AGENT_DIAGNOSTICS_SCHEMA_VERSION` in `agentDiagnostics.ts`) and fields as needed; delete stale files locally if they confuse you.
- **Tests required**: every new feature or bug fix needs test coverage in `src/**/*.test.ts`.
- **Component tests**: Svelte UI uses Vitest (jsdom) + `@testing-library/svelte`; helpers and conventions are in [docs/component-testing.md](docs/component-testing.md).
- **CRITICAL: TDD**: write the test case first, then the code, then make sure the test passes. especially when fixing bugs.
- **Lint before commit**: run `npm run lint` — the `ci` script runs lint + typecheck + tests; run `cargo fmt -p brain`, `cargo clippy -p brain`, and `cargo t -p brain` when you change `desktop/`.
- **Validate fixes yourself**: when a change has an obvious verification step, **run it without asking the user**—e.g. `npm run lint` / scoped tests after edits, `cargo check -p brain` after Rust/desktop changes, `npm run build && npm run desktop:bundle-server` after packaging or server-bundle changes. Reserve full `npm run desktop:build` for when the native bundle itself must be proven; it is slower. Only defer if the step needs secrets you do not have or would be destructive without confirmation.
- **DRY**: extract shared logic; never duplicate. Shared fixtures live in `src/server/test-fixtures.ts`.
- **Test fixtures**: reuse patterns from existing tests and shared helpers; avoid one-off temp dirs per test.
- **No React, no Next.js**: Svelte 5 for all UI.

### Icons (Lucide) and text

- **Use Lucide as components**, not ad-hoc inline `<svg>`. Import from `lucide-svelte` and register tool-side icons in [`src/client/lib/tools/registryIcons.ts`](src/client/lib/tools/registryIcons.ts) (`getToolIcon` / `toolIcons.js`). For unregistered tool names, use a generic Lucide icon in the UI (e.g. `Wrench` in `ToolCallBlock`)—do not paste raw SVG.
- **Lucide does not “solve” icon–text alignment**. Each component is still an `<svg>` in a box; there is no prop that optically lines up with a label. Misalignment is normal when the row uses `align-items: flex-start` (tops of boxes) or mixes fixed icon size with a text line box whose height comes from `line-height` and font metrics.
- **Rule of thumb for icon + text in one row:** use `display: flex` (or `inline-flex`) on the row with `align-items: center`, give the label a stable `line-height` if needed, and **do not** expect zero tweak at 11–13px; a 0–1px nudge on the icon wrapper is acceptable when the row still looks off after centering. Avoid `align-items: flex-start` for icon+title chips unless you deliberately offset.


**Scope:** This file is for working on the **repository**—stack, dev workflow, and conventions. It is not a catalog of LLM tools or agent runtime behavior; that lives in `src/server/agent/` (see code and tests there).

See `/Users/cirne/brain/wiki/ideas/brain-in-the-cloud.md` for the full product spec.

## Developer docs

- [docs/STRATEGY.md](docs/STRATEGY.md) — positioning, segments, competitive moats (initial; SSOT for strategy)
- [docs/VISION.md](docs/VISION.md) — product vision and personalization narrative (not positioning/moats)
- [docs/karpathy-llm-wiki-post.md](docs/karpathy-llm-wiki-post.md) — Karpathy *LLM Wiki* (wiki half of the product idea; [gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f))
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design decisions, key patterns, configuration overview (brain-app)
- [docs/architecture/](docs/architecture/) — ADRs and recorded considerations (indexed in [README](docs/architecture/README.md)); **env inventory:** [docs/architecture/environment-variables.md](docs/architecture/environment-variables.md); **onboarding states + mail phases:** [docs/architecture/onboarding-state-machine.md](docs/architecture/onboarding-state-machine.md); archived Rust ripmail snapshot: [docs/architecture/ripmail-rust-snapshot.md](docs/architecture/ripmail-rust-snapshot.md)
- [docs/digitalocean.md](docs/digitalocean.md) — DigitalOcean CLI (`doctl`): teams, API tokens, named contexts, BrainTunnel helper script
- [docs/newrelic.md](docs/newrelic.md) — New Relic account, entity GUIDs, Node agent wiring, custom events (`ToolCall`); NRQL recipes in `.cursor/skills/newrelic/`
- [docs/BUGS.md](docs/BUGS.md) — known bugs (active + archived)
- [docs/IDEAS.md](docs/IDEAS.md) — fuzzy ideas and concepts being refined before they become opportunities
- [docs/OPPORTUNITIES.md](docs/OPPORTUNITIES.md) — feature ideas and improvements (WIP and future)
- [docs/PRODUCTIZATION.md](docs/PRODUCTIZATION.md) — blockers and tradeoffs for generalizing to multi-user product

## Stack


| Layer           | Package                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| Server          | Hono + @hono/node-server                                                                 |
| Agent           | @mariozechner/pi-agent-core + pi-coding-agent                                            |
| LLM             | @mariozechner/pi-ai (multi-provider: Anthropic, OpenAI, etc.)                            |
| Chat UI         | Svelte 5 (custom streaming SSE client)                                                   |
| Wiki / Inbox UI | Svelte 5                                                                                 |
| Email           | `src/server/ripmail/` TypeScript module — in-process `better-sqlite3` (OPP-103)         |
| DB              | better-sqlite3 (optional read-only macOS iMessage `chat.db`; ripmail has its own SQLite) |


## Configuration

Copy `[.env.example](.env.example)` to `.env` and edit. Variable names and inline comments live in `.env.example`; semantics and architecture-level notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/architecture/configuration.md](docs/architecture/configuration.md). **Full inventory + contributor rule (do not add env vars without explicit user request):** [docs/architecture/environment-variables.md](docs/architecture/environment-variables.md).

**DigitalOcean:** optional `DO_TOKEN` in `.env` is for your local `doctl` workflow only (Brain does not consume it). See [docs/digitalocean.md](docs/digitalocean.md).

## Node.js (nvm) — do this before any Node command

The repo pins the Node major version in `**[.nvmrc](.nvmrc)`**. **Run `nvm use` from the repository root before any `npm`, `npx`, or `node` invocation**—install, scripts, tests, `npm run build`, `desktop:bundle-server`, Tauri bundling, CI-style commands, or agent-driven automation.

**Why:** Using a different Node (system Node, another shell’s default, or a non-repo version) causes **native addon mismatches** (e.g. `better-sqlite3` failing during `npm ci` / `desktop:bundle-server`) and **wrong binaries** bundled into the desktop `server-bundle` (the packager copies the current `node`).

In non-interactive shells (scripts, agents, CI), ensure nvm is loaded first, e.g. `source ~/.nvm/nvm.sh` (or your install path), then `nvm use`.

## Dev

```sh
nvm use          # must match .nvmrc before npm/node (see “Node.js (nvm)” above)
npm install
npm run dev      # BRAIN_DATA_ROOT=./data; Hono + Vite HMR on single port 3000 (see docs/google-oauth.md)
npm run dev:clean  # delete ./data (all tenants + `.global/`) — full local wipe
```

Single server: Vite runs as middleware inside Hono. API requests go to Hono routes; everything else goes to Vite for HMR.

**Dev data directory:** everything durable lives under **`./data`** (`BRAIN_DATA_ROOT`). Tenants are subdirs (`usr_…`); registry and shared files are under **`./data/.global/`**. **`npm run dev:clean`** removes that entire tree (full reset). In-app **delete all my data** only removes the **current signed-in tenant**, not other tenants on disk.

Sign in applies in dev and production (`npm run dev`): Google OAuth → session; see [`docs/architecture/runtime-and-routes.md`](docs/architecture/runtime-and-routes.md).

### Native macOS (Tauri v2)

Optional: run the same stack inside a native window (see [OPP-007 (archived)](docs/opportunities/archive/OPP-007-native-mac-app.md)).

```sh
npm run desktop:dev            # Hono + Vite on :3000 + Tauri WebView → http://localhost:3000
npm run desktop:build          # npm build + bundle server + Braintunnel.app (+ DMG on macOS)
npm run desktop:fresh          # `desktop:clean-data` + `desktop:build`, then opens the DMG (default) or `Braintunnel.app` with `-- app` (macOS) — see `scripts/desktop-fresh.mjs`
npm run desktop:clean-data     # delete packaged-app data: local `BRAIN_HOME` default + macOS wiki parent (`~/Documents/Brain` from bundle-defaults) when using default paths, or explicit `$BRAIN_HOME` / `$BRAIN_WIKI_ROOT` (+ macOS logs); not `./data` unless `BRAIN_HOME` points there
```

### Cargo / Rust (desktop)

Rust crate: **`desktop/`** (Tauri shell), wired from root **[Cargo.toml](Cargo.toml)**. Build artifacts go under the Cargo target directory (usually `./target/`; see `cargo metadata`).

**Parallel Tests:** `cargo test` is shadowed by the built-in command and cannot be aliased to `nextest`. Use `**cargo t`** or `**cargo test-parallel**` to run tests in parallel across all files using `cargo-nextest`.

```sh
cargo t                        # run all workspace tests in parallel (desktop-only)
cargo t -p brain               # run desktop (Tauri) crate tests in parallel
cargo test                     # standard cargo test (runs integration test binaries serially)
```

Requires **Rust** (`cargo`/`rustc`) and **Xcode** toolchain on macOS for desktop builds.

**Ripmail storage under Brain:** Index and config live under **`<tenant>/ripmail/`** relative to **`BRAIN_DATA_ROOT`** ([`shared/brain-layout.json`](shared/brain-layout.json)). On disk that is **`$BRAIN_DATA_ROOT/<usr_…>/ripmail/`**. Braintunnel does **not** read **`RIPMAIL_HOME`** from your environment for mail paths; the server uses a **computed** mail home per tenant. Mail indexing and sync run **in-process** in **`src/server/ripmail/`**. Optional **`RIPMAIL_BIN`** is only for legacy subprocess helpers used in some tests (`src/server/lib/ripmail/ripmailRun.ts`).

`tauri build` runs `npm run build && npm run desktop:bundle-server`, which copies `dist/`, production `node_modules`, and the current `node` binary into `desktop/resources/server-bundle/` (gitignored). The packaged app’s WebView navigates to the embedded Hono server at **`https://127.0.0.1:<port>/`** (self-signed TLS, cert under `$BRAIN_HOME/var`, OPP-023); Tauri’s `tauri.conf.json` `build.frontendDist` placeholder is `https://127.0.0.1:18473`. The bundled Node + `dist/server` serves that listener (release only; dev still uses `npm run dev` → `http://localhost:3000`). In-app auto-update uses **`tauri-plugin-updater`**: `tauri.conf.json` includes a `pubkey` and **`plugins.updater.endpoints` is empty by default** (no update checks until you publish a manifest and add endpoint URLs). Replace the checked-in public key with one from **`npx tauri signer generate`** (keep the private key out of git; CI uses `TAURI_SIGNING_PRIVATE_KEY` or `TAURI_SIGNING_PRIVATE_KEY_PATH` to sign artifacts). On macOS, `desktop/tauri.macos.conf.json` limits bundle output to `**dmg**` (instead of `all`).

**Embedded secrets (release builds):** set `BRAIN_EMBED_MASTER_KEY` in the environment or in the workspace `.env` when running `tauri build`. The build script reads allowlisted entries from the repo `.env` (`ANTHROPIC_API_KEY`, other `*_API_KEY` for LLM providers, `EXA_API_KEY`, `SUPADATA_API_KEY`, plus `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` for in-app Gmail OAuth in Braintunnel.app), encrypts them, and embeds ciphertext in the Rust binary; Rust decrypts at launch and sets environment variables on the Tauri process so the bundled Node child inherits them (no decryption in TypeScript). CI should set `BRAIN_EMBED_MASTER_KEY` and the same secrets as env vars (or a generated `.env`) rather than committing secrets. If `BRAIN_EMBED_MASTER_KEY` is unset, the bundle still builds but ships without embedded secrets (users would need local configuration for those APIs and Gmail connect will show `oauth_not_configured` until credentials are embedded or otherwise supplied).

**OPP-048 (local feedback / issues):** the same `BRAIN_EMBED_MASTER_KEY` is accepted as a **Bearer** token for `GET /api/issues` and `GET /api/issues/:id` to read the **global** issue queue (in multi-tenant mode: files under `$BRAIN_DATA_ROOT/.global/issues/`; single-tenant: the user’s `issues/`). Use only in trusted / operator settings. With a normal `brain_session`, those GETs return the **current user’s** `issues/` copies (and `GET` is scoped to the signed-in workspace). `POST /api/issues/draft`, `POST /api/issues/submit`, and the `product_feedback` agent tool (draft + `confirmed` submit) require a vault session; on submit, the server also writes **`wiki/feedback/issue-<n>.md`** in the user’s vault wiki for their reference. `npm run issues:list` and `npm run issues:fetch` call the GET routes with the env key (point at the server URL, e.g. hosted staging, when triaging the global list).

