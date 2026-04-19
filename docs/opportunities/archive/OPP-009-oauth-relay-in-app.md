# Archived: OPP-009 (OAuth Relay in App)

**Status: Done enough — archived.** OAuth handling for Gmail/Google (used by ripmail) is now handled inside brain-app via Hono routes. The standalone Cloudflare Worker (`oauth-relay/`) in the old ripmail repo is no longer needed. See [OPP-019](../OPP-019-gmail-first-class-brain.md) for ongoing Google OAuth / API scope work.

**What shipped:**
- OAuth callback routes in brain-app (Hono) handle the Google OAuth redirect and token exchange
- Ripmail XOAUTH2 tokens are obtained and stored under `RIPMAIL_HOME` — same artifacts, no duplicate login
- No dependency on the old Cloudflare Worker deployment

---

# OPP-009: OAuth relay in brain-app (ripmail)

## Summary

The standalone ripmail repo shipped a **Cloudflare Worker** (`oauth-relay/`) for hosted OAuth flows. That subtree was **not** folded into the brain-app monorepo when ripmail became [`ripmail/`](../../ripmail/) here.

## Direction

Implement the same relay behavior **inside brain-app** (Hono routes or a small adjunct service) so Gmail/OAuth flows used by ripmail can complete without depending on the old Worker deployment.

## References

- Ripmail OAuth code under [`ripmail/src/oauth/`](../../ripmail/src/oauth/)
- Prior Worker lived at `oauth-relay/` in the public ripmail repo (archived when that repo is closed)
