# BUG-060: `read_mail_message` returned empty `bodyText` for HTML-only mail while inbox showed content

**Status:** **Fixed (2026-05-15).**  
**Tags:** `ripmail` · `mail` · `agent` · `read_mail_message` · `html`

**Related:** [BUG-052](BUG-052-inbox-html-email-display-never-renders.md) (inbox `body_html` persistence) · [`src/server/ripmail/mailRead.ts`](../../../src/server/ripmail/mailRead.ts) · [`src/server/lib/htmlToAgentMarkdown.ts`](../../../src/server/lib/htmlToAgentMarkdown.ts)

---

## Summary

For HTML-only notification mail (e.g. NetJets tail-number messages), SQLite often had **empty `body_text`** with **populated `body_html`**. The inbox panel rendered HTML, but **`read_mail_message`** returned **empty `bodyText`**, so the assistant concluded facts (e.g. aircraft type) were missing when they were visible in the UI.

---

## Repro (from in-app feedback **#19**)

1. `search_index` → **NetJets Tail Number Notification**.
2. `read_mail_message` on the message id → **`bodyText` empty**.
3. Open the same message in the inbox UI → body visible (HTML).
4. Assistant answers that plane type was not shown; user reports it is in the message.

---

## Root cause

`readMail()` returned `body_text` as-is and did not derive agent-visible text from stored `body_html` when plaintext was empty.

---

## Fix

**`2522c87`** — when `body_text` is blank and `body_html` is present, set `bodyText` via `htmlToAgentMarkdown(body_html)` (same Turndown path as other agent surfaces). Regression: `ripmail.test.ts` “derives agent-visible body text from stored HTML when body_text is empty”.

---

## User feedback

- In-app issue **#19** (`2026-05-15T15:31:11.473Z`).
