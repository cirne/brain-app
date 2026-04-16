# OPP-042: Google OAuth for CLI — IMAP/SMTP When App Passwords Are Not Available

**Status:** **Shipped (2026-04).** Rust CLI supports **Desktop PKCE** + loopback redirect, optional **hosted OAuth relay**, per-mailbox **refresh token** storage (`~/.ripmail/<mailbox_id>/google-oauth.json`), **IMAP and SMTP XOAUTH2** when `imapAuth` is **`googleOAuth`**, **`ripmail setup --google-oauth`**, **`ripmail wizard --gmail`**, and merged env loading so **`{project}/.env`** (repository root next to `Cargo.toml`) overlays **`~/.ripmail/.env`** for the same keys ([`read_ripmail_env_file`](../../src/config.rs)).

**Canonical user docs:** [AGENTS.md](../../AGENTS.md), [skills/ripmail/SKILL.md](../../skills/ripmail/SKILL.md). **Architecture:** [ADR-007](../ARCHITECTURE.md#adr-007-security-baseline) / [ADR-011](../ARCHITECTURE.md#adr-011-email-provider--imap-first-gmail-as-priority-target) (IMAP auth), [ADR-015](../ARCHITECTURE.md#adr-015-web-ui-auth--google-oauth) (historical web UI sketch — not the CLI flow).

**Follow-ups (not required to call this opp “open”):** optional **OS keychain** for refresh tokens; **headless / SSH** (device flow) if demand warrants; ensure **release CI** always embeds or supplies non-empty **public OAuth client** defaults for prebuilt binaries so typical users never see “missing client” when the Cloud project is in **Production**. Google **Testing** mode on the consent screen still limits who can complete OAuth — document for support, not a ripmail bug.

---

## Google Cloud Console (maintainers)

- **Gmail API** enabled for the project.
- **OAuth consent screen:** scope `https://mail.google.com/` (restricted; broader rollout may require Google verification).
- **OAuth 2.0 Client:** type **Desktop** (installed app); PKCE + loopback redirect.
- **Client credentials:** stored outside git (e.g. 1Password). **Do not** commit `client_id` / `client_secret` or refresh tokens.

Reference project id (non-secret): `**ripmail-492422**`.

---

## Implementation reference (Rust)

- **Client resolution:** `RIPMAIL_OAUTH_EMBEDDED_CLIENT_*` (release CI), process env **`RIPMAIL_GOOGLE_OAUTH_*`**, merged **dotenv** maps, then optional non-empty **`DEFAULT_PUBLIC_*`** ([`src/oauth/client.rs`](../../src/oauth/client.rs)).
- **Local dev dotenv:** [`read_ripmail_env_file`](../../src/config.rs) loads **`RIPMAIL_HOME/.env`**, then overlays **`{CARGO_MANIFEST_DIR}/.env`** (same whitelist as home; **project wins** on duplicate keys). Used by **`load_config`**, **`resolve_openai_api_key`**, and **setup/wizard** OAuth paths.
- **Diagnostics:** On missing OAuth client, stderr lists **build embed**, **process env**, **project `.env` path**, **`~/.ripmail/.env`**, and **bundled defaults** separately.
- **Flows:** Browser authorization, token exchange/refresh, **`google-oauth.json`** per mailbox, **IMAP** and **SMTP** XOAUTH2 — see [`src/oauth/`](../../src/oauth/).

### Environment variables (wired in Rust)

Values mirror the Google **Desktop** client JSON (`installed.*`) where applicable. Resolution order for the OAuth **client** is: **embed** → **process** → **merged dotenv** (`~/.ripmail/.env` then **`{project}/.env`**) → **`DEFAULT_PUBLIC_*`** (bundled public client when non-empty).

| Variable                           | Maps from JSON / use                                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RIPMAIL_GOOGLE_OAUTH_CLIENT_ID`     | `installed.client_id`                                                                                                                                                                                    |
| `RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET` | `installed.client_secret`                                                                                                                                                                                |
| `RIPMAIL_GOOGLE_OAUTH_PROJECT_ID`    | `project_id` (optional; debugging / support)                                                                                                                                                             |
| `RIPMAIL_GOOGLE_OAUTH_AUTH_URI`      | `installed.auth_uri` (authorization endpoint)                                                                                                                                                            |
| `RIPMAIL_GOOGLE_OAUTH_TOKEN_URI`     | `installed.token_uri` (token + refresh endpoint)                                                                                                                                                         |
| `RIPMAIL_GOOGLE_OAUTH_REDIRECT_URI`  | **Loopback** redirect for **`ripmail wizard --gmail`** and **`ripmail setup --google-oauth`**. Default: **`http://127.0.0.1:8765/oauth/callback`**. Must be a full URL with **port and path** (ripmail’s listener does not accept bare `http://localhost`). |

**Where to set (local dev):** **Repository root** `**.env`** (gitignored), merged over **`~/.ripmail/.env`** for the same keys. **Production / CI:** **`RIPMAIL_OAUTH_EMBEDDED_CLIENT_ID`** / **`_SECRET`** at **`cargo build --release`** (or populated **`DEFAULT_PUBLIC_*`** in maintained release branches).

**Official releases vs dev:** Prebuilt **ripmail** can embed a Desktop `client_id` + `client_secret` so users only complete browser consent. **`client_secret`** is used only on **HTTPS calls to Google’s token endpoint** (code exchange + refresh), not for IMAP wire format.

### Troubleshooting: `Error 400: redirect_uri_mismatch`

Google requires the **`redirect_uri`** query parameter on the authorize URL to **exactly match** one entry under **Google Cloud Console → APIs & Services → Credentials → (your OAuth 2.0 Client ID) → Authorized redirect URIs**.

| Flow | Redirect URI sent to Google | Add this URI in Cloud Console |
|------|----------------------------|------------------------------|
| **`ripmail wizard --gmail`** (default) | `RIPMAIL_GOOGLE_OAUTH_REDIRECT_URI` or **`http://127.0.0.1:8765/oauth/callback`** | Same string the CLI prints before opening the browser. |
| **`ripmail setup --google-oauth`** | same as above | same |
| **Hosted relay** (optional API `write_google_oauth_setup_hosted` only) | `{RIPMAIL_OAUTH_RELAY_BASE}/oauth/callback` | e.g. **`https://oauth.ripmail.dev/oauth/callback`** if using the public relay base. |

**BYO Desktop client:** Register the **exact** loopback URI (default **`http://127.0.0.1:8765/oauth/callback`**). Do not use bare **`http://localhost`** without port — ripmail’s loopback handler requires **`host:port/path`**. The CLI prints the **exact** redirect URI before opening the browser.

---

## Problem (historical)

- Many Google accounts **cannot use app passwords** (Workspace policy, Advanced Protection, etc.). For those accounts, **password-based IMAP is not an option**; access must use **OAuth** (refresh + access tokens), not the Google account password.

## Goals (met)

1. Support Gmail where **app passwords are unavailable** without weakening account security.
2. **CLI/agent-first:** one-time browser consent, then refresh/sync/send using stored tokens.
3. **Desktop** OAuth client, **loopback** redirect (and optional relay) — no requirement for users to run a public web server.
4. **Send + sync** share the same token lifecycle for OAuth mailboxes (IMAP + SMTP XOAUTH2).

## Non-goals (unchanged)

- Replacing **non-Gmail** IMAP auth in the same release (unless a shared abstraction falls out naturally).
- **Gmail REST API** as the primary sync protocol in v1 — **IMAP + XOAUTH2** is the shipped path.
- OAuth for **OpenAI** (orthogonal).

## Design forks (record)

### A — OAuth client registration

- **Bundled credentials** for official releases (embed or ship client id/secret) so normal onboarding is browser-only.
- **BYO Desktop client** for power users — advanced only.

### B — IMAP: XOAUTH2 vs Gmail API

**Shipped:** **IMAP + SASL XOAUTH2** ([`src/oauth/xoauth2.rs`](../../src/oauth/xoauth2.rs), sync transport).

### C — SMTP

**OAuth2 SMTP** (`AUTH XOAUTH2`) shares the same access token as IMAP ([`src/send/smtp_send.rs`](../../src/send/smtp_send.rs)).

### D — Token storage and UX

- Refresh tokens **per mailbox** under `RIPMAIL_HOME`; optional future OS keychain hardening.
- **`ripmail setup`** / **`ripmail wizard`:** OAuth branch opens browser, captures loopback redirect; **headless / SSH** remains a follow-up (device flow).

## Success criteria (acceptance) — met

- Users **without** app passwords can **setup**, **refresh**, **search/read**, and **send** using OAuth tokens only.
- **AGENTS.md** and **skills/ripmail/SKILL.md** describe OAuth vs app password consistently.
- Tests cover XOAUTH2 encoding, OAuth client resolution, CLI regressions for OAuth mailboxes (`tests/oauth_mailbox_draft_send_cli.rs`); live Google and full refresh-token HTTP are exercised manually where automation is impractical.

## Test coverage strategy (for reference)

- **Unit:** XOAUTH2 string shape; PKCE; client/relay resolution; SMTP plain-body normalization (`normalize_smtp_plain_body`).
- **Integration:** subprocess CLI tests for OAuth mailbox draft/send gates; fake IMAP tests where applicable.
- **Regression:** app-password mailboxes unchanged.

## References

- Google: **OAuth 2.0 for Mobile & Desktop Apps** (loopback redirect URI patterns).
- Internal: [OPP-011 archived](archive/OPP-011-send-email.md) (send/drafts), [ARCHITECTURE.md](../ARCHITECTURE.md).
