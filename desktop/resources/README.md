# Bundled resources

- **`server-bundle/`** — produced by `pnpm run desktop:bundle-server` (copies `dist/`, production `node_modules`, and the current `node` binary). Gitignored; CI must run `pnpm run build && pnpm run desktop:bundle-server` before `tauri build`.
