# BUG-047: `refresh` fails for Google OAuth mailboxes when OAuth client credentials are missing; errors may leak build paths

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** sync, oauth, packaging, errors, agent-first

**Design lens:** [Agent-first](../../VISION.md) — prebuilt installs should work without manual OAuth client setup when that is the product intent; error text must not expose CI or developer machine paths.

---

## Summary

After configuring a mailbox with `imapAuth: "googleOAuth"`, `ripmail refresh` can fail with “Google OAuth Desktop client id and secret are not available,” listing resolution order across env and files. Reported case: all sources empty including bundled defaults.

**Additional issue:** Error output included a **build-time path** such as `/Users/runner/work/ripmail/ripmail/.env`, which is not meaningful on end-user machines and suggests path leakage from compile-time strings.

**Consequence:** Index stays stale; user may not know they need BYO OAuth client vs expecting a shipped default.

---

## Reported context

- **ripmail:** 0.1.6  
- **Session:** ztest / agent UAT, 2026-04-11  
- **Related product doc:** [OPP-042](../../opportunities/OPP-042-google-oauth-cli-auth.md)  

---

## Recommendations

1. **Release policy:** Ensure prebuilt binaries intended for `install.sh` users embed public desktop OAuth client credentials at build time, or document BYO OAuth as mandatory with a single clear doc link.  
2. **Errors:** Never print internal or CI workspace paths; show only paths users can edit (`~/.ripmail/.env`, repo `.env` for dev).  
3. **Diagnostics:** Distinguish “token refresh failed” vs “no OAuth client configured.”

---

## References

- Vision: [VISION.md](../../VISION.md)  
- [OPP-042 — Google OAuth CLI auth](../../opportunities/OPP-042-google-oauth-cli-auth.md)  
- Feedback: `riptest/feedback/bug-refresh-oauth-client-missing.md` (processed 2026-04-11)
