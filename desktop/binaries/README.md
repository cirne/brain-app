# `desktop/binaries/` (legacy)

Tauri **no longer** bundles ripmail as an `externalBin` sidecar. Build ripmail from [`ripmail/`](../../ripmail/) with `npm run ripmail:dev` or `cargo build -p ripmail`, and ensure `ripmail` is on `PATH` or set `RIPMAIL_BIN`.

Stale `ripmail-*` copies may still appear here from older workflows; they are gitignored.
