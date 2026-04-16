# Implementation plan: OPP-042 — Google OAuth for CLI (IMAP/SMTP)

**Status:** **Implemented** (2026-04). This plan is historical; shipped behavior and follow-ups live in [OPP-042](../opportunities/OPP-042-google-oauth-cli-auth.md).

**Branch (landed):** `oauth` → `main`  
**Canonical opp:** [OPP-042 — Google OAuth for CLI](../opportunities/OPP-042-google-oauth-cli-auth.md)  
**Goal:** Let Gmail users who **cannot** use app passwords complete setup, sync, search/read, and send using **OAuth** (browser consent + stored refresh token), without a ripmail-operated public web server.

This plan turned the opp’s handoff notes into ordered work, explicit decisions, and a **test strategy** aligned with [AGENTS.md](../../AGENTS.md).

---

## Preconditions (already done per OPP)

- Google Cloud: Gmail API, OAuth consent (Testing + test users), scope `https://mail.google.com/`, **Desktop** client with PKCE + loopback redirect.
- Env var **names** for dev (`RIPMAIL_GOOGLE_OAUTH_*`) are defined in the opp; Rust does not consume them yet.
- Reference (non-secret) project id: `ripmail-492422`.

---

## Architecture decisions (lock these early)

| Topic | Decision |
| --- | --- |
| **Mail transport** | **IMAP + SASL XOAUTH2** for sync (keep existing sync architecture). The in-tree `imap` crate already documents `Client::authenticate("XOAUTH2", …)` (see upstream `examples/gmail_oauth2.rs`). **Gmail REST API** sync is explicitly out of scope for v1 unless IMAP proves infeasible. |
| **SMTP** | **OAuth2 SMTP** via the same access token as IMAP. `lettre` already exposes `Mechanism::Xoauth2` with `Credentials` where `secret` is the **Bearer access token** (same string shape as IMAP XOAUTH2). |
| **OAuth flow** | **Desktop app + PKCE** + ephemeral **loopback** redirect listener; `access_type=offline` (and `prompt=consent` when you need a refresh token re-issue). Match **exact** redirect URI registered in Cloud Console. |
| **Client credentials** | **Release builds:** embed or bundle ripmail’s Desktop `client_id` + `client_secret` (secret only used for HTTPS calls to Google’s token endpoint). **Dev/CI:** `RIPMAIL_GOOGLE_OAUTH_*` env overrides. Optional **BYO** client in config — advanced only, not default onboarding. |
| **Token storage** | Per-mailbox under `RIPMAIL_HOME`: refresh token + metadata (e.g. expiry hints); **restrict file permissions** (0600 or stricter). In-memory cache of access token with refresh on 401/expiry. Keychain integration = later hardening, not v1 blocker. |
| **Headless / SSH** | Defer **device flow** unless Google’s current docs support it for Desktop clients + chosen scopes; document “run OAuth on a machine with a browser” as the v1 story. |

---

## Phased implementation

### Phase 1 — OAuth client config + HTTP token client

1. **Config surface**
   - Extend loading so OAuth client settings resolve in order: embedded release defaults → env (`RIPMAIL_GOOGLE_OAUTH_*`) → optional advanced JSON fields (BYO).
   - Extend `parse_dotenv_secrets` (or a dedicated helper) so `~/.ripmail/.env` and repo `.env` can supply OAuth vars for dev without teaching every codepath about new keys ad hoc.

2. **PKCE + authorization URL**
   - Generate `code_verifier` / `code_challenge` (S256), state/nonce for CSRF, and build the Google authorize URL (scope, redirect_uri, client_id, `access_type=offline` as needed).

3. **Loopback redirect server**
   - Bind an ephemeral localhost port (or fixed port if Console lists a single URI); open browser via `open` / `xdg-open` / `cmd start` as appropriate; read `code` (or error) from query; respond with a minimal HTML success/failure page.

4. **Token exchange + refresh**
   - POST to `token_uri` with `code`, `code_verifier`, `client_id`, `client_secret`, `redirect_uri` (grant type `authorization_code`).
   - Refresh: POST with `refresh_token`, `client_id`, `client_secret`, `grant_type=refresh_token`.
   - Add a small **sync HTTP** dependency (e.g. `ureq` or `reqwest` blocking) — none exists in the workspace today; pick one and keep TLS defaults strict.

**Exit criteria:** CLI command or internal API that, given env/embedded client, completes browser login and prints or stores refresh + first access token (even before IMAP wiring).

---

### Phase 2 — Persist tokens per mailbox

1. **Storage format & location**
   - Under `~/.ripmail/<mailbox_id>/` (or next to existing per-mailbox `.env`), e.g. `oauth.json` or a name consistent with the rest of the tree; **0600** permissions; never log contents.

2. **Config / `ResolvedMailbox`**
   - Represent “this mailbox uses OAuth” vs password (e.g. `auth: "oauth" | "password"` or explicit `oauth: { … }` block). Merge with existing `mailboxes[]` in `config.json` per [OPP-016](../opportunities/archive/OPP-016-multi-inbox.md) patterns.

