# Productization

**Product name:** **Braintunnel** (this repository: `brain-app`). Known limitations and friction points for generalizing Braintunnel from a personal tool into a multi-user product. Each section describes the current assumption, what breaks at scale, and the tradeoff space.

See [OPPORTUNITIES.md](./OPPORTUNITIES.md) for incremental improvements; this doc is for the harder structural blockers.

---

## Vision

A user signs up with their Google account, approves email and calendar access, and within 5 minutes has a personalized assistant that knows everything findable in their email, calendar, and browsing history. No config, no CLI, no git. The wiki builds itself from the user's life data — people, places, projects, interests — and becomes richer over time as they interact with it.

---

## Limitations

### 1. Calendar: hardcoded ICS assumptions

**Current state:** Calendar integration expects two public ICS feed URLs (work and travel) configured via env vars. The code assumes this specific two-calendar split.

**What breaks:** Different users organize calendars differently — some have one, some have ten. The work/travel distinction is personal. Public ICS URLs require users to dig through Google Calendar settings to find them. Many users won't bother or won't know how.

**Path forward:**
- Google Calendar OAuth is the right answer here — same OAuth flow as email, same consent screen, no URL hunting
- Drop the hardcoded two-calendar assumption; let users pick which calendars to expose to the assistant
- Short term: make the calendar count and naming configurable rather than hardcoded

---

### 2. Wiki backing store: git friction

**Current state:** The wiki is a git repo (brain on GitHub). The server commits and pushes wiki changes after file edits (debounced), not via an agent tool. Requires: a GitHub account, an authenticated git remote, SSH keys or a token configured in the container.

**What breaks:** Most users will not have a GitHub account, will not know how to create a personal repo, and will not understand SSH key setup. Even technical users face friction with auth tokens in a hosted environment. Provisioning a per-user git repo server-side is a significant security and ops surface.

**Tradeoff space:**
- **Hosted git (Gitea, etc.):** Preserves full version history and diff view. Per-user repos are isolatable. But: we operate an auth-bearing service, need to think about storage, backups, abuse. Significant ops overhead.
- **S3-compatible object storage:** Simpler to provision per user (one bucket or prefix). No ops for version history. Loses: diffs, rollback, the "commit and push" mental model. Works fine if we build our own change history on top.
- **Local-only (no sync):** Simplest. Wiki lives on the server volume. No git. Loses: edit from other tools, backup via git, the brain repo convention.

**Likely answer:** S3 or similar for the storage layer, with our own lightweight versioning (keep last N versions of each file). Lose git but gain zero-friction onboarding.

**See also:** [IDEA Wiki sharing with collaborators](ideas/archive/IDEA-wiki-sharing-collaborators.md) (§ Git per user) explores **internal** per-user repos for rollback/diff/collaboration history without exposing git to novices—a deliberate revisit of this tradeoff, not a contradiction of “likely answer” until product chooses.

