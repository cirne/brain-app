# brain-app

Hono + Svelte + pi-agent-core web app: Chat (agentic), Wiki browser, and Inbox (ripmail).

**Scope:** This file is for working on the **repository**—stack, dev workflow, and conventions. It is not a catalog of LLM tools or agent runtime behavior; that lives in `src/server/agent/` (see code and tests there).

See `/Users/cirne/brain/wiki/ideas/brain-in-the-cloud.md` for the full product spec.

## Developer docs

- [docs/VISION.md](docs/VISION.md) — product vision and long-term direction
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design decisions, key patterns, configuration overview
- [docs/BUGS.md](docs/BUGS.md) — known bugs (active + archived)
- [docs/OPPORTUNITIES.md](docs/OPPORTUNITIES.md) — feature ideas and improvements (WIP and future)
- [docs/PRODUCTIZATION.md](docs/PRODUCTIZATION.md) — blockers and tradeoffs for generalizing to multi-user product

## Stack


| Layer           | Package                                                       |
| --------------- | ------------------------------------------------------------- |
| Server          | Hono + @hono/node-server                                      |
| Agent           | @mariozechner/pi-agent-core + pi-coding-agent                 |
| LLM             | @mariozechner/pi-ai (multi-provider: Anthropic, OpenAI, etc.) |
| Chat UI         | Svelte 5 (custom streaming SSE client)                        |
| Wiki / Inbox UI | Svelte 5                                                      |
| Email           | ripmail binary ([`ripmail/`](ripmail/) crate, subprocess)    |
| DB              | better-sqlite3 (app state; ripmail manages its own SQLite)    |


## Configuration

Copy `[.env.example](.env.example)` to `.env` and edit. Variable names and inline comments live in `.env.example`; semantics and architecture-level notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Dev

```sh
nvm use          # switches to Node 22
npm install
npm run dev      # starts Hono + Vite HMR on single port 3000
```

Single server: Vite runs as middleware inside Hono. API requests go to Hono routes; everything else goes to Vite for HMR.

Auth is skipped in dev mode (`NODE_ENV !== 'production'`).

### Native macOS (Tauri v2)

Optional: run the same stack inside a native window (see [OPP-007](docs/opportunities/OPP-007-native-mac-app.md)).

```sh
npm run ripmail:dev            # cargo build -p ripmail (debug) — use before inbox if not on PATH
npm run ripmail:build          # cargo build -p ripmail --release
npm run ripmail:test           # cargo test -p ripmail
npm run tauri:dev              # Hono + Vite on :3000 + Tauri WebView → http://localhost:3000
npm run tauri:build            # npm build + bundle server + Brain.app (+ DMG)
npm run tauri:open-fresh-install # `tauri:clean-data` + `tauri:build`, then opens the DMG (macOS) for drag-to-Applications testing
npm run tauri:clean-data        # delete Tauri app data only (App Support/Brain, ~/Documents/Brain, logs); not CLI/dev ~/.ripmail or ./data
```

**Cargo workspace:** Rust crates live under [`desktop/`](desktop/) (Tauri shell) and [`ripmail/`](ripmail/) with a root [`Cargo.toml`](Cargo.toml). Build artifacts go under the Cargo target directory (usually `./target/`; see `cargo metadata`).

Requires **Rust** (`cargo`/`rustc`) and **Xcode** toolchain on macOS. The packaged app bundles a release-built `ripmail` binary inside `server-bundle/`; `tauri:bundle-server` builds it automatically. For local dev, `npm run ripmail:dev` builds the debug binary and `run-dev.mjs` sets `RIPMAIL_BIN` when it exists.

`tauri build` runs `npm run build && npm run tauri:bundle-server`, which copies `dist/`, production `node_modules`, the current `node` binary, and a **release-built `ripmail`** (from `cargo build -p ripmail --release`) into `desktop/resources/server-bundle/` (gitignored). The packaged app loads the UI from `http://localhost:3000` and starts that server via the bundled Node + `dist/server` (release only; dev still uses `npm run dev`).

**Embedded API keys (release builds):** set `BRAIN_EMBED_MASTER_KEY` in the environment or in the workspace `.env` when running `tauri build`. The build script reads allowlisted keys from the repo `.env` (`ANTHROPIC_API_KEY`, other `*_API_KEY` for LLM providers, `EXA_API_KEY`, `SUPADATA_API_KEY`), encrypts them, and embeds ciphertext in the Rust binary; Rust decrypts at launch and injects `process.env` for the Node child (no decryption in TypeScript). CI should set `BRAIN_EMBED_MASTER_KEY` and the same API key secrets as env vars (or a generated `.env`) rather than committing secrets. If `BRAIN_EMBED_MASTER_KEY` is unset, the bundle still builds but ships without embedded keys (users would need local configuration for those APIs).

## Development rules

### Early development (no backward compatibility)

The app is in **early development** with a **near-zero user base**. Optimize for velocity and simplicity, not preserving old state.

- **No backward compatibility by default.** Do not maintain compatibility layers, dual code paths, or “read old + write new” behavior for local data, APIs, or on-disk formats unless [PRODUCTIZATION.md](docs/PRODUCTIZATION.md) (or an explicit product decision) says otherwise.
- **No data migrations.** When SQLite schema, config files, cache layout, or any persisted format changes, **delete local data / reset stores / start fresh** as needed. Document breaking changes in commits or PRs; do not ship migration scripts for developer-local or pre-release data.
- **Avoid compatibility complexity.** Prefer a clean break and re-seeding over version flags, upgrade steps, or defensive readers for superseded formats.

- **Tests required**: every new feature or bug fix needs test coverage in `src/**/*.test.ts`.
- **TDD for bugs**: reproduce with a failing test first, then fix, then confirm green.
- **Lint before commit**: run `npm run lint` — the `ci` script runs lint + typecheck + tests + `cargo fmt` / `cargo clippy` / `cargo test` for the Rust workspace.
- **Validate fixes yourself**: when a change has an obvious verification step, **run it without asking the user**—e.g. `npm run lint` / scoped tests after edits, `cargo check -p app` or `cargo test -p ripmail` after Rust changes, `npm run build && npm run tauri:bundle-server` after packaging or server-bundle changes (confirms `ripmail` release binary is produced and copied). Reserve full `npm run tauri:build` for when the native bundle itself must be proven; it is slower. Only defer if the step needs secrets you do not have or would be destructive without confirmation.
- **DRY**: extract shared logic; never duplicate. Shared fixtures live in `src/server/test-fixtures.ts`.
- **Test fixtures**: reuse patterns from existing tests and shared helpers; avoid one-off temp dirs per test.
- **No React, no Next.js**: Svelte 5 for all UI.

