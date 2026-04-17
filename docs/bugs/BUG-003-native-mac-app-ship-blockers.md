# BUG-003: Native macOS app (Tauri) — ship blockers for a zero-config, FDA-only install

## Summary

We can produce a **Brain.app** / **DMG**, but several issues block a **shareable image** that a user with **no developer setup** can run successfully after granting **Full Disk Access (FDA)** and related macOS permissions. This bug tracks those gaps and the **developer experience** problems that make diagnosing them slow.

**Opportunity context:** [OPP-007: Native Mac App Packaging](../opportunities/OPP-007-native-mac-app.md).

## Symptoms

- Launching the **bundled** app may **quit immediately** or fail to become usable when **API keys are not available** the same way they are in a dev shell (see below).
- **Observability is poor:** `log stream` on the `app` process does **not** show Hono/Node `console` output or WebView JS logs; failures look “silent” unless you know where to look.
- **Iteration is slow:** every meaningful change tends to require a **full `tauri build`** cycle, which is painful when debugging startup, env, and subprocess behavior.

## Root causes (current understanding)

### 1. “Global” / embedded secrets vs how the bundled server starts

- The server historically ran `**verifyLlmAtStartup()` before binding to port 3000**. If `**ANTHROPIC_API_KEY`** (or the active provider’s key) was missing—as is typical for a GUI-launched app without embedded secrets—the Node process **exited before `listen()`**, so **nothing listened on localhost:3000**. Tauri’s bootstrap waits for that port; setup then **failed** and the process could **exit unexpectedly**.
- **Embedded keys** require a **build-time** `BRAIN_EMBED_MASTER_KEY` and encrypted `.env` material; a local `tauri build` without that path still produces an app with **empty** embedded secrets.
- **GUI apps** do not inherit shell-only env (`~/.zshrc`, etc.), so “I have keys in my terminal” does not apply to the **Brain.app** process unless we inject them another way (embedded env, Keychain, first-run UI, or docs).

**Mitigation merged:** the server now **binds HTTP first**, then runs diagnostics + LLM smoke checks **after** listen, and LLM failure **logs** instead of killing the process—so the **UI can load** and the app can stay open while keys are fixed.

**Still open:** a clear **first-run** path for “no keys yet” (UX + documentation), reliable **injection** of production keys for shipped builds, and validation that **chat** degrades gracefully when the smoke check fails.

### 2. Logs: Unified Logging vs Node child process

- The **Tauri** binary is what shows up as process `app` in **Console / `log stream`**. The **Hono** server runs in a **child Node** process whose **stdout/stderr** were (until addressed) **not** visible in typical `log stream` filters.
- **Fix direction in tree:** append Node stdout/stderr to a file under the app’s log directory (e.g. `~/Library/Logs/<bundle id>/node-server.log`), and emit a **Rust** `log::info!` with that path at startup so **one** useful line appears in unified logs.

**Still open:** document the **tail** command in user-facing troubleshooting; optional **in-app** “open logs” or last error line for support.

### 3. Slow feedback loop (build vs dev-equivalent)

- `**npm run desktop:build`** runs client + server compile, **bundle-server**, Rust **release** build, codesign/bundle/DMG — **minutes** per iteration.
- Faster options for debugging:
  - `**npm run desktop:dev`** — Vite + Hono on **:3000** with hot reload; Tauri shell loads the same URL; closest to “normal” dev.
  - **Server only:** `npm run dev` (no Tauri) to validate API/onboarding/ripmail without rebuilding the shell.
  - **Rust-only:** `cargo run` / `cargo build` in `desktop` when changing **spawn/env/logging** without needing a full product bundle.

**Still open:** a short **contributor** subsection (here or in AGENTS.md) listing “which command when” so people don’t default to full `desktop:build` for every change.

## Goal (unchanged from OPP-007)

Ship a **shareable** **DMG/app** such that a user can:

1. Install without `npm`, `.env`, or ripmail CLI setup.
2. Grant **FDA** (and other prompts) so local data sources (Mail library, iMessage DB, etc.) are readable as designed.
3. Land in a **working** UI with **email/indexing** and assistant features consistent with permissions—not blocked by invisible startup failures or missing keys with no guidance.

## Fix direction (high level)


| Area    | Direction                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Startup | Keep **listen-first**; never `process.exit` from optional checks before bind.                                             |
| Secrets | Production path: embedded allowlist + master key **or** user-provided keys with clear UI; avoid “works in terminal only.” |
| Logs    | File sink for Node + pointer in unified log; optional in-app diagnostics.                                                 |
| DX      | Prefer `**npm run desktop:dev**` / `**npm run dev**` for iteration; reserve `**npm run desktop:build**` for release checks.                   |
| FDA     | Re-test onboarding **Connect Apple Mail** / ripmail paths once the app stays up reliably.                                 |


## Related

- [OPP-007: Native Mac App Packaging](../opportunities/OPP-007-native-mac-app.md)
- [AGENTS.md](../../AGENTS.md) — Tauri commands and env
- [ARCHITECTURE.md](../ARCHITECTURE.md) — deployment and env if extended for native