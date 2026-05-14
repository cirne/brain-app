# Archived: OPP-041 (Hosted cloud epic)

**Status: Closed for current scale (2026-04-22).** Staging at `https://staging.braintunnel.ai` is **stable enough** to support on the order of **10–50 users**; **Phases 3–4** (higher scale, deeper multi-tenant isolation proofs) are **deferred** while the team prioritizes **cloud** product work over incremental hosting hardening. The document below is the **historical spec, milestones, and runbook** — **reopen** this epic when load, compliance, or operator need requires it. See [digitalocean.md](../../digitalocean.md), [packaging-and-distribution.md](../../packaging-and-distribution.md).

---

# OPP-041: Hosted cloud epic — Docker, durable storage, multi-tenant, DigitalOcean

## Summary

**Status: Epic — closed for the current scale target (2026-04-22).** **Phases 0–2, 5, and 6 are complete** (April 2026). **Public staging:** `**https://staging.braintunnel.ai`** — TLS at the edge, **Sign in with Google**, onboarding (mail sync can take a while on first run), and **automatic wiki build** validated with friendly testers. The Brain container still listens on **port 4000** inside the stack; users hit **HTTPS** on the public hostname. Durable state uses a **fixed Docker named volume** (`brain_data` → `/brain-data` via `BRAIN_DATA_ROOT` in `[docker-compose.do.yml](../../../docker-compose.do.yml)`) so **image pulls, container restarts, and recreate** are **non-destructive** to wiki, vault, ripmail, and chats.

**Next focus (epic remainder) — deferred:** **Phase 3–4** as needed for **scale, isolation guarantees, and product identity** beyond the current staging slice — see milestones below. **Path jailing** (historical **[BUG-012 (archived)](../../bugs/archive/BUG-012-agent-tool-path-sandbox-escape.md)**) and deeper abuse controls stay part of security posture. Advanced storage topics (WAL tuning, Litestream, snapshot playbooks) remain **out of scope** until needed.

**Intent:** Sequence milestones from **today** (single-tenant desktop and dev server, `[BRAIN_HOME](../OPP-012-brain-home-data-layout.md)` + [layout JSON](../../../shared/brain-layout.json)) to a **Linux container** deployment on **DigitalOcean** that is **usable by test users** in a **relatively secure** way: **Google** as the identity and mail/calendar connector, **per-tenant durable disk** (survive image updates and reboots), and a **vault password** layered on top for unlock semantics and future mobile access—without pretending we ship **macOS-only** integrations (Full Disk Access, iMessage, bundled loopback OAuth) in this slice.

This epic **does not** replace the native app ([archived OPP-007](../archive/OPP-007-native-mac-app.md)); it implements the **cloud** branch of [deployment-models.md](../../architecture/deployment-models.md).

**Related:** [OPP-042: Brain network & inter-brain trust](./OPP-042-brain-network-interbrain-trust-epic.md) — **Braintunnel handle–first** identity and inter-brain coordination assume **stable, reachable endpoints**; production HTTPS and `PUBLIC_WEB_ORIGIN` (this epic) are prerequisites for trustworthy cross-brain UX.

---

## Why this is not a contradiction with archived OPP-013

[Archived OPP-013](../archive/OPP-013-docker-deployment.md) marked in-repo Docker as **“will not do”** for the **primary** product direction when the goal was **macOS parity** (FDA, local `chat.db`, etc.). A **hosted Linux** deployment explicitly **drops** those features and ships a **cloud-safe subset**—same core stack (Hono, Svelte, pi-agent-core, ripmail subprocess), different **storage and auth** layers, as already anticipated in [deployment-models.md](../../architecture/deployment-models.md) and [PRODUCTIZATION.md](../../PRODUCTIZATION.md).

Historical Docker artifacts were removed from the monorepo; the last snapshot is described in the archive file (git SHA `856eec33`). New packaging should derive paths from `**shared/brain-layout.json`**, not hardcoded `/wiki`-only roots.

---

## North-star outcome (test users)

