# Desktop Tauri shell (experimental / parked)

**Status:** Not the default dev path. This page is for **experimental** work on the packaged macOS app (Tauri v2), native window, DMG, and bundled Node server. Day-to-day web development uses `pnpm run dev` only — see [ARCHITECTURE.md](../ARCHITECTURE.md) and [runtime-and-routes.md](runtime-and-routes.md).

**Troubleshooting** logs, FDA, ports, and path bugs: [.agents/skills/desktop/SKILL.md](../../.agents/skills/desktop/SKILL.md).

## Context

Optional: run the same stack inside a native window — [OPP-007 (archived)](../opportunities/archive/OPP-007-native-mac-app.md).

```sh
pnpm run desktop:dev            # Hono + Vite on :3000 + Tauri WebView → http://localhost:3000
pnpm run desktop:build          # pnpm build + bundle server + Braintunnel.app (+ DMG on macOS)
pnpm run desktop:fresh          # desktop:clean-data + desktop:build, then opens DMG (default) or app — see scripts/desktop-fresh.mjs
pnpm run desktop:clean-data     # delete packaged-app data: default BRAIN_HOME + wiki parent (~/Documents/Brain from bundle-defaults), or explicit BRAIN_HOME / BRAIN_WIKI_ROOT (+ macOS logs); not ./data unless BRAIN_HOME points there
```

Prefer **`desktop:dev`** or **`pnpm run dev`** for API/UI iteration; reserve **`desktop:build`** / **`tauri build`** when you must verify release-style packaging.

## Rust / Cargo (Tauri crate)

Rust crate: **`desktop/`** (Tauri shell), wired from root **[Cargo.toml](../../Cargo.toml)**. Artifacts under the Cargo target dir (usually `./target/`; see `cargo metadata`).

`cargo test` is shadowed in this workspace; use **`cargo t`** or **`cargo test-parallel`** (cargo-nextest) for parallel runs.

```sh
cargo t                 # all workspace tests in parallel (desktop-focused workspace layout)
cargo t -p brain        # Tauri crate tests in parallel
cargo test              # standard serial integration runs
```

Needs **Rust** (`cargo`/`rustc`) and **Xcode** command-line tools on macOS for native builds.

**Before Node steps at repo root:** match [.nvmrc](../../.nvmrc) (`nvm use` per [AGENTS.md](../../AGENTS.md)). Wrong Node breaks native addons and the **server-bundle** copy of the `node` binary.

## Ripmail paths under Brain

Index and config live under **`<tenant>/ripmail/`** relative to **`BRAIN_DATA_ROOT`** ([`shared/brain-layout.json`](../../shared/brain-layout.json)) — on disk **`$BRAIN_DATA_ROOT/<usr_…>/ripmail/`**. The server computes mail home per tenant; it does **not** use **`RIPMAIL_HOME`** from the environment for that routing. Indexing runs in-process in **`src/server/ripmail/`**.

## Bundled server (release)

`tauri build` runs `pnpm run build && pnpm run desktop:bundle-server`, copying `dist/`, production `node_modules`, and the active **`node`** binary into **`desktop/resources/server-bundle/`** (gitignored).

The packaged WebView talks to the embedded Hono server at **`https://127.0.0.1:<port>/`** (self-signed TLS, cert under `$BRAIN_HOME/var`) — [OPP-023 (archived)](../opportunities/archive/OPP-023-local-https-loopback-hardening.md). Tauri `tauri.conf.json` `build.frontendDist` placeholder is `https://127.0.0.1:18473`. Bundled Node + `dist/server` serves that listener (**release**); dev still uses **`pnpm run dev`** → `http://localhost:3000`.

**Auto-update:** `tauri-plugin-updater` is wired; **`plugins.updater.endpoints`** is empty until a team publishes a manifest — [OPP-029 (archived)](../opportunities/archive/OPP-029-auto-update.md). Replace the checked-in pubkey with one from **`npx tauri signer generate`** (private key out of git; CI `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PATH`). On macOS, `desktop/tauri.macos.conf.json` limits bundle output to **dmg** (not `all`).

## Embedded secrets (release builds)

Set **`BRAIN_EMBED_MASTER_KEY`** in the environment or workspace `.env` when running **`tauri build`**. The build reads allowlisted entries from `.env` (LLM `*_API_KEY`, `EXA_API_KEY`, `SUPADATA_API_KEY`, and **`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`** for in-app Gmail OAuth in the packaged app), encrypts them, and embeds ciphertext in the Rust binary; Rust decrypts at launch and sets env on the Tauri process so the bundled Node child inherits them (no decryption in TypeScript). CI should supply the key and secrets via env or a generated `.env`, never committed.

Authoritative env semantics: [environment-variables.md](environment-variables.md), [configuration.md](configuration.md), [SECURITY.md](../SECURITY.md). Packaged Gmail OAuth redirect/TLS: [google-oauth.md](../google-oauth.md).

If **`BRAIN_EMBED_MASTER_KEY`** is unset, the bundle can still build but ships without embedded secrets (APIs need other configuration; Gmail connect may show `oauth_not_configured`).

## Operator issues / feedback API (OPP-048)

**`BRAIN_EMBED_MASTER_KEY`** is also accepted as **Bearer** on **`GET /api/issues`** and **`GET /api/issues/:id`** for the **global** issue queue (multi-tenant: `$BRAIN_DATA_ROOT/.global/issues/`; single-tenant: user `issues/`). Trusted / operator contexts only. With a normal **`brain_session`**, those GETs return the **current user’s** copies.

**`POST /api/issues/draft`**, **`POST /api/issues/submit`**, and the **`product_feedback`** tool need a vault session; submit also writes **`wiki/feedback/issue-<n>.md`** in the reporter’s vault.

**`pnpm run issues:list`** and **`pnpm run issues:fetch`** call the GET routes with the env key (point at the server URL when triaging hosted staging).

Details: [OPP-048 (archived)](../opportunities/archive/OPP-048-brain-home-feedback-issues-embed-api.md), [SECURITY.md](../SECURITY.md).
