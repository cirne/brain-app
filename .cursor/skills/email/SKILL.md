---

name: email
description: >-
  Use for anything email-related in Braintunnel: finding a message, reading a thread,
  checking what's in the inbox, drafting or sending a reply, or investigating
  why an expected email didn't show up or was hidden by a filter. Prefer the
  built-in tools (`search_index`, `read_email`, `list_inbox`, `inbox_rules`, `draft_email`,
  `send_draft`, etc.); do not assume a raw `ripmail` shell is available.
---

# Email (Braintunnel)

User-facing email workflows in the assistant. **No slash commands assumed** — natural language is enough; this skill’s description is the load trigger.

## Agent checklist

1. **Freshness:** If the user cares about *right now*, run **`refresh_sources`** first (or say you’re starting a background sync and to wait briefly before `search_index` / `list_inbox`).
2. **Find then read:** Prefer **`search_index`** for “where is that mail,” then **`read_email`** (and **`read_attachment`** if needed) with the returned `messageId`.
3. **Inbox vs search:** Use **`list_inbox`** for “what’s in my triaged inbox / what the app surfaces,” not full-text search across everything. See [references/INBOX.md](references/INBOX.md).
4. **People:** Use **`find_person`** for contact-style questions (who is this, top correspondents, phone/name).
5. **Never paste secrets:** OTPs, reset links, credentials — summarize or confirm found without dumping full bodies unless asked.
6. **After inbox summary:** Almost always leave an **Archive** suggestion ( **`archive_emails`** ) — for a long list, “archive all shown” can be fine; for a handful, prefer **specific** archives for **`notify` / `inform`** items they’ve skimmed or don’t need in the inbox anymore. Avoid centering archive on **`ignore`** / promo buckets they’re already quietly filtered; suggest archiving those **only if** clutter is still chewing space or they asked to tidy.

## Tools (quick map)

| Goal | Tool |
| --- | --- |
| Full-text / keyword find | `search_index` |
| Open a message | `read_email` |
| Attachments | `read_attachment` |
| What the inbox shows | `list_inbox` (optional `thorough: true` when diagnosing missing mail) |
| Filters / rules | `inbox_rules` |
| Remove from inbox scan | `archive_emails` |
| Sync | `refresh_sources` |
| New / reply / forward | `draft_email` |
| Revise draft | `edit_draft` |
| Send (after user confirms) | `send_draft` |
| Contacts / identity | `find_person` |

## When to open sub-documents

- **Compose and send** — [references/COMPOSE.md](references/COMPOSE.md) (`draft_email`, `edit_draft`, `send_draft`, multi-mailbox `from`).
- **Inbox rhythm and “missing email”** — [references/INBOX.md](references/INBOX.md) (`list_inbox` + `thorough`, `inbox_rules`, user wording “filters”).

## OTP / verification codes

Use **`search_index`** for the provider or sender, then **`read_email`** on the best `messageId`. Do not rely only on “refresh finished” messages for the code. (Detail: ripmail’s [AUTH-CODES.md](https://github.com/cirne/zmail/blob/main/skills/ripmail/references/AUTH-CODES.md) describes the CLI pattern; Brain uses the tools above.)

## Related skills

- **morning-report** — day-level scan; inbox is a few bullets unless the user wants depth.
- **briefing** — meeting prep; mail is context, not full triage unless asked.