1. User opens a **public HTTPS** URL for the staging/prod environment.
2. **Sign in with Google** establishes product identity and drives Gmail/Calendar consent in line with [OPP-019](./OPP-019-gmail-first-class-brain.md) and [google-oauth.md](../../google-oauth.md) (hosted redirect URIs, not loopback-only).
3. User chooses a **vault password** (and unlock flow) so sensitive operations remain gated similarly to today’s model ([OPP-035](../OPP-035-local-vault-password-and-session-auth.md)), adapted for hosted cookies/TLS/CSRF.
4. The system provisions or attaches a **tenant-scoped home directory** containing wiki, chats, `var/`, `cache/`, and `**ripmail/`** (`RIPMAIL_HOME` layout unchanged per tenant).
5. **Background sync** can run 24/7; **container replacements** do not wipe user data because `**BRAIN_HOME` lives on attached block storage**, not the container’s ephemeral layer.

**Staging (April 2026) — what is deployed today**


| Item             | Detail                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public URL**   | `**https://staging.braintunnel.ai`** (`PUBLIC_WEB_ORIGIN` + Google OAuth redirect URIs registered for this origin)                                                                                    |
| **Compute**      | DigitalOcean **staging droplet** (amd64), Docker Engine + Compose plugin                                                                                                                              |
| **Image**        | `registry.digitalocean.com/braintunnel/brain-app` (`npm run docker:deploy`, default `**linux/amd64`**)                                                                                               |
| **Compose**      | `[docker-compose.do.yml](../../../docker-compose.do.yml)` — `platform: linux/amd64`, `PORT=4000` in-container                                                                                            |
| **Edge / TLS**   | TLS terminates **in front of** the Brain container (reverse proxy, LB, or tunnel); browser sees **HTTPS**; container still **HTTP :4000** internally                                                  |
| **Durable data** | Docker **named volume** `brain_data` mounted at `**/brain-data`**; `BRAIN_DATA_ROOT=/brain-data` so the app’s home tree lives **outside** the image layer — **updates and restarts do not wipe data** |


Runbook pointers: [digitalocean.md](../../digitalocean.md).

**Security bar:** Treat **cross-tenant contamination** as a shipping risk class; follow the checklist in [packaging-and-distribution.md](../../packaging-and-distribution.md) and the guardrails in [multi-tenant-cloud-architecture.md](../../architecture/multi-tenant-cloud-architecture.md). **Traffic confidentiality** for staging assumes **HTTPS** is correctly terminated at the edge for the public hostname.

---

## Milestones (recommended order)

Each phase has **exit criteria** so work can pause between them without half-finished production exposure.

**Done so far:** Phase 0–2; **Phase 5** (DigitalOcean staging + **HTTPS** + public origin + durable volume + registry deploy); **Phase 6** (initial tester hardening / smoke path for friendly cohort). **Remaining epic milestones:** Phase 3–4 when scaling or tightening the multiplexed tenant story — see below.

### Phase 0 — Written scope and parity matrix (no new infra)

**Status: complete** — deliverable: [cloud-hosted-v1-scope.md](../../architecture/cloud-hosted-v1-scope.md).

**Goals**

- **Cloud parity matrix:** For every major route in [runtime-and-routes.md](../../architecture/runtime-and-routes.md), mark *supported*, *disabled*, or *stub* in cloud (e.g. `/api/imessage`, bundled-only TLS allowlists, `allowLanDirectAccess`).
- **Storage decision (wiki):** [PRODUCTIZATION.md §2](../../PRODUCTIZATION.md) still applies—git-backed wiki vs object storage vs “files on volume only” affects onboarding friction. Pick a **default for v1 hosted** (often: **files on tenant volume**, no git, until a later migration story).
- **OAuth:** Plan **authorized redirect URIs** for real origins (`https://<host>/api/oauth/google/callback`); note [OPP-022](./OPP-022-google-oauth-app-verification.md) for anything beyond testing-mode cohorts.

