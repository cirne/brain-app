# Bundled resources

- **`server-bundle/`** — produced by `npm run desktop:bundle-server` (copies `dist/`, production `node_modules`, and the current `node` binary). Gitignored; CI must run `npm run build && npm run desktop:bundle-server` before `tauri build`.