**Related (app state):** Durable **app** data — chat history, settings, and other metadata the product owns — is separate from the wiki backing store above. A plausible pattern is **local SQLite per tenant** with **periodic backup of the database file to tenant-scoped object storage**, so state survives deploys and restarts alongside other per-tenant blobs. Schema and scope are TBD. See [ARCHITECTURE.md](./ARCHITECTURE.md#future-durable-app-state-sqlite).

**Architectural foundation:** The **directory-per-tenant** model (wiki files, ripmail SQLite, chat history, preferences all under `$BRAIN_DATA_ROOT/<usr_…>/`) is unconventional for SaaS but foundational to our desktop/cloud single-codebase strategy. For full rationale and defense, see [architecture/per-tenant-storage-defense.md](architecture/per-tenant-storage-defense.md).

---

### 3. Authentication

**Current state (single-user local):** Vault password set at onboarding; verifier under `$BRAIN_HOME/var/`; **HttpOnly** session cookie gates `/api/*` after unlock ([`runtime-and-routes.md`](architecture/runtime-and-routes.md)).

**What's still not product-scale:** Single tenant only (no signup, provider identity as product login, per-user isolation on a hosted service).

**Local-first tightening:** Same-LAN access is **opt-in** (`allowLanDirectAccess` in onboarding preferences) with **TLS** to the embedded server; default remains loopback + Tailscale CGNAT only. See [runtime-and-routes.md](architecture/runtime-and-routes.md). [OPP-035](opportunities/OPP-035-local-vault-password-and-session-auth.md).

**What breaks:** Everything at multi-tenant SaaS scale. There's no signup, no per-user identity as first-class product auth, no tenant-isolated deployments.

**Path forward (multi-tenant product):**
- Google OAuth is the natural fit given the vision (email + calendar are already Google)
- One OAuth consent screen grants email, calendar, and identity — the user is authenticated and their data sources are connected in one step
- Product-scale session and identity (JWT or hosted sessions with tenant id) beyond the local vault cookie
- Per-user data isolation (wiki content, email index, calendar cache) needs to be scoped to an authenticated identity

---

### 4. Email: ripmail setup and auth

**Current state:** ripmail is a CLI binary that requires manual IMAP configuration (server, credentials, folder mappings) and a separate OAuth setup flow for Gmail. It runs as a subprocess; brain-app has no visibility into whether it's configured or what state it's in.

**What breaks:** A new user needs to: install ripmail, run `ripmail wizard`, configure IMAP or OAuth, run an initial sync, and ensure the binary is accessible to the brain-app server. This is a multi-step CLI process that non-technical users will not complete.

**Path forward:**
- Google OAuth (see Auth above) can grant Gmail access via the same flow — no IMAP credentials, no wizard
- brain-app would need to either embed ripmail's sync logic directly or drive it programmatically rather than via CLI subprocess
- The ripmail binary as a subprocess is the right architecture for a personal tool; it's the wrong interface for a managed onboarding flow
- Long term: the email indexing layer becomes a first-class service that brain-app drives, not a pre-configured external binary

---

### 5. Wiki directory icons: personal dirs must use LLM lookup

**Current state:** `dirIcons.ts` and the `/api/wiki/dir-icon` endpoint have hardcoded defaults for common directory names (`people`, `companies`, `ideas`, `areas`, `health`, `projects`, etc.). Unknown dirs fall through to an LLM-backed lookup that picks from a 22-icon Lucide set and caches the result under `$BRAIN_HOME/cache/` (see `shared/brain-layout.json`).

**What is personal:** Dirs like `bicf`, `grantees`, `properties`, `trips` are specific to this wiki and are intentionally excluded from the hardcoded list — they get their icons via LLM. Any new personal/domain-specific dir a user creates will get an LLM-assigned icon automatically.

**What works at scale:** The LLM lookup + cache pattern generalizes cleanly. Every new user's idiosyncratic dirs get icons without any config. The cache means the LLM is only called once per novel directory name across the lifetime of the instance.

**Remaining gap:** The cache is per-instance (a flat JSON file on disk). In a multi-user deployment, it would need to be either shared (fine, icon names are not sensitive) or per-user (adds storage overhead but avoids one user's `bicf` cache entry poisoning another user's).

---

## What a "5-minute setup" flow looks like

1. User visits the app, clicks "Sign in with Google"
2. Google OAuth consent: approve Gmail read + Google Calendar read
3. App provisions: a wiki namespace (S3 prefix or hosted git), an email sync job (using granted OAuth token), a calendar sync job
4. Background: email sync begins crawling; agent scaffolds wiki seed pages from calendar contacts, frequent correspondents, etc.
5. User lands in Chat and can immediately ask questions — agent answers from whatever has been indexed so far, improving as sync progresses

Everything above auth step 2 is currently either manual, personal-machine-dependent, or hardcoded.

---

## Alternative path: Local-first native app

The limitations above assume a cloud-hosted, multi-user SaaS model. An alternative architecture sidesteps many of these concerns:

**Package brain-app as a native macOS application** that runs the server locally instead of in a container. See [OPP-007: Native Mac App (archived)](opportunities/archive/OPP-007-native-mac-app.md).

| Cloud model problem | How native app solves it |
|---|---|
| iMessage requires sync to cloud | Runs locally — Full Disk Access, no sync |
| Contacts/Notes require APIs or sync | Read local SQLite databases directly |
| Git wiki friction | Local filesystem, no provisioning |
| Per-user data isolation | Single-user by design |
| Container hosting cost | Runs on user's Mac |

**Tradeoffs:**
- Requires Mac running for access (mitigated by Tailscale for remote)
- Single-user only (feature for personal tool, blocker for SaaS)
- No "always on" unless Mac is always on

**When to choose native app:**
- Building a power-user personal tool
- Privacy is paramount (data never leaves machine)
- Deep local data integration matters (iMessage, Notes, files)

**When to choose cloud:**
- Multi-user SaaS product
- Mobile-first experience
- "Always on" matters more than local data access

Both paths are valid. The choice depends on product vision.