**Exit criteria:** A short internal doc listing *what we ship in cloud v1* and *what we explicitly do not* — satisfied by [cloud-hosted-v1-scope.md](../../architecture/cloud-hosted-v1-scope.md) (includes the `**googleOAuthRedirectUri` loopback gap** to fix in Phase 1+).

---

### Phase 1 — Single-tenant container on a developer machine

**Status: complete** — root `[Dockerfile](../../../Dockerfile)` + `[docker-compose.yml](../../../docker-compose.yml)`; `env_file: .env`; compose sets `BRAIN_HOME=/brain`, `RIPMAIL_BIN=/usr/local/bin/ripmail`, and `**PORT=4000`** (in-container; host maps `${BRAIN_DOCKER_PORT:-4000}:4000`). `**ripmail` is not compiled inside the app image:** `[npm run docker:ripmail:build](../../../package.json)` (see `[scripts/docker-prebuild-ripmail.mjs](../../../scripts/docker-prebuild-ripmail.mjs)`) produces `.docker/linux-ripmail/ripmail` via **host `cargo`** on matching Linux or a `**rust:bookworm` one-off** with persistent Cargo volumes on macOS; then the Dockerfile `COPY`s that binary. Runtime gates **macOS-only** paths (e.g. local Messages, Apple Mail onboarding) so Linux/Docker matches the cloud parity matrix.

**Goals**

- **Dockerfile** (multi-stage): build **ripmail** from this monorepo, production **Node** build (`npm ci`, `npm run build`), install binary on `PATH`, default `**RIPMAIL_HOME`** under the mounted `**BRAIN_HOME`** per layout JSON.
- **Compose (optional):** one service, `**BRAIN_HOME`** on a **named volume** (or bind mount `./data:/brain` if you prefer).
- **Runbook:** env vars per [configuration.md](../../architecture/configuration.md); document differences from `npm run dev` (no Vite middleware—production static).

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
- **Operational notes:** SQLite WAL, single-writer expectations, backup/snapshot story (provider snapshots + optional Litestream/S3-style off-site per [multi-tenant-cloud-architecture.md](../../architecture/multi-tenant-cloud-architecture.md)).
- **Local simulation:** Use a dedicated host path or a single **block volume** on a VM to mimic production before multi-tenant routing exists.

**Exit criteria:** Documented repro: **delete and recreate** the container (same mount) → user data still present; ripmail and wiki paths consistent. **Staging:** `docker compose -f docker-compose.do.yml pull && … up -d` against the same host leaves `**brain_data`** intact.

---

### Phase 3 — Multi-tenant **data plane** in one Node process (“uber-container”)

**Goals**

- **One tenant, one home:** e.g. `<DATA_ROOT>/<tenant_id>/` is a full `BRAIN_HOME` tree (wiki, ripmail, chats, `var/`, `cache/`).
- **Isolation guardrails** from [multi-tenant-cloud-architecture.md](../../architecture/multi-tenant-cloud-architecture.md): explicit per-request context (e.g. `AsyncLocalStorage`), **no ambient** `BRAIN_HOME` for request handlers, **path jailing** for agent/wiki tools, **ripmail** invoked with explicit home arguments (or per-tenant env injection scoped to the subprocess—prefer explicit flags if/when ripmail supports them broadly).
- **Tests:** Concurrent requests for two tenants; attempts to escape with `..` paths; grep/search must not leak across homes ([PRODUCTIZATION.md](../../PRODUCTIZATION.md) themes).

**Exit criteria:** Automated tests prove **no cross-tenant file or SQLite access** under the multiplexed server; load smoke optional.

**Note:** [multi-tenant-cloud-architecture.md](../../architecture/multi-tenant-cloud-architecture.md) phases 2–3 (routing layer, per-tenant pods) are **scale follow-ons**, not required for the first DO deployment if a single VM + single process is enough for test users.

---

### Phase 4 — Identity: Google + username + vault

**Goals**

