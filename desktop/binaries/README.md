# `desktop/binaries/` (legacy)

Tauri no longer uses `externalBin` sidecars from this directory. The bundled Node server loads **`dist/server`** + **`src/server/ripmail/`** (in-process mail); there is **no** ripmail ELF in `server-bundle/`.

Stale `ripmail-*` copies may still appear here from older workflows; they are gitignored.
