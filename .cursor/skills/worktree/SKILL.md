---
name: worktree
description: >-
  Create and run parallel git worktrees for brain-app with shared ./data + .env
  via symlink, and Cursor one-window-per-checkout. Use when the user invokes
  /worktree, asks to add a worktree, or run parallel features.
---

# Worktree (brain-app)

Run **multiple branches in parallel** in separate directories. **`.env`, `.cache/enron` (Enron tarball), and `./data` symlink to the primary clone** by default (never copy).

**Dev URL (primary clone):** `http://127.0.0.1:3000` (`pnpm run dev`). Parallel worktrees on the same machine need a **different `PORT`** in `.env.local` (e.g. `PORT=3001`) — port strategy for worktrees is not automated yet.

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

## OAuth

- **Primary clone:** Google sign-in at `http://127.0.0.1:3000` — redirect URI `http://127.0.0.1:3000/api/oauth/google/callback` ([docs/google-oauth.md](../../../docs/google-oauth.md)).
- **Secondary worktrees:** use **Enron demo** (`BRAIN_ENRON_DEMO_SECRET` + `pnpm run brain:seed-enron-demo`) or run only one tree with Google at a time on port 3000.

## Shared cache + `./data` (default)

Bootstrap **`scripts/worktree-bootstrap.mjs`** symlinks:

- **`.cache/enron` → primary** — reuses the verified Enron tarball (~1.7 GiB); worktrees must not re-download.
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
| Port already in use | Set **`PORT=3001`** (or free 3000 with **`pnpm run dev:kill`**) in `.env.local` for the second checkout |
| OAuth redirect mismatch | Open the same host as redirect URI (`127.0.0.1:3000`); or set **`PUBLIC_WEB_ORIGIN`** to match the browser URL |
| Two trees, one Google session | Prefer Google on **primary** only; Enron demo on side trees |

## Related

- [AGENTS.md](../../../AGENTS.md) — dev commands
- [docs/google-oauth.md](../../../docs/google-oauth.md)
- [`../commit/SKILL.md`](../commit/SKILL.md)
