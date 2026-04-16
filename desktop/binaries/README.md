# `desktop/binaries/` (legacy)

Tauri no longer uses `externalBin` sidecars from this directory. ripmail is now built as a release binary by `npm run tauri:bundle-server` and placed inside `desktop/resources/server-bundle/ripmail`. The Tauri app resolves it at that deterministic path and sets `RIPMAIL_BIN` for the Node child process.

Stale `ripmail-*` copies may still appear here from older workflows; they are gitignored.
