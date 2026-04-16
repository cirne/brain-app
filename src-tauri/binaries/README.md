# Bundled sidecar binaries

Tauri expects third-party executables here with a **target triple** suffix (see [Embedding external binaries](https://v2.tauri.app/develop/sidecar/)).

For `ripmail`, run from the repo root:

```sh
npm run tauri:setup-sidecars
```

This symlinks `ripmail-<host-triple>` to the `ripmail` on your `PATH` (or `RIPMAIL_SOURCE`). The symlink is gitignored; CI/release builds should place the real binary here.