- **Primary login:** Google OAuth as product authentication (aligned with [PRODUCTIZATION.md §3](../../PRODUCTIZATION.md)).
- **Stable internal `tenant_id`:** Map Google subject (and/or verified email) to an internal id; persist mapping in a **small product-owned store** (see [PRODUCTIZATION.md](../../PRODUCTIZATION.md) on SQLite per tenant vs global registry—likely a **global** metadata DB or config store **plus** per-tenant `BRAIN_HOME` on disk).
- **Username / handle:** Default **local-part** of the primary Google email (e.g. `lewiscirne@gmail.com` → `lewiscirne`). **Collision policy** must be defined (suffix numeric, random tail, or email-scoped display). Product copy should distinguish **login identifier** vs **Google email**.
- **Vault password:** After OAuth, user sets (or confirms) a **vault password** so unlock semantics remain meaningful for **phone / additional devices** and for encrypting or sealing sensitive material if we extend beyond today’s verifier model. Exact cryptography (verifier-only vs at-rest encryption) is a **product decision**—[multi-tenant-cloud-architecture.md](../../architecture/multi-tenant-cloud-architecture.md) currently biases toward **isolation + encryption-at-rest on the volume** while deferring app-level encryption tradeoffs.
- **Sessions:** Move from “single-user cookie” to **tenant-scoped** server sessions (or signed tokens) suitable for HTTPS deployment; revisit bundled-only cookie rules from [runtime-and-routes.md](../../architecture/runtime-and-routes.md).

**Exit criteria:** New Google account can sign in, receive a **unique** tenant home, set vault, unlock, and use APIs—second user cannot read the first user’s wiki or mail index.

---

### Phase 5 — DigitalOcean: staging environment

**Status: complete (April 2026)**

**Delivered**

- **Public staging:** `**https://staging.braintunnel.ai`** with **TLS** at the edge and `**PUBLIC_WEB_ORIGIN`** + Google **Authorized redirect URIs** aligned to that origin.
- **Droplet + Docker + Compose:** Staging host running `[docker-compose.do.yml](../../../docker-compose.do.yml)`; image from **Container Registry** (`npm run docker:deploy`, `**linux/amd64`**).
- **In-container listen:** App on **port 4000** (HTTP inside the Docker network); edge proxy presents **HTTPS** to browsers.
- **Non-destructive updates:** Durable data in Docker named volume `**brain_data`** (`BRAIN_DATA_ROOT=/brain-data`); pulling a new image and recreating the container **does not** wipe user data.
- **CLI / registry:** `doctl` contexts, `**./scripts/doctl-brain.sh`**, publish script — [digitalocean.md](../../digitalocean.md).
- **Product path:** Gmail sign-in, onboarding (initial sync can be slow), **automatic wiki build**, chat and wiki usable on staging.

**Optional follow-ons (not gating Phase 5)**

