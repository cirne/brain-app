# Bundled ripmail binary (Tauri externalBin)

The `ripmail` executable is **built from this repo** ([`ripmail/`](../../ripmail/) workspace member), not downloaded separately. Tauri still bundles it as an [external binary (“sidecar”)](https://v2.tauri.app/develop/sidecar/): expect a **target triple** suffix on the file copied here (e.g. `ripmail-aarch64-apple-darwin`).

From the repo root:

```sh
npm run tauri:setup-sidecars
```

This runs `cargo build -p ripmail` and **copies** the binary to `ripmail-<host-triple>`. For release bundles, `npm run tauri:build` runs `tauri:setup-sidecars:release` (release binary). The copied file is gitignored.

Override the built binary with `RIPMAIL_SOURCE=/path/to/ripmail` if needed.
