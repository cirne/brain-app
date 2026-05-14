# Archived: OPP-052 — NR change tracking

**Status: Archived (2026-05-11).** Operations epic closed / no longer on active backlog.


---

## Original spec (historical)

### OPP-052: New Relic change tracking on Watchtower / container rollouts (operations)

**Status:** Proposed.

## Summary

**Staging** deploys are **registry + Watchtower**: the droplet pulls a new `registry.digitalocean.com/braintunnel/brain-app:latest` image and restarts the container, typically within ~[60 seconds of downtime per rollout](../../DEPLOYMENT.md). There is **no** automated signal in New Relic that ties APM charts to **which** image (digest, tag, or git SHA) is running, so operations cannot quickly answer “what changed before this error spike?”

This opportunity is to **record a New Relic change tracking event (deployment marker) whenever a new container image is actually running**—close to the [Watchtower](https://github.com/containrrr/watchtower) pull/restart model—without relying on a human or a separate pipeline step.

## Why not “just record it in CI”?

CI can run when an image is **pushed** to the registry, but that is not the same as **rolled out to the droplet**: Watchtower timing, failed pulls, or multiple hosts can desync “push time” from “serving time.” On-container or host-level markers align markers with the process that is actually taking traffic. CI markers remain useful as a **second** signal; this OPP focuses on **operational ground truth** at the running container.

## What New Relic supports (documentation)

- **Preferred:** [Change tracking — NerdGraph](https://docs.newrelic.com/docs/change-tracking/change-tracking-graphql/): `changeTrackingCreateEvent` mutation. Events are stored as `changeTrackingEvent` in NRDB. New Relic recommends this over the legacy “deployment only” path.
- **Legacy:** [Change tracking — `changeTrackingCreateDeployment`](https://docs.newrelic.com/docs/change-tracking/change-tracking-graphql/) (stored as `Deployment` events) — still supported, fewer features.
- **Older alternative:** [REST API v2 — recording deployments](https://docs.newrelic.com/docs/apis/rest-api-v2/application-examples-v2/recording-deployments-rest-api-v2/): New Relic’s docs recommend migrating to change tracking (NerdGraph) instead.
- **Introduction:** [Change tracking](https://docs.newrelic.com/docs/change-tracking/change-tracking-introduction/) (CLI, CI/CD, NerdGraph options).

NerdGraph endpoint (US): `https://api.newrelic.com/graphql` (see [NerdGraph introduction](https://docs.newrelic.com/docs/apis/nerdgraph/get-started/introduction-new-relic-nerdgraph/)).

## License key vs API key (critical)

| Credential | Typical env var | Used for |
|------------|------------------|----------|
| **Ingest / license key** | `NEW_RELIC_LICENSE_KEY` (and APM `NEW_RELIC_*`) | **Node agent** — metrics, traces, custom events to New Relic |
| **User API key** (`NRAK-…`) | e.g. `NEW_RELIC_API_KEY` (session/env; **not** the same as license) | **NerdGraph**, **New Relic CLI** (`newrelic nrql`, change tracking), REST APIs that expect user keys |

**Recording change tracking events is an API/GraphQL action, not agent ingest.** The license key in `.env` for the app **does not** substitute for a user API key when calling NerdGraph. The project already documents this split in [docs/newrelic.md](../../newrelic.md) and [.cursor/skills/newrelic/SKILL.md](../../.cursor/skills/newrelic/SKILL.md).

**Security note:** a user key in the same `.env` as the running container is **more powerful** than the license key (account-level API access, depending on user permissions). Prefer a **dedicated, minimally scoped** key and rotation if New Relic’s account settings allow; treat it like a secret (same care as `DO_TOKEN` / OAuth secrets).

## Is the New Relic CLI installed in the app image today?

**No.** The [Dockerfile](../../Dockerfile) `runtime` stage installs `ca-certificates`, `curl`, `libssl3`, and `tini` only. There is no `newrelic` CLI binary in the image.

**Options (pick one for implementation; can combine):**

1. **Startup one-shot in `ENTRYPOINT` / wrapper script** — After `tini` starts the app, a shell script (or a tiny `node` pre-hook) `curl`s NerdGraph with `Api-Key: <user key>` and a mutation, passing version from `VERSION`, image digest (if injected by compose), or `git` SHA at build time via `ARG`/`ENV`. **Requires** the user API key in the container env (or a short-lived token pattern if you add one).
2. **Droplet-side hook** — Script on the host run by cron or a systemd path unit after `docker compose` / Watchtower reports a new container (harder: Watchtower does not always expose a first-class “after deploy” hook; may require wrapping Watchtower or polling `docker inspect` for image ID changes).
3. **CI / registry webhook** — Record the marker at image publish time (simpler operationally, weaker correlation with *this* host’s rollout — see above).
4. **Install New Relic CLI in the image** — Possible but **not required**; `curl` + NerdGraph is enough if you do not need other `newrelic` subcommands in-container.

**Payload idea:** set `version` to something stable and comparable — e.g. `IMAGE_DIGEST` (sha256) and/or build-time `GIT_SHA`, and optional `changelog` / PR link in custom attributes (see NerdGraph examples in the [change tracking GraphQL](https://docs.newrelic.com/docs/change-tracking/change-tracking-graphql/) doc).

**Entity binding:** NerdGraph can use [entity search](https://docs.newrelic.com/docs/change-tracking/change-tracking-graphql/) in the mutation (so a fixed `entitySearch` string or GUID for **Braintunnel Staging** is fine — see [docs/newrelic.md](../../newrelic.md) entity GUIDs).

## Relationship to other docs

- [DEPLOYMENT.md](../../DEPLOYMENT.md) — Watchtower, droplet, registry flow.
- [docs/newrelic.md](../../newrelic.md) — account id, `NEW_RELIC_APP_NAME` for staging, license vs user key.
- [SECURITY.md](../../SECURITY.md) — P4 (Watchtower + registry): deployment markers do not remove that class of risk; they improve **observability** after a rollout.

## Acceptance criteria (draft)

- [ ] A new staging rollout (push `:latest` → Watchtower restarts) produces a **visible** change tracking marker on the [Braintunnel Staging] APM / change tracking UI, with **version** or attributes identifying the image (digest and/or git SHA).
- [ ] `NEW_RELIC_LICENSE_KEY` alone is not mistaken for “enough to mark deploys” in runbooks: operator docs call out **user API key** for this feature.
- [ ] Secrets: user API key is not logged in app stdout; rotation path documented in DEPLOYMENT or newrelic doc as needed.

## Out of scope (for this OPP)

- Production multi-tenant APM naming (not in account yet per [newrelic.md](../../newrelic.md)).
- Replacing Watchtower; this is about **observability** of its rollouts, not the pull model itself.