- Dedicated **Block Storage** at the Docker data root, automated **volume snapshots**, documented **rollback** for image tags.
- **Longer-term compute options** (unchanged from planning):
  - **App Platform:** Often a poor fit for large on-disk ripmail/wiki without storage redesign ([DO: Store data in App Platform](https://docs.digitalocean.com/products/app-platform/how-to/store-data)).
  - **Droplet + Block Storage Volume (recommended for production v1):** **ext4** volume at `DATA_ROOT`, snapshots — aligns with [multi-tenant-cloud-architecture.md](../../architecture/multi-tenant-cloud-architecture.md).
  - **DOKS:** Later if we outgrow single-VM Compose.

**Exit criteria:** Staging proves **pull + recreate** without data loss (**met**). **HTTPS** URL for testers (**met** — `staging.braintunnel.ai`). Deploy/rollback documented in [digitalocean.md](../../digitalocean.md); backups/snapshots **recommended** before production traffic.

---

### Reference: HTTPS / edge checklist (new hosts)

Use when bringing up **another** public origin (e.g. production):

1. **Terminate TLS** in front of the container — e.g. **Caddy** or **nginx** on the droplet (Let’s Encrypt), or a **DigitalOcean Load Balancer** / **Cloudflare** forwarding to the app port.
2. Set `**PUBLIC_WEB_ORIGIN`** in `.env` to the **canonical `https://…`** origin users open (required for OAuth and cookie semantics; see [google-oauth.md](../../google-oauth.md), [cloud-hosted-v1-scope.md](../../architecture/cloud-hosted-v1-scope.md)).
3. In **Google Cloud Console**, add **Authorized redirect URIs** for that origin (e.g. `https://<host>/api/oauth/google/callback`).
4. **Restrict exposure:** Prefer **not** exposing raw **:4000** on the public Internet once **443** is live; firewall to **22 + 80 + 443** (or LB health paths only) as appropriate.
5. Re-run **smoke tests** (sign-in, Gmail connect, chat, wiki) over **HTTPS** before widening the tester list.

---

### Phase 6 — Test-user hardening

**Status: complete (April 2026)** for the **initial friendly cohort** on staging.

**Goals (as originally scoped)**

- Rate limiting, abuse controls, structured logging with **tenant id** and **redaction** for mail/wiki snippets.
- Threat modeling pass on **agent tools** (path arguments, file reads, search) under multi-tenant load.
- Optional: IP allowlists, invite-only signup, or OAuth allowlisting for first cohort.

**Exit criteria:** Staging cohort can use `**https://staging.braintunnel.ai`** end-to-end without blocking gaps for the intended test surface. **Known follow-ons** include app-layer path policy vs **kernel-level** isolation ([tenant-filesystem-isolation.md](../../architecture/tenant-filesystem-isolation.md); historical **[BUG-012](../../bugs/archive/BUG-012-agent-tool-path-sandbox-escape.md)** narrative), deeper rate limits and observability as traffic grows, and [OPP-022](./OPP-022-google-oauth-app-verification.md) when leaving Google test-user caps.

---

## Dependencies and related opportunities


| Doc / OPP                                                                                | Relevance                                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [PRODUCTIZATION.md](../../PRODUCTIZATION.md)                                                | Multi-user blockers: wiki storage, auth, ripmail UX, SQLite strategy |
| [multi-tenant-cloud-architecture.md](../../architecture/multi-tenant-cloud-architecture.md) | One home per tenant, NAS, isolation phases                           |
| [deployment-models.md](../../architecture/deployment-models.md)                             | Desktop vs cloud split                                               |
| [OPP-019](./OPP-019-gmail-first-class-brain.md)                                            | Gmail OAuth in app, token layout under `RIPMAIL_HOME`                |
| [OPP-022](./OPP-022-google-oauth-app-verification.md)                                      | Verification for non-test Google projects                            |
| [OPP-035](../OPP-035-local-vault-password-and-session-auth.md)                              | Vault + session baseline to generalize                               |
| [packaging-and-distribution.md](../../packaging-and-distribution.md)                        | Cloud security checklist                                             |


---

## Open questions (explicit product/engineering choices)

1. **Wiki:** **v1 hosted default decided** — plain tree on volume, no git; see [cloud-hosted-v1-scope.md](../../architecture/cloud-hosted-v1-scope.md). Longer term: [PRODUCTIZATION.md §2](../../PRODUCTIZATION.md) (object storage, hosted git, etc.).
2. **Vault password:** Unlock only vs key derivation for additional encrypted blobs (attachments, exports).
3. **Ripmail driving:** Subprocess remains fine for early cloud; long-term programmatic sync API per PRODUCTIZATION §4.
4. **DO App Platform:** Only revisit if we redesign storage around Spaces/DB **or** if DO adds block volumes for App Platform; re-check docs at implementation time.

---

## Suggested sequencing for a small team

**Staging path:** Phases **0–2**, **5**, and **6** are **done**: `**https://staging.braintunnel.ai`**, durable `**brain_data`** volume, Gmail onboarding, automatic wiki build. Use the [HTTPS / edge checklist](#reference-https--edge-checklist-new-hosts) for **additional** public origins (e.g. production). **Phase 3–4** remains the epic’s **next engineering chunk** when tightening **multi-tenant density, isolation proofs, and identity** at scale — not a blocker for the current staging milestone closure.