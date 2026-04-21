# OPP-041: Hosted cloud epic — Docker, durable storage, multi-tenant, DigitalOcean

## Summary

**Status:** Epic — **Phases 0–2 are complete** (April 2026). Next focus: Phase 3 onward (multi-tenant data plane, then identity / DO staging as sequenced below). Advanced storage topics (WAL tuning, Litestream, snapshot playbooks) remain **out of scope** for this epic until needed.

**Intent:** Sequence milestones from **today** (single-tenant desktop and dev server, `[BRAIN_HOME](OPP-012-brain-home-data-layout.md)` + [layout JSON](../../shared/brain-layout.json)) to a **Linux container** deployment on **DigitalOcean** that is **usable by test users** in a **relatively secure** way: **Google** as the identity and mail/calendar connector, **per-tenant durable disk** (survive image updates and reboots), and a **vault password** layered on top for unlock semantics and future mobile access—without pretending we ship **macOS-only** integrations (Full Disk Access, iMessage, bundled loopback OAuth) in this slice.

This epic **does not** replace the native app ([archived OPP-007](archive/OPP-007-native-mac-app.md)); it implements the **cloud** branch of [deployment-models.md](../architecture/deployment-models.md).

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

**Security bar:** Treat **cross-tenant contamination** as a shipping risk class; follow the checklist in [packaging-and-distribution.md](../packaging-and-distribution.md) and the guardrails in [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md).

---

## Milestones (recommended order)

Each phase has **exit criteria** so work can pause between them without half-finished production exposure.

**Done so far:** Phase 0 (scope / parity doc), Phase 1 (single-tenant Docker on a developer machine), and Phase 2 (mounted `BRAIN_HOME` survives container stop/start) are **closed**.

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

**Exit criteria:** Documented repro: **delete and recreate** the container (same mount) → user data still present; ripmail and wiki paths consistent.

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

**Goals**

- **Choose compute shape:**
  - **App Platform:** Officially oriented around **ephemeral** local disk for workloads; persistent data is expected to use **Spaces**, managed DB, or external services ([DO: Store data in App Platform](https://docs.digitalocean.com/products/app-platform/how-to/store-data)). Brain’s current **on-disk wiki + ripmail SQLite** layout maps naturally to **block storage**, not to ephemeral instance disk. **Do not assume** block volumes can mount on App Platform without verifying current product limits—today this is usually a poor fit for “large ripmail index on local filesystem” unless storage is redesigned.
  - **Droplet + Block Storage Volume (recommended v1):** One or more Droplets, **ext4** volume mounted at `DATA_ROOT`, Docker (or Compose), firewall, automated **volume snapshots**. Matches “NAS / block storage” in [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md).
  - **DOKS:** Possible later: persistent volumes per tenant or shared node with CSI—more moving parts for a first cohort.
- **TLS:** Terminate TLS (Caddy/Traefik/Nginx or DO load balancer) with real certificates.
- **Secrets:** LLM and `GOOGLE_OAUTH_`* via DO secrets or env injection; contrast with **embedded** secrets in the desktop build ([AGENTS.md](../../AGENTS.md)).
- **Automation:** `doctl` commands or IaC notes for: Droplet, volume, mount, firewall, DNS.

**Exit criteria:** Staging URL used by internal testers; documented **deploy and rollback** steps; backups/snapshots scheduled.

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

**Fast path to learning:** Phases 0–1 are **done**; then Phase 2 → Phase 5 (single-tenant on a Droplet) **before** full Phase 3–4 multiplexing, if the goal is to validate ripmail + OAuth + TLS on the internet with one brave user. **Do not** skip isolation work before inviting arbitrary parallel users—Phase 3 and Phase 4 are **gating** for a multi-user URL.