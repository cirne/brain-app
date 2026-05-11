# BUG-052: Inbox never renders HTML for downloaded mail

**Status:** Fixed (2026-05-11).  
**Severity:** High.  
**Tags:** ripmail, inbox, html-display, sync-indexing

## Summary

Inbox message display effectively never returned `bodyHtml` for normal multipart mail. The UI could render HTML through `emailDisplayBodyToIframeSrcdoc()`, but `GET /api/inbox/:id` usually returned `bodyKind: "text"` because `readMailForDisplay()` re-parsed the raw `.eml` at display time and gated HTML behind fragile `Message-ID` and body-fingerprint checks.

Fresh-account repros showed this was not just old raw-cache drift. The deeper issue was simpler: sync-time parsing already extracted the HTML MIME part, but persistence discarded it. Display then had to recover it later from `raw_path`.

## Fix

Store HTML at sync time and read it from the same SQLite row as the displayed headers:

- Added `messages.body_html` and bumped `SCHEMA_VERSION` to 31.
- Changed `parseEml()` to keep real HTML MIME parts without synthesizing HTML from text-only mail.
- Updated `persistMessage()` to insert/update `body_html`.
- Simplified `readMailForDisplay()` to return `body_html` directly, removing raw `.eml` re-parsing, `Message-ID` trust checks, and fingerprint heuristics.
- Removed the dead client-side auto-detect/plaintext cleanup path around `mailBodyToDisplayHtml()`.

## Why This Avoids BUG-051 Regressions

HTML now comes from the selected `messages` row, not from a display-time `raw_path` parse. A stale or wrong raw file cannot inject another message's HTML body under the selected row's headers.

## Tests

- `src/server/ripmail/ripmail.test.ts`
- `src/server/ripmail/sync/parse.test.ts`
- `src/server/ripmail/sync/persist.test.ts`
- `src/client/lib/mailBodyDisplay.test.ts`
