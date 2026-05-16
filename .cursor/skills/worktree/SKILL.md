---
name: worktree
description: >-
  Create and run parallel git worktrees for brain-app with portless (stable
  .localhost URLs per branch), shared ./data + .env via symlink, and Cursor one-window-per-checkout.
  Use when the user invokes /worktree, asks to add a worktree, run parallel features, or avoid port conflicts.
---

# Worktree + portless (brain-app)

Run **multiple branches in parallel** without fighting for port 3000. Each checkout is a separate directory; **`.env`, `.cache/enron` (Enron tarball), and `./data` symlink to the primary clone** by default (never copy). **`pnpm run dev`** uses **portless** so each worktree gets a stable HTTPS URL.

## URLs (portless)

| Checkout | Typical URL |
|----------|-------------|
| Primary clone on `main` | `https://braintunnel.localhost:1355` |
| Worktree on branch `feat/tool-ui` | `https://feat-tool-ui.braintunnel.localhost:1355` |

Proxy listens on **1355** (no sudo). App port is auto-assigned (4000–4999). Portless sets **`PORT`** and **`PORTLESS_URL`**; `scripts/run-dev.mjs` maps **`PORTLESS_URL` → `PUBLIC_WEB_ORIGIN`** for Gmail OAuth.

**Loopback escape hatch:** `pnpm run dev:direct` → `http://127.0.0.1:3000` (single instance; classic OAuth redirect).

## Quick: add a worktree

From the **primary** clone:

```sh
nvm use
node scripts/worktree-bootstrap.mjs ../brain-app-wt-NAME feat/NAME --create
cd ../brain-app-wt-NAME
pnpm run dev
```

Without `--create` (path already exists):

```sh
git worktree add ../brain-app-wt-NAME -b feat/NAME origin/main
node scripts/worktree-bootstrap.mjs ../brain-app-wt-NAME feat/NAME
```

Manual equivalent:

```sh
git worktree add ../brain-app-wt-NAME -b feat/NAME origin/main
cd ../brain-app-wt-NAME
ln -sf ../brain-app/.env .env
mkdir -p .cache && ln -sf ../../brain-app/.cache/enron .cache/enron
ln -sf ../brain-app/data data
nvm use && pnpm install --frozen-lockfile
pnpm run dev
```

## OAuth per worktree

1. After `pnpm run dev`, run **`pnpm exec portless get braintunnel`** in that checkout and note the HTTPS origin.
2. Register **`{origin}/api/oauth/google/callback`** in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (see [docs/google-oauth.md](../../../docs/google-oauth.md)).
3. Or on **secondary** worktrees use **Enron demo** (`BRAIN_ENRON_DEMO_SECRET` + `pnpm run brain:seed-enron-demo`) and skip Google on that tree.

**Primary clone** should stay the “real sign-in” instance when possible.

## Shared cache + `./data` (default)

Bootstrap **`scripts/worktree-bootstrap.mjs`** symlinks:

- **`.cache/enron` → primary** — reuses the verified Enron tarball (~1.7 GiB); worktrees must not re-download.
- **`./data` → primary** — shared tenants, mail index, and sessions for typical feature work.

- **Do not copy `./data` or the tarball** into worktrees unless the user explicitly asks (use **`--own-data`** for an isolated `./data` only; tarball cache stays shared).
- **`pnpm run dev:clean`** in a worktree with a symlinked `./data` removes **only the symlink**, not the primary data tree (see `scripts/clean-dev-data-root.mjs`). Run **`pnpm run dev:clean`** from the **primary** clone to wipe shared data.

**`--own-data`** — skip the `./data` symlink; worktree gets its own empty/local `./data` (migrations, destructive experiments, schema breaks).

## Cursor + agents

- **One Cursor window per worktree** (open that folder).
- **One agent thread per feature branch** until merge.
- Run **`nvm use`** and git commands from **`git rev-parse --show-toplevel`** (this checkout).
- Finish with **`/commit`** on the feature branch ([`../commit/SKILL.md`](../commit/SKILL.md) §4), then **land on `main`** (§5 below). **No pull requests** for solo workflow.

## Finish: merge to `main` and remove worktree

When the feature is done and **`/commit`** has pushed the branch:

```sh
# 1. Primary clone — update main and merge (fast-forward when possible)
cd /path/to/brain-app          # primary, on main
git fetch origin
git checkout main
git pull --ff-only origin main
git merge --ff-only feat/NAME
git push origin main

# 2. Remove worktree + delete feature branch (local + remote)
git worktree remove ../brain-app-wt-NAME
git branch -d feat/NAME
git push origin --delete feat/NAME
```

Do **not** `rm -rf` the worktree path without `git worktree remove`. Close the Cursor window for that folder after removal.

## Git housekeeping

```sh
git worktree list
```

Git refuses two worktrees on the **same branch** — use different branch names.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Proxy is not running` / sudo prompt | Use **`pnpm run dev`** (sets `PORTLESS_PORT=1355`) or once: **`pnpm run dev:proxy`** |
| `already registered by a running process` | Stop other dev in that tree: **`pnpm exec portless prune`**, or kill the PID from **`pnpm exec portless list`** |
| OAuth redirect mismatch | Set **`PUBLIC_WEB_ORIGIN`** to match browser URL, or rely on auto **`PORTLESS_URL`** from portless |
| Need plain port 3000 | **`pnpm run dev:direct`** in **one** checkout only |
| TLS warnings | Once per machine: **`pnpm exec portless trust`** |

## Related

- [AGENTS.md](../../../AGENTS.md) — dev commands
- [docs/google-oauth.md](../../../docs/google-oauth.md)
- [portless.json](../../../portless.json)
- [`../commit/SKILL.md`](../commit/SKILL.md)
