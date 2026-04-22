# OPP-041: Hosted cloud epic — Docker, durable storage, multi-tenant, DigitalOcean

## Summary

**Status:** Epic — **Phases 0–2 are complete** (April 2026). **DigitalOcean staging is live:** amd64 image from Container Registry on a **staging droplet** (e.g. internal host `braintunnel-staging`), Brain listening on **port 4000 over plain HTTP**. Durable state uses a **fixed Docker named volume** (`brain_data` → `/brain-data` via `BRAIN_DATA_ROOT` in `[docker-compose.do.yml](../../docker-compose.do.yml)`) so **image pulls, container restarts, and recreate** are **non-destructive** to wiki, vault, ripmail, and chats.

> **WARNING — naked HTTP:** Staging currently exposes the app **without TLS** at the edge. Traffic (cookies, OAuth redirects, page loads) is **visible on the wire** to anyone on the path. Treat this as **internal / staging only** until HTTPS is terminated (reverse proxy, Caddy, nginx, or DigitalOcean Load Balancer). See [Next steps (HTTPS / edge)](#next-steps-https--edge) below.

**Next focus:** wire **HTTPS + public origin** for real testers; then Phase 3–4 (multi-tenant data plane, Google identity + vault). Advanced storage topics (WAL tuning, Litestream, snapshot playbooks) remain **out of scope** until needed.

**Intent:** Sequence milestones from **today** (single-tenant desktop and dev server, `[BRAIN_HOME](OPP-012-brain-home-data-layout.md)` + [layout JSON](../../shared/brain-layout.json)) to a **Linux container** deployment on **DigitalOcean** that is **usable by test users** in a **relatively secure** way: **Google** as the identity and mail/calendar connector, **per-tenant durable disk** (survive image updates and reboots), and a **vault password** layered on top for unlock semantics and future mobile access—without pretending we ship **macOS-only** integrations (Full Disk Access, iMessage, bundled loopback OAuth) in this slice.

This epic **does not** replace the native app ([archived OPP-007](archive/OPP-007-native-mac-app.md)); it implements the **cloud** branch of [deployment-models.md](../architecture/deployment-models.md).

**Related:** [OPP-042: Brain network & inter-brain trust](./OPP-042-brain-network-interbrain-trust-epic.md) — **Braintunnel handle–first** identity and inter-brain coordination assume **stable, reachable endpoints**; production HTTPS and `PUBLIC_WEB_ORIGIN` (this epic) are prerequisites for trustworthy cross-brain UX.

---

## Why this is not a contradiction with archived OPP-013

[Archived OPP-013](archive/OPP-013-docker-deployment.md) marked in-repo Docker as **“will not do”** for the **primary** product direction when the goal was **macOS parity** (FDA, local `chat.db`, etc.). A **hosted Linux** deployment explicitly **drops** those features and ships a **cloud-safe subset**—same core stack (Hono, Svelte, pi-agent-core, ripmail subprocess), different **storage and auth** layers, as already anticipated in [deployment-models.md](../architecture/deployment-models.md) and [PRODUCTIZATION.md](../PRODUCTIZATION.md).

Historical Docker artifacts were removed from the monorepo; the last snapshot is described in the archive file (git SHA `856eec33`). New packaging should derive paths from `**shared/brain-layout.json`**, not hardcoded `/wiki`-only roots.

---

## North-star outcome (test users)

1. User opens a **public HTTPS** URL for the staging/prod environment.
2. **Sign in with Google** establishes product identity and drives Gmail/Calendar consent in line with [OPP-019](OPP-019-gmail-first-class-brain.md) and [google-oauth.md](../google-oauth.md) (hosted redirect URIs, not loopback-only).
3. User chooses a **vault password** (and unlock flow) so sensitive operations remain gated similarly to today’s model ([OPP-035](OPP-035-local-vault-password-and-session-auth.md)), adapted for hosted cookies/TLS/CSRF.
4. The system provisions or attaches a **tenant-scoped home directory** containing wiki, chats, `var/`, `cache/`, and `**ripmail/`** (`RIPMAIL_HOME` layout unchanged per tenant).
5. **Background sync** can run 24/7; **container replacements** do not wipe user data because `**BRAIN_HOME` lives on attached block storage**, not the container’s ephemeral layer.

**Staging (April 2026) — what is deployed today**


| Item             | Detail                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compute**      | DigitalOcean **staging droplet** (amd64), Docker Engine + Compose plugin                                                                                                                              |
| **Image**        | `registry.digitalocean.com/braintunnel/brain-app` (`npm run docker:publish`, default `**linux/amd64`**)                                                                                               |
| **Compose**      | `[docker-compose.do.yml](../../docker-compose.do.yml)` — `platform: linux/amd64`, `PORT=4000` in-container                                                                                            |
| **Listen**       | Host `**${BRAIN_DOCKER_PORT:-4000}:4000`**, **HTTP only** (no TLS inside the Brain container)                                                                                                         |
| **Durable data** | Docker **named volume** `brain_data` mounted at `**/brain-data`**; `BRAIN_DATA_ROOT=/brain-data` so the app’s home tree lives **outside** the image layer — **updates and restarts do not wipe data** |


Runbook pointers: [digitalocean.md](../digitalocean.md).

**Security bar:** Treat **cross-tenant contamination** as a shipping risk class; follow the checklist in [packaging-and-distribution.md](../packaging-and-distribution.md) and the guardrails in [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md). **In addition:** until HTTPS is enabled, treat **traffic confidentiality** as **not met** for any sensitive cohort.

---

## Milestones (recommended order)

Each phase has **exit criteria** so work can pause between them without half-finished production exposure.

**Done so far:** Phase 0 (scope / parity doc), Phase 1 (single-tenant Docker on a developer machine), Phase 2 (mounted home survives container stop/start — **validated on staging** via named volume + `BRAIN_DATA_ROOT`), and **Phase 5 staging slice** (droplet + registry + compose + HTTP :4000) are **closed or in progress** as noted under Phase 5.

### Phase 0 — Written scope and parity matrix (no new infra)

**Status: complete** — deliverable: [cloud-hosted-v1-scope.md](../architecture/cloud-hosted-v1-scope.md).

**Goals**

- **Cloud parity matrix:** For every major route in [runtime-and-routes.md](../architecture/runtime-and-routes.md), mark *supported*, *disabled*, or *stub* in cloud (e.g. `/api/imessage`, bundled-only TLS allowlists, `allowLanDirectAccess`).
- **Storage decision (wiki):** [PRODUCTIZATION.md §2](../PRODUCTIZATION.md) still applies—git-backed wiki vs object storage vs “files on volume only” affects onboarding friction. Pick a **default for v1 hosted** (often: **files on tenant volume**, no git, until a later migration story).
- **OAuth:** Plan **authorized redirect URIs** for real origins (`https://<host>/api/oauth/google/callback`); note [OPP-022](OPP-022-google-oauth-app-verification.md) for anything beyond testing-mode cohorts.

**Exit criteria:** A short internal doc listing *what we ship in cloud v1* and *what we explicitly do not* — satisfied by [cloud-hosted-v1-scope.md](../architecture/cloud-hosted-v1-scope.md) (includes the `**googleOAuthRedirectUri` loopback gap** to fix in Phase 1+).

---

### Phase 1 — Single-tenant container on a developer machine

**Status: complete** — root `[Dockerfile](../../Dockerfile)` + `[docker-compose.yml](../../docker-compose.yml)`; `env_file: .env`; compose sets `BRAIN_HOME=/brain`, `RIPMAIL_BIN=/usr/local/bin/ripmail`, and `**PORT=4000`** (in-container; host maps `${BRAIN_DOCKER_PORT:-4000}:4000`). `**ripmail` is not compiled inside the app image:** `[npm run docker:ripmail:build](../../package.json)` (see `[scripts/docker-prebuild-ripmail.mjs](../../scripts/docker-prebuild-ripmail.mjs)`) produces `.docker/linux-ripmail/ripmail` via **host `cargo`** on matching Linux or a `**rust:bookworm` one-off** with persistent Cargo volumes on macOS; then the Dockerfile `COPY`s that binary. Runtime gates **macOS-only** paths (e.g. local Messages, Apple Mail onboarding) so Linux/Docker matches the cloud parity matrix.

**Goals**

- **Dockerfile** (multi-stage): build **ripmail** from this monorepo, production **Node** build (`npm ci`, `npm run build`), install binary on `PATH`, default `**RIPMAIL_HOME`** under the mounted `**BRAIN_HOME`** per layout JSON.
- **Compose (optional):** one service, `**BRAIN_HOME`** on a **named volume** (or bind mount `./data:/brain` if you prefer).
- **Runbook:** env vars per [configuration.md](../architecture/configuration.md); document differences from `npm run dev` (no Vite middleware—production static).

**Run locally**

```sh
cp .env.example .env   # set keys (e.g. ANTHROPIC_API_KEY, GOOGLE_OAUTH_*)
npm run docker:up
# → http://localhost:${BRAIN_DOCKER_PORT:-4000}
```

**Exit criteria:** A maintainer can `npm run docker:up`, complete onboarding against a **fresh** mounted directory, connect Gmail, and run chat + wiki + inbox for **one** synthetic user.

---

### Phase 2 — Durable disk pattern (ephemeral container, persistent data)

**Goals**

- Treat the **mounted volume** as the only persistence boundary: image updates, container recreation, and host reboot must **not** lose `BRAIN_HOME`.
- **Operational notes:** SQLite WAL, single-writer expectations, backup/snapshot story (provider snapshots + optional Litestream/S3-style off-site per [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md)).
- **Local simulation:** Use a dedicated host path or a single **block volume** on a VM to mimic production before multi-tenant routing exists.

**Exit criteria:** Documented repro: **delete and recreate** the container (same mount) → user data still present; ripmail and wiki paths consistent. **Staging:** `docker compose -f docker-compose.do.yml pull && … up -d` against the same host leaves `**brain_data`** intact.

---

### Phase 3 — Multi-tenant **data plane** in one Node process (“uber-container”)

**Goals**

- **One tenant, one home:** e.g. `<DATA_ROOT>/<tenant_id>/` is a full `BRAIN_HOME` tree (wiki, ripmail, chats, `var/`, `cache/`).
- **Isolation guardrails** from [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md): explicit per-request context (e.g. `AsyncLocalStorage`), **no ambient** `BRAIN_HOME` for request handlers, **path jailing** for agent/wiki tools, **ripmail** invoked with explicit home arguments (or per-tenant env injection scoped to the subprocess—prefer explicit flags if/when ripmail supports them broadly).
- **Tests:** Concurrent requests for two tenants; attempts to escape with `..` paths; grep/search must not leak across homes ([PRODUCTIZATION.md](../PRODUCTIZATION.md) themes).

**Exit criteria:** Automated tests prove **no cross-tenant file or SQLite access** under the multiplexed server; load smoke optional.

**Note:** [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md) phases 2–3 (routing layer, per-tenant pods) are **scale follow-ons**, not required for the first DO deployment if a single VM + single process is enough for test users.

---

### Phase 4 — Identity: Google + username + vault

**Goals**

- **Primary login:** Google OAuth as product authentication (aligned with [PRODUCTIZATION.md §3](../PRODUCTIZATION.md)).
- **Stable internal `tenant_id`:** Map Google subject (and/or verified email) to an internal id; persist mapping in a **small product-owned store** (see [PRODUCTIZATION.md](../PRODUCTIZATION.md) on SQLite per tenant vs global registry—likely a **global** metadata DB or config store **plus** per-tenant `BRAIN_HOME` on disk).
- **Username / handle:** Default **local-part** of the primary Google email (e.g. `lewiscirne@gmail.com` → `lewiscirne`). **Collision policy** must be defined (suffix numeric, random tail, or email-scoped display). Product copy should distinguish **login identifier** vs **Google email**.
- **Vault password:** After OAuth, user sets (or confirms) a **vault password** so unlock semantics remain meaningful for **phone / additional devices** and for encrypting or sealing sensitive material if we extend beyond today’s verifier model. Exact cryptography (verifier-only vs at-rest encryption) is a **product decision**—[multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md) currently biases toward **isolation + encryption-at-rest on the volume** while deferring app-level encryption tradeoffs.
- **Sessions:** Move from “single-user cookie” to **tenant-scoped** server sessions (or signed tokens) suitable for HTTPS deployment; revisit bundled-only cookie rules from [runtime-and-routes.md](../architecture/runtime-and-routes.md).

**Exit criteria:** New Google account can sign in, receive a **unique** tenant home, set vault, unlock, and use APIs—second user cannot read the first user’s wiki or mail index.

---

### Phase 5 — DigitalOcean: staging environment

**Status: staging online; TLS / production edge incomplete (April 2026)**

**Done (staging slice)**

- **Droplet + Docker + Compose:** Staging host running `[docker-compose.do.yml](../../docker-compose.do.yml)`; image from **Container Registry** (`npm run docker:publish`, `**linux/amd64`**).
- **HTTP :4000:** App reachable on host port **4000** (plain HTTP). Firewall allows the published port per [digitalocean.md](../digitalocean.md).
- **Non-destructive updates:** Durable data in Docker named volume `**brain_data`** (`BRAIN_DATA_ROOT=/brain-data`); pulling a new image and recreating the container **does not** wipe user data.
- **CLI / registry:** `doctl` contexts, `**./scripts/doctl-brain.sh`**, publish script — [digitalocean.md](../digitalocean.md).

**Still open (Phase 5 exit criteria)**

- **HTTPS** at the edge and a **stable public origin** (`PUBLIC_WEB_ORIGIN`, Google OAuth redirect URIs) — see [Next steps (HTTPS / edge)](#next-steps-https--edge).
- **Optional hardening:** Dedicated **Block Storage** volume mounted at the Docker data root (vs default local disk on the droplet), automated **volume snapshots**, documented **rollback** for image tags.
- **Longer-term compute options** (unchanged from planning):
  - **App Platform:** Often a poor fit for large on-disk ripmail/wiki without storage redesign ([DO: Store data in App Platform](https://docs.digitalocean.com/products/app-platform/how-to/store-data)).
  - **Droplet + Block Storage Volume (recommended for production v1):** **ext4** volume at `DATA_ROOT`, snapshots — aligns with [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md).
  - **DOKS:** Later if we outgrow single-VM Compose.

**Exit criteria (updated):** Staging proves **pull + recreate** without data loss (**met**). Remaining: **HTTPS URL** for internal testers; documented **deploy and rollback**; backups/snapshots **scheduled** for anything beyond dev staging.

---

### Next steps (HTTPS / edge)

1. **Terminate TLS** in front of the container — e.g. **Caddy** or **nginx** on the droplet (Let’s Encrypt), or a **DigitalOcean Load Balancer** / **Cloudflare** (or similar) forwarding to the droplet’s **4000** (or to **80/443** on the proxy).
2. Set `**PUBLIC_WEB_ORIGIN`** in droplet `.env` to the **canonical `https://…`** origin users open (required for OAuth and cookie semantics; see [google-oauth.md](../google-oauth.md), [cloud-hosted-v1-scope.md](../architecture/cloud-hosted-v1-scope.md)).
3. In **Google Cloud Console**, add **Authorized redirect URIs** for that origin (e.g. `https://<host>/api/oauth/google/callback`).
4. **Restrict exposure:** Prefer **not** exposing raw **:4000** on the public Internet once 443 is live; firewall to **22 + 80 + 443** (or LB health paths only) as appropriate.
5. Re-run **smoke tests** (vault, Gmail connect, chat) over **HTTPS** before widening the tester list.

---

### Phase 6 — Test-user hardening

**Goals**

- Rate limiting, abuse controls, structured logging with **tenant id** and **redaction** for mail/wiki snippets.
- Threat modeling pass on **agent tools** (path arguments, file reads, search) under multi-tenant load.
- Optional: IP allowlists, invite-only signup, or OAuth allowlisting for first cohort.

**Exit criteria:** Checklist completed; known scary gaps documented before widening access.

---

## Dependencies and related opportunities


| Doc / OPP                                                                                | Relevance                                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [PRODUCTIZATION.md](../PRODUCTIZATION.md)                                                | Multi-user blockers: wiki storage, auth, ripmail UX, SQLite strategy |
| [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md) | One home per tenant, NAS, isolation phases                           |
| [deployment-models.md](../architecture/deployment-models.md)                             | Desktop vs cloud split                                               |
| [OPP-019](OPP-019-gmail-first-class-brain.md)                                            | Gmail OAuth in app, token layout under `RIPMAIL_HOME`                |
| [OPP-022](OPP-022-google-oauth-app-verification.md)                                      | Verification for non-test Google projects                            |
| [OPP-035](OPP-035-local-vault-password-and-session-auth.md)                              | Vault + session baseline to generalize                               |
| [packaging-and-distribution.md](../packaging-and-distribution.md)                        | Cloud security checklist                                             |


---

## Open questions (explicit product/engineering choices)

1. **Wiki:** **v1 hosted default decided** — plain tree on volume, no git; see [cloud-hosted-v1-scope.md](../architecture/cloud-hosted-v1-scope.md). Longer term: [PRODUCTIZATION.md §2](../PRODUCTIZATION.md) (object storage, hosted git, etc.).
2. **Vault password:** Unlock only vs key derivation for additional encrypted blobs (attachments, exports).
3. **Ripmail driving:** Subprocess remains fine for early cloud; long-term programmatic sync API per PRODUCTIZATION §4.
4. **DO App Platform:** Only revisit if we redesign storage around Spaces/DB **or** if DO adds block volumes for App Platform; re-check docs at implementation time.

---

## Suggested sequencing for a small team

**Fast path to learning:** Phases 0–2 and a **Phase 5 staging droplet** are **done** for **HTTP** and durable volume behavior. **Before** inviting non-internal testers: complete **HTTPS + `PUBLIC_WEB_ORIGIN`** ([Next steps (HTTPS / edge)](#next-steps-https--edge)). Full Phase 3–4 multiplexing remains **gating** for arbitrary **multi-user** URLs.