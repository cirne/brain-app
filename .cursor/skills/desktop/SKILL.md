---
name: desktop
description: Troubleshoots Brain macOS Brain.app (Tauri) and bundled Node server — logs, FDA, ports, BRAIN_HOME/RIPMAIL_HOME, API keys, and build iteration. Use when the user invokes /desktop, or when debugging packaged app, DMG, desktop:build, webview 404, wrong data path, inbox/mail permissions, or native shell issues.
---

# Desktop (Brain.app) troubleshooting

## Log locations (macOS)

Canonical bundle log directory (matches `shared/bundle-defaults.json` → `tauri_logs_dir_darwin`):

- **`~/Library/Logs/com.cirne.brain/`** 

Read these first:

| File | Contents |
|------|----------|
| **`node-server.log`** | Bundled **Node/Hono** stdout+stderr — API traffic, `[brain-app]` startup diagnostics (`BRAIN_HOME`, `RIPMAIL_HOME`, `ripmail index`, FDA probe), `BRAIN_LISTEN_PORT=…`, errors |
| **`Brain.log`** | **Rust/Tauri** `log` crate (e.g. `[fda]`, `server_spawn`, bundled server listen line) |

**Unified Logging / Console:** The Tauri binary is what `log stream` often labels; **Hono logs live in `node-server.log`**, not in the parent process stream — tail the file for server truth.

Quick checks:

```bash
tail -n 200 ~/Library/Logs/com.cirne.brain/node-server.log
grep -E '\[brain-app\]|BRAIN_|RIPMAIL_|BRAIN_LISTEN_PORT|Full Disk Access|FDA' ~/Library/Logs/com.cirne.brain/node-server.log | tail -n 80
```

## Startup diagnostics (what “good” looks like)

In **`node-server.log`**, each server start should include lines like:

- `[brain-app] BRAIN_HOME=/Users/…/Library/Application Support/Brain` (when the current build logs it)
- `[brain-app] RIPMAIL_HOME=…` or derived note
- `[brain-app] ripmail index: messages≈… lastSync=…`
- `[brain-app] Full Disk Access: granted` or `NOT granted`
- FDA probe lines: `readDir=ok` vs `readDir=fail errno=EPERM` for Mail/Safari/Stocks — **EPERM** until FDA is granted to the app

If **`ripmail index: messages≈0`** but mail was synced before: often **FDA off** for that run (Mail library unreadable) or a fresh/empty store.

## Gotchas from tracked bugs / packaging

### BUG-003 ([docs/bugs/BUG-003-native-mac-app-ship-blockers.md](../../../docs/bugs/BUG-003-native-mac-app-ship-blockers.md))

- **GUI apps do not inherit shell env** (`~/.zshrc`, etc.). Keys that “work in Terminal” may be missing for **Brain.app** unless embedded at build (`BRAIN_EMBED_MASTER_KEY` + allowlisted secrets) or set another documented way.
- **Iteration:** Prefer **`npm run desktop:dev`** or **`npm run dev`** for API/UI; reserve **`npm run desktop:build`** / **`tauri build`** for release-style verification. Changing spawn/env/logging: often **`cargo`** in `desktop/` without a full product bundle.
- **Before any Node command:** **`nvm use`** at repo root (see **[AGENTS.md](../../../AGENTS.md)**) — wrong Node breaks native addons and server-bundle contents.

### BUG-009 ([docs/bugs/BUG-009-desktop-webview-wrong-port.md](../../../docs/bugs/BUG-009-desktop-webview-wrong-port.md)) — open

- If loopback port **18473** (or the start of the native range) is **already taken** (another session/user/process), the webview can show **404** or the **wrong origin**.
- Server prints **`BRAIN_LISTEN_PORT=<port>`**; Rust parses child stdout — verify in **`node-server.log`** that the port matches **`Brain bundled server listening on 127.0.0.1:…`** in Rust logs.
- Repro needs **release** bundled path, not only `desktop:dev` (dev uses **:3000**).

### BUG-004 (FDA) ([docs/bugs/BUG-004-full-disk-access-detection-and-onboarding.md](../../../docs/bugs/BUG-004-full-disk-access-detection-and-onboarding.md))

- FDA **gate is production + Tauri** only — **`npm run desktop:dev`** does **not** show the same gate (use packaged app or `desktop:build` / `desktop:fresh` flow to test).
- After toggling FDA, **relaunch** may be required for TCC to apply.
- Rust logs **`[fda]`**; Node logs FDA probe — cross-check both if “Mail unreadable” persists.

### BUG-008 ([docs/bugs/BUG-008-first-mail-indexing-feedback.md](../../../docs/bugs/BUG-008-first-mail-indexing-feedback.md))

- First-time mail indexing can feel **hung** with little UI feedback — not always a deadlock; check server logs and ripmail activity.

## Data paths and “wrong user” / wrong profile

- Default **`BRAIN_HOME`**: **`~/Library/Application Support/Brain`**; **`RIPMAIL_HOME`**: **`…/Brain/ripmail`** (see `desktop/src/brain_paths.rs`, `shared/bundle-defaults.json`).
- Tauri sets `BRAIN_HOME` / `RIPMAIL_HOME` on the **Node child only when the parent does not already have them set** — if the parent exports wrong values, the child can **inherit** bad paths. Confirm **`[brain-app] BRAIN_HOME=`** / **`RIPMAIL_HOME=`** in **`node-server.log`**.
- **Ripmail does not merge two accounts in one index** — wrong identity usually means **wrong store path** or **mailbox configured for someone else** under that `RIPMAIL_HOME`, not SQLite “commingling.”
- Older logs sometimes showed wiki under **`~/Documents/Brain`** (repo-style); current layout targets **Application Support** — mixed paths across versions can confuse debugging; trust the latest `[brain-app]` lines.

## Embedded API keys (release builds)

- See **[AGENTS.md](../../../AGENTS.md)** — `BRAIN_EMBED_MASTER_KEY`, allowlisted keys, ciphertext in Rust; without that, bundled app may ship **without** embedded keys.

## Related repo docs

- **[AGENTS.md](../../../AGENTS.md)** — `desktop:*` commands, `nvm`, `BRAIN_HOME`, `RIPMAIL_HOME`, `desktop:clean-data`
- **[docs/bugs/BUG-003-native-mac-app-ship-blockers.md](../../../docs/bugs/BUG-003-native-mac-app-ship-blockers.md)** — ship blockers + DX
- **[docs/architecture/runtime-and-routes.md](../../../docs/architecture/runtime-and-routes.md)** — bundled port range, `BRAIN_BUNDLED_NATIVE`, Tailscale note

## Agent workflow (short)

1. Read **`~/Library/Logs/com.cirne.brain/node-server.log`** (tail + grep patterns above).
2. Read **`Brain.log`** for Rust spawn/FDA if Node never binds.
3. Map symptoms to **BUG-003** (keys/env), **BUG-009** (port), **BUG-004** (FDA), or path/env inheritance.
4. Prefer **`desktop:dev` / `npm run dev`** to reproduce server issues without a full DMG cycle when possible.
