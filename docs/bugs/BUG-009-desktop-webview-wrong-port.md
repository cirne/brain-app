# BUG-009: Desktop (Tauri release) — webview URL wrong when the default native port is taken

**Status:** Open — reporter still sees the issue after the first fix attempt.

## Symptom

On macOS, when **Brain.app** (release / bundled server path) runs and the **preferred loopback port** (start of the native range, e.g. `18473`) is **already in use** by another login/session or process on the same machine, the **webview can show `404 Not Found`** or otherwise load the **wrong origin**. The address bar / loaded URL does not match the port the **current** Node server actually bound to.

Dev note: **`npm run desktop:dev`** uses debug Rust and loads `http://localhost:3000` from config; it does **not** exercise the bundled-server + `navigate()` path. Repro requires a **release** Tauri build or **`tauri dev --release`** with a valid `desktop/resources/server-bundle/`.

## Root cause (confirmed)

The Tauri shell used to infer the listening port by **`TcpStream::connect`** to candidates in order. That returns the **first** port in the range something accepts — often **another user’s** Brain (or any server) on `18473` — not necessarily **this** process’s server after it falls back to `18474`, etc.

## Fix attempt (in tree)

- The bundled Node server prints a single line after bind: `BRAIN_LISTEN_PORT=<port>` (`src/server/index.ts`, `listenNativeBundled()`).
- Rust reads child **stdout** until that line appears and uses that port for `navigate` (`desktop/src/server_spawn.rs`).

**Reporter:** Issue **still reproduces** after this change — cause not fully closed.

## Hypotheses for remaining failure (next investigation)

1. **Initial load vs navigate:** `tauri.conf.json` sets `build.frontendDist` / window URL to a fixed `http://localhost:18473`. The webview may **paint** or **stick** to that URL before `setup` navigates, or `navigate` may not run / may fail silently in some builds.
2. **Stdout timing / ordering:** `BRAIN_LISTEN_PORT` is emitted only after async startup (`listenNativeBundled()`). If something else is printed first or buffers differ, the Rust side could still mis-associate or timeout (unlikely if line is first after bind, but worth verifying in logs).
3. **Wrong binary / stale bundle:** Confirm the running `.app` was rebuilt after the change; confirm `server-bundle` was produced with **`nvm use`** (see `AGENTS.md`) so native deps and the bundled `node` binary match.
4. **Multiple listeners:** Edge case if more than one line or process interferes with stdout parsing.

## Fix direction

- Verify in **`node-server.log`** (app log dir) that `BRAIN_LISTEN_PORT=…` appears and matches the port in Rust logs (`Brain bundled server listening on 127.0.0.1:…`).
- If Rust has the right port but UI is wrong, focus on **Tauri window lifecycle**: ensure **one** authoritative URL (e.g. always `navigate` after spawn, or avoid loading `frontendDist` until port known).
- Add **logging** when `navigate` runs and on failure.
- Optional: **integration test** that spawns bundled Node and asserts the handshake line (without full GUI).

## Related files

- `desktop/src/lib.rs` — `navigate` after `spawn_brain_server`
- `desktop/src/server_spawn.rs` — stdout parsing, child spawn
- `desktop/tauri.conf.json` — `frontendDist`, default window URL
- `src/server/index.ts` — `listenNativeBundled()`, `BRAIN_LISTEN_PORT`
- `src/server/lib/nativeAppPort.ts` — OAuth candidate ports (subset of range)