3. **Access token helper**
   - Single module: “ensure valid access token” — refresh if expired or missing; propagate errors with actionable messages (re-run login, consent revoked, etc.).

**Exit criteria:** After one OAuth login, restarts can sync without browser until refresh token is revoked.

---

### Phase 3 — IMAP: XOAUTH2 end-to-end

1. **Replace or branch `connect_imap_session`** in [`src/sync/transport.rs`](../../src/sync/transport.rs)
   - Password path: keep `Client::login(user, password)`.
   - OAuth path: `ClientBuilder` → `authenticate("XOAUTH2", authenticator)` where the authenticator’s `process` returns the standard `user=…\x01auth=Bearer …\x01\x01` string (same as upstream example).

2. **Call sites** — update every path that currently passes `&str` password from config:
   - Sync (`background_spawn`, `triage`/refresh), `setup` validation, `status`, `archive`, etc., so they obtain an **access token** from the helper when the mailbox is OAuth-enabled.

3. **Validation**
   - `ripmail setup` / wizard: after OAuth, run the same IMAP probe as today but via XOAUTH2.

**Exit criteria:** `ripmail refresh` works for a Google account **without** `RIPMAIL_IMAP_PASSWORD` for that mailbox.

---

### Phase 4 — SMTP OAuth2 (send path)

1. [`src/send/smtp_send.rs`](../../src/send/smtp_send.rs) (and `verify_smtp_credentials` if still used)
   - When mailbox is OAuth: build transport with **XOAUTH2** mechanism and `Credentials::new(user, access_token)` per lettre’s XOAUTH2 encoding.
   - Ensure send and IMAP share the **same** token refresh logic.

**Exit criteria:** `ripmail send` works for the same OAuth mailbox without app password.

---

### Phase 5 — `ripmail setup` + wizard UX

1. **Non-interactive `ripmail setup`**
   - Flags or env to choose Google OAuth vs password for Gmail (and fail fast if OAuth selected but client credentials missing).
2. **Wizard**
   - For Gmail: prompt **App password** vs **Sign in with Google** (OAuth); OAuth branch runs loopback flow and writes config + token store.
3. **Copy**
   - Update only the docs the opp lists when implementation lands: [`skills/ripmail/SKILL.md`](../../skills/ripmail/SKILL.md), [`AGENTS.md`](../../AGENTS.md), wizard strings — **when** OAuth vs app password, no contradictory instructions.

---

## Dependencies / crates

| Area | Notes |
| --- | --- |
| IMAP XOAUTH2 | Existing `imap` + `Authenticator` (no new IMAP crate). |
| SMTP XOAUTH2 | Existing `lettre` `Mechanism::Xoauth2`. |
| HTTP | New: `ureq` (sync, small) or `reqwest` — **one** client for token endpoint. |
| Crypto | `sha2` already in tree — usable for PKCE S256 if not using a small helper crate. |

---

## Test coverage strategy (required)

Per [OPP-042 § Test coverage](../opportunities/OPP-042-google-oauth-cli-auth.md) and AGENTS.md planning rules:

| Layer | What to add |
| --- | --- |
| **Unit** | XOAUTH2 string encoding for IMAP/SMTP (matches Google’s format); PKCE `code_challenge` derivation; token JSON parse errors; config merge for `mailboxes[]` + OAuth fields; “refresh token → new access token” response parsing (mocked HTTP). |
| **Integration** | Fake IMAP/SMTP or stubs that accept XOAUTH2; exercise `connect_*` and send transport without hitting Google. |
| **Manual / maintainer** | Document one Google test account + Console test user for full E2E (optional in repo README or RELEASING maintainer notes). |
| **Regression** | All existing **app-password** tests and flows unchanged; password mailboxes never hit OAuth code paths unless selected. |

**Acceptance:** `cargo test` green; new tests cover new modules; manual checklist confirms browser login + refresh + send once.

---

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Restricted scope / Google verification | Ship with Testing users first; document verification path for public OAuth client. |
| Refresh token rotation | Persist new refresh token when Google returns one; single writer to token file. |
| Redirect URI mismatch | Single code path builds redirect URI; integration test asserts it matches config. |
| Lettre/imap TLS edge cases | Reuse existing TLS settings; add one OAuth-specific integration test for SMTP auth. |

---

## Suggested commit milestones (on `oauth`)

1. `feat(oauth): client config + PKCE + token exchange` (HTTP + loopback + storage stub)  
2. `feat(oauth): persist refresh token per mailbox`  
3. `feat(oauth): IMAP XOAUTH2 session`  
4. `feat(oauth): SMTP XOAUTH2 send`  
5. `feat(oauth): setup + wizard + docs`

---

## References

- [OPP-042](../opportunities/OPP-042-google-oauth-cli-auth.md)  
- [ARCHITECTURE.md — IMAP phases](../ARCHITECTURE.md)  
- [OPP-011 — Send email](../opportunities/archive/OPP-011-send-email.md)  
- Google: OAuth 2.0 for Mobile & Desktop Apps; Gmail XOAUTH2 protocol  
