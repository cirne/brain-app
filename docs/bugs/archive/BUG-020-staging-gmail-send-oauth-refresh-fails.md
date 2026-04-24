# BUG-020: Staging — Gmail send fails when OAuth access token refresh fails

**Status:** **Fixed (2026-04-24).** Resolved in production by restoring valid Google OAuth tokens (e.g. revoke + reconnect, or full sign-in flow that rewrites `google-oauth.json`). **No code change** was required for this instance.

## Summary

Outbound send (draft → send) got through **draft load** and **MIME construction**, then failed when ripmail needed a **Google OAuth access token**. The refresh request to **`https://oauth2.googleapis.com/token`** failed (expired or missing access token / refresh failure), so the send pipeline aborted before mail went out.

This was **not** the same failure mode as [BUG-013](BUG-013-hosted-gmail-smtp-egress-blocked-digitalocean.md), which was **SMTP port blocking** after OAuth had already succeeded; here the blocker was **token refresh** over HTTPS.

## Related feedback

- In-app feedback issue **#3**, submitted **2026-04-24** (title: Gmail send fails during OAuth token refresh; `appHint`: ripmail send / Gmail OAuth token refresh).

## Repro (historical)

1. Create a draft email to a recipient.
2. Attempt to send the draft.
3. Observe progress through draft loading and MIME build.
4. Send fails while obtaining a Google OAuth access token, with refresh failing at `https://oauth2.googleapis.com/token`.

## Resolution

Stale or invalid **refresh token** / consent state on the tenant; **re-authorizing** Gmail for the account replaced tokens and send succeeded again.

## Historical hypotheses (for similar reports)

| Area | Why it could bite staging |
| ---- | ------------------------- |
| **Stored refresh token** | Revoked, rotated, or missing row in tenant `google-oauth.json` / ripmail credential store. |
| **OAuth client config** | Staging `GOOGLE_OAUTH_CLIENT_ID` / secret mismatch vs token family; wrong client type for refresh. |
| **Clock / TLS** | Container clock skew rare but can break OAuth; TLS intercept unlikely on DO but worth ruling out from logs. |
| **Scope / consent** | Send path needs scopes that were granted at sign-in; partial or stale consent. |

## Related code (pointers)

- Brain: inbox send route — `src/server/routes/inbox.ts`; ripmail invocation — `src/server/lib/ripmailRun.ts`, agent tools.
- Ripmail: Gmail API send — `ripmail/src/send/gmail_api_send.rs`; OAuth / token refresh used by send and IMAP.
