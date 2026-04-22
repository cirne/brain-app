# Archived: OPP-019 (Gmail as a first-class connector)

**Status: Shipped (2026-04) — core goals met.** Hono **Google OAuth** routes (bundled + hosted), **shared on-disk** token layout with **ripmail** under `RIPMAIL_HOME` / `BRAIN_HOME`, and **Gmail onboarding** on **staging** ([OPP-041](../OPP-041-hosted-cloud-epic-docker-digitalocean.md) — closed for current scale). Residual: **Google OAuth app verification** ([OPP-043](../OPP-043-google-oauth-app-verification-milestones.md), [OPP-022](../OPP-022-google-oauth-app-verification.md)); optional product polish.

**Original spec follows.**

---

# OPP-019: Gmail as a first-class connector in Braintunnel (OAuth in app, shared tokens with ripmail)

## Summary

**Priority:** Make **Gmail** the smoothest path for mail (and related Google data) in Braintunnel. Today, Google OAuth and mailbox setup lean on the **ripmail** binary and CLI flows ([ripmail OPP-042](../../ripmail/docs/opportunities/OPP-042-google-oauth-cli-auth.md)). The product should move **OAuth initiation and callbacks** into **brain-app** (Hono + browser) so onboarding feels like a native web/desktop experience, not a separate executable’s concern.

**Split of responsibilities:**

- **Braintunnel (Node / Hono):** OAuth **authorization code + PKCE** (or equivalent), **redirect handling**, token **exchange and refresh**, persistence in a **single place the user trusts** (`BRAIN_HOME`), and **direct Google API** calls where Braintunnel needs them (e.g. Calendar, optional Gmail REST if we add it later).
- **ripmail (Rust binary):** Continues to perform **fast IMAP sync** and local SQLite indexing—unchanged performance story. It **consumes the same OAuth credentials** (refresh token + client) already on disk so it does not run its own separate “Sign in with Google” story for the same mailbox.

This extends the direction in [OPP-009](./OPP-009-oauth-relay-in-app.md) (hosted/relay OAuth inside brain-app) and aligns with [OPP-012](../OPP-012-brain-home-data-layout.md): one home directory, ripmail under `RIPMAIL_HOME` → `$BRAIN_HOME/ripmail` by default.

## Problem

- Gmail integration was designed when **ripmail was standalone**; OAuth loopback, relay, and token files were centered on the CLI.
- Braintunnel needs a **first-class onboarding** path: open Braintunnel → connect Gmail → progress without requiring users to reason about a separate binary for auth.
- Apple Mail and other providers remain important later, but **most primary-mail users are on Gmail**; shipping a polished Gmail path first maximizes impact.
- We still want **one source of truth** for tokens so the **ripmail** subprocess does not duplicate OAuth state or force a second login.

## Goals

1. **Smooth in-app Gmail onboarding** — clear steps, error handling for `redirect_uri_mismatch`, and recovery (reconnect, revoke).
2. **Braintunnel uses Google APIs** where appropriate — at minimum scopes that allow **Calendar** (and any other non-IMAP surfaces we need); **mail** may stay **IMAP + XOAUTH2** via ripmail for sync, matching current ripmail architecture, unless we deliberately add Gmail API reads later.
3. **Credential sharing** — Braintunnel writes OAuth artifacts (refresh token, metadata) into the **same layout** ripmail already expects under the mailbox id under `RIPMAIL_HOME`, **or** a documented adapter writes compatible `google-oauth.json` + `config.json` fields (`imapAuth: "googleOAuth"`). No duplicate logins for the same account.
4. **Security** — tokens only on disk under `BRAIN_HOME`; minimal scopes; clear revocation path; optional future keychain/OS secret store (follow-ups can mirror ripmail OPP-042 “keychain” notes).

## Non-goals (for this opportunity)

- Replacing ripmail’s IMAP engine with a pure Gmail API sync (possible future tradeoff; not required to ship “Gmail works great in Braintunnel”).
- Full parity for **non-Gmail** providers in the same milestone (covered by separate work).

## Proposed architecture

### OAuth flow ownership

- **Redirect URI** registered in Google Cloud points at **Braintunnel’s origin** (e.g. `https://…/oauth/google/callback` in hosted scenarios, or loopback for dev — same constraints as today: exact match).
- **Braintunnel** completes the code exchange, stores refresh token, and schedules refresh before ripmail runs sync.
- **ripmail** is invoked with **environment or config** that points at the existing mailbox directory; it **reads** `google-oauth.json` and uses **XOAUTH2** for IMAP/SMTP as today.

If Braintunnel and ripmail ever disagree on **scope sets** or **token format**, treat that as a **contract** documented in one place (shared JSON schema or ripmail doc section “written by Braintunnel”).

### Scopes

- **IMAP / SMTP (mail):** Gmail scopes that permit **IMAP** and **sending** via XOAUTH2 (ripmail’s existing model).
- **Calendar:** Separate Google Calendar API scopes; Braintunnel’s server (or a small module) calls Calendar APIs using the **same OAuth connection** if we use one consent screen, or a phased consent (“Add calendar”) — product decision.
- Avoid over-scoping at first; add scopes only when a feature is shipped.

### Direct API usage in Braintunnel

- **Calendar:** Natural fit for **REST** from Node (cache under `BRAIN_HOME/cache/` per existing layout notes).
- **Gmail REST:** Optional for metadata, search, or attachments later; **not** required if IMAP + local index remain the source of truth for mail content.

### Failure modes

- Token revoked or expired: surface **Reconnect Gmail** in UI; re-run OAuth; ripmail picks up new token file.
- `redirect_uri_mismatch`: in-app help that matches Google Cloud Console exactly (same as ripmail wizard today, but surfaced in Braintunnel).

## User experience (sketch)

1. User chooses **Connect Gmail** during onboarding or settings.
2. Browser/system web view opens Google consent; user approves.
3. Braintunnel shows **Connected** and optional **Calendar access** if requested in the same flow or a second step.
4. Background: ripmail sync starts (or user taps **Sync now**); inbox/indexing progress uses existing status patterns from [OPP-006](./OPP-006-email-bootstrap-onboarding.md).

## Relationship to other docs

- [OPP-009](./OPP-009-oauth-relay-in-app.md) — relay / Hono-side OAuth; this OPP is the **Gmail-first product slice** of that direction plus **token sharing** with ripmail.
- [ripmail OPP-042](../../ripmail/docs/opportunities/OPP-042-google-oauth-cli-auth.md) — canonical behavior for **CLI OAuth** today; Braintunnel should **converge on compatible on-disk representation** or explicitly version a new file shape with ripmail support.
- [OPP-006](./OPP-006-email-bootstrap-onboarding.md) — onboarding narrative once mail is connected.
- [OPP-020](../OPP-020-brain-owned-sending-address.md) — alternative send path (Brain-owned address); orthogonal to “connect my Gmail.”

## Open questions

- **Single consent vs. stepped consent** for Calendar vs. mail.
- Whether **desktop (Tauri)** uses the same loopback redirect as CLI or an **https** app link (custom URL scheme vs. localhost) — must match Google OAuth client type.
- **Multi-account Gmail** — one Braintunnel user, multiple Google accounts: mailbox id scheme already per-email under ripmail; app settings should mirror.

## Status (historical)

**Shipped (2026-04) —** see the archive banner at the top of this file. Ongoing: [OPP-043](../OPP-043-google-oauth-app-verification-milestones.md) (verification / production Google project).