# OPP-013: Docker deployment (restoration)

**Status:** Future — in-repo Docker packaging was **removed** in favor of `BRAIN_HOME` + macOS Tauri as the primary release ([OPP-012](OPP-012-brain-home-data-layout.md)). This document captures what existed so a future pass can revive or compare.

## Last commit on `main` with Docker artifacts

Full tree at this revision (inspect or extract paths without checkout):

**`856eec33f49660b6906a32912a42c629b234611a`**

```sh
git show 856eec33f49660b6906a32912a42c629b234611a:Dockerfile
git show 856eec33f49660b6906a32912a42c629b234611a:docker-compose.yml
git show 856eec33f49660b6906a32912a42c629b234611a:start.sh
git show 856eec33f49660b6906a32912a42c629b234611a:.github/workflows/docker-publish.yml
```

Optional tarball of only those paths:

```sh
git archive 856eec33f49660b6906a32912a42c629b234611a \
  Dockerfile docker-compose.yml start.sh .github/workflows/docker-publish.yml \
  -o brain-docker-snapshot.zip
```

## What the stack did

- **`Dockerfile`:** Multi-stage build — Rust stage built `ripmail` from the monorepo, Node stage ran production `npm ci` / `npm run build`, copied `dist/`, installed `ripmail` to `/usr/local/bin`, created `/wiki` and `/ripmail`, `ENV RIPMAIL_HOME=/ripmail`, `CMD ./start.sh`.
- **`docker-compose.yml`:** Service `brain`, `env_file: .env`, overrides for `WIKI_DIR=/wiki`, `RIPMAIL_HOME=/ripmail`, `PORT=4000` (mapped host 4000).
- **`start.sh`:** Ensured `WIKI_DIR` existed, optional non-interactive `ripmail setup` when `config.json` was missing (env-driven), ran `node dist/server/sync-cli.js` then `node dist/server/index.js`.
- **`.github/workflows/docker-publish.yml`:** On push to `main`, built and pushed `ghcr.io/<owner>/<repo>` (GHCR).

## Operational notes (for a future redesign)

- In-image paths were **`/wiki`** (wiki root) and **`/ripmail`** (`RIPMAIL_HOME`). No default bind mount; persistence required explicit `-v` flags.
- **`WIKI_GIT_TOKEN`** / git clone behavior was documented in [ARCHITECTURE.md](../ARCHITECTURE.md) before Docker removal (authenticated wiki clone at container startup).
- Compose merged **project `.env`** with **`environment:`** in the service — order of precedence mattered for local overrides.

## Relation to current layout

New installs use **`BRAIN_HOME`** (see [`shared/brain-layout.json`](../../shared/brain-layout.json)) and the native app; a future Docker image should derive paths from that same JSON rather than hardcoding `/wiki` only.
