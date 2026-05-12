---
name: deploy
description: Describes Braintunnel hosted staging deploy flow (Docker image to DigitalOcean registry, deploy-* git tags, Watchtower rollout, New Relic markers). Use when deploying to staging, preparing a release, asking what changed since last deploy, or pre-push deploy risk and manual smoke checks.
disable-model-invocation: true
---

# Staging deploy (brain-app)

## What “deploy” means here

- **Target:** single **staging** environment (`https://staging.braintunnel.ai`; origin details in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- **Mechanism:** a developer runs **`npm run docker:deploy`** from the repo root (see [AGENTS.md](AGENTS.md): `nvm use` per [.nvmrc](.nvmrc)). That executes [`scripts/docker-deploy-do.sh`](scripts/docker-deploy-do.sh):
  1. **Build** a `linux/amd64` image and **push** to DigitalOcean Container Registry: `registry.digitalocean.com/braintunnel/brain-app` (also `:latest` unless `DOCKER_PUBLISH_LATEST=0`).
  2. **Git:** must be on **`main`** with a **clean** working tree; creates an **annotated git tag** and pushes it to `origin`.
  3. **Release notes** (optional): runs [`scripts/generate-release-notes.ts`](scripts/generate-release-notes.ts); may commit `docs/release-notes/<tag>.md` and push to `main` with message `chore: publish deploy release notes`.
  4. **New Relic:** records a **staging** deployment marker via `newrelic entity deployment create` (skippable). Env and flags are documented in [docs/newrelic.md](docs/newrelic.md) and the script header.
- **Rollout on the droplet:** **Watchtower** pulls the new image and restarts the stack — expect on the order of **~60 seconds downtime** per rollout ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

Deep infrastructure (DO project IDs, LB, firewall, volumes): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Registry / `doctl`: [docs/digitalocean.md](docs/digitalocean.md).

## Tags we use

| Tag | Role |
|-----|------|
| **`deploy-*`** | **Git** release identifiers. Default name is **UTC**: `deploy-YYYYMMDD-HHMMSSutc` (see `docker-deploy-do.sh`). Override with **`DOCKER_IMAGE_TAG`** (same string used for Docker image tag and git tag). |
| **`deploy-*` (previous)** | **Baseline** for “what shipped last time”: the most recent existing `deploy-*` tag **before** the new tag ([`pickPreviousDeployTag`](src/server/lib/release-notes-deploy.ts) over `git tag --list 'deploy-*' --sort=-version:refname`). Release notes use commits in **`git log <previousDeployTag>..HEAD`**. |

**Not semver:** versioning is **time-based deploy tags**, not `v1.2.3`.

**Docker registry:** images are tagged with that same **`deploy-…`** string (and usually `:latest`).

## Prerequisites (operator)

- Docker **buildx**; logged into DO registry (e.g. `./scripts/doctl-brain.sh registry login` — [docs/digitalocean.md](docs/digitalocean.md)).
- `git` on **`main`**, **clean** index and working tree; **`origin`** remote set.
- For NR marker: `newrelic` CLI on `PATH` and `NEW_RELIC_API_KEY` (or `SKIP_NEW_RELIC_DEPLOYMENT=1`).
- For LLM release notes: `OPENAI_API_KEY` (or `SKIP_RELEASE_NOTES=1`).

Relevant env vars: script header in [`scripts/docker-deploy-do.sh`](scripts/docker-deploy-do.sh), [docs/architecture/environment-variables.md](docs/architecture/environment-variables.md) (tooling section).

## What changed since last deploy

Assume **automation is green**; use git to understand **scope** and **risk** before running `npm run docker:deploy`.

1. **Fetch tags** so local view matches remote:
   ```sh
   git fetch origin --tags
   ```
2. **Last deploy tag** (newest `deploy-*`):
   ```sh
   git tag -l 'deploy-*' --sort=-version:refname | head -1
   ```
3. **Commits and messages since that tag** (preview of what the next image will contain if `HEAD` is what you deploy):
   ```sh
   LAST=$(git tag -l 'deploy-*' --sort=-version:refname | head -1)
   git log "${LAST}"..HEAD --oneline
   ```
   For more detail: `git log "${LAST}"..HEAD --format='%h %s%n%b%n---'` (subjects + bodies; release-note generation caps volume in [`scripts/generate-release-notes.ts`](scripts/generate-release-notes.ts)).
4. **Files touched** (helps risk triage):
   ```sh
   git diff "${LAST}"..HEAD --stat
   ```
5. **Optional:** read the last generated human summary under `docs/release-notes/deploy-*.md` for the **previous** tag’s narrative; the **next** run will add another file for the new tag after deploy.

If there is **no** prior `deploy-*` tag, the release-notes script treats the repo root as baseline (first deploy scenario).

## Deployment risk (lightweight)

Use commit messages and paths to judge blast radius. **No single checklist replaces judgment**; escalate manual smoke when anything **high-touch** appears.

**Higher concern (exercise extra care, read diffs, extend smoke):**

- **`src/server/ripmail/`**, SQLite schema / indexing (`SCHEMA_VERSION`, maildirs): potential **rebuilds**, latency, or data-shape assumptions ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) ripmail smoke).
- **Auth / OAuth / Gmail / tokens** (`google-oauth`, vault, session routes).
- **Agent runtime, tools, prompts** — behavior change for all chats.
- **Infra or env contracts** (`Dockerfile`, `docker-compose`, routing, `BRAIN_*` semantics).
- **Destructive or breaking** on-disk policy (repo defaults to **no migrations** for local/index data; still verify operator impact for hosted tenants).

**Medium concern:**

- New or changed **HTTP routes**, **wiki** ingestion, **notifications**, **inbox rules**.
- Large refactors in `src/server/` or `src/client/` with wide coupling.

**Lower concern:**

- **Docs-only**, **tests-only**, narrowly scoped **UI** with unchanged API contracts.

Factor in **Google OAuth testing mode** and **test user list** for sign-in smoke ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Last-minute manual checks before push

Assume **`npm run ci`** (or equivalent) has already passed on the commit you are deploying.

1. **Confirm branch/commit:** `main` at intended SHA; working tree clean (deploy script enforces this).
2. **Re-scan** `git log <lastDeployTag>..HEAD` for anything that slipped in (hotfix, WIP, unexpected merge).
3. **Match risk to smoke depth** (below).
4. **Registry / secrets:** can you push the image and (if not skipped) record NR / generate notes? Offline or missing keys → adjust `SKIP_*` env vars deliberately, not silently.

## After the image is live (smoke)

Follow **[Post-deploy smoke](docs/DEPLOYMENT.md#post-deploy-smoke)** in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): app up, Google sign-in (test user), Ripmail DB `user_version`, inbox/search/open, sync/errors, optional calendar/brain-to-brain depending on flags and release scope.

**Optional before hosted deploy:** `npm run test:e2e:enron` when local `./data` is seeded appropriately; Enron e2e may **skip** if the demo tenant does not match schema — do not treat skip as proof ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Related

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — canonical staging topology, smoke list, Watchtower.
- [docs/newrelic.md](docs/newrelic.md) — deployment markers, NRQL, staging entity.
- [.cursor/skills/newrelic/SKILL.md](.cursor/skills/newrelic/SKILL.md) — querying staging APM/logs after rollout.
