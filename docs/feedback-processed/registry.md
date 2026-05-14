# In-app feedback → backlog registry

When you finish triaging a feedback item, **append a row** (or edit this table) so the next run can skip it.

| Feedback issue id | Submitted (ISO, from report) | Tracked as | Processed (UTC) |
| ----------------- | ----------------------------- | ---------- | ----------------- |
| 1 | 2026-04-24T15:54:39.686Z | [BUG-018](../bugs/archive/BUG-018-hub-resume-does-not-unpause-your-wiki.md) | 2026-04-24 |
| 2 | 2026-04-24T16:33:30.359Z | [BUG-019](../bugs/BUG-019-mail-visible-in-client-but-missing-from-search.md) | 2026-04-24 |
| 3 | 2026-04-24T17:58:32.417Z | [BUG-020](../bugs/archive/BUG-020-staging-gmail-send-oauth-refresh-fails.md) | 2026-04-24 |
| 4 | 2026-04-24T19:08:30.885Z | [Deferred: blur / hide sensitive previews](deferred.md) | 2026-04-25 |
| 5 | 2026-04-24T19:13:19.265Z | [Deferred: multi-client SSE session refresh](deferred.md) | 2026-04-25 |
| 6 | 2026-04-24T19:32:22.731Z | [BUG-021](../bugs/archive/BUG-021-calendar-events-utc-instead-of-user-timezone.md) | 2026-04-25 |
| 7 | 2026-04-24T20:47:45.341Z | [Deferred: wiki Back/Forward](deferred.md) | 2026-04-25 |
| 8 | 2026-04-24T20:50:05.464Z | [Deferred: external calendar invite actions](deferred.md) | 2026-04-25 |
| 9 | 2026-04-24T21:02:59.368Z | [BUG-022](../bugs/BUG-022-inbox-surfaced-as-ignored-without-matching-user-rules.md) | 2026-04-25 |
| 10 | 2026-04-25T15:48:13.100Z | [BUG-039](../bugs/BUG-039-archive-leading-dash-message-id-parsed-as-cli-flag.md) | 2026-04-28 |
| 11 | 2026-04-26T16:58:39.622Z | [BUG-027 archived](../bugs/archive/BUG-027-calendar-create-event-empty-list-rejects-source.md) — **fixed** (`list_calendars` OAuth errors are actionable; invalid calendar grants clear tokens) | 2026-05-11 |
| 12 | 2026-04-27T14:21:21.258Z | [archived OPP-057](../opportunities/archive/OPP-057-chat-viewport-resize-or-expand.md) | 2026-04-28 |
| 13 | 2026-04-27T18:42:19.159Z | [BUG-028](../bugs/BUG-028-agent-email-draft-wrong-recipient-and-signature.md) | 2026-04-28 |
| 14 | 2026-04-29T17:52:59.719Z | [archived OPP-070](../opportunities/archive/OPP-070-full-calendar-read-write-agent-surface.md) — **core calendar mutations shipped** in `main` (see OPP-070 acceptance audit); was [archived OPP-063](../opportunities/archive/OPP-063-google-calendar-recurring-and-update-events.md) | 2026-04-30 |
| 15 | 2026-04-29T21:09:50.548Z | [BUG-027 archived](../bugs/archive/BUG-027-calendar-create-event-empty-list-rejects-source.md) — **fixed** token refresh **HTTP 400** / invalid grant handling | 2026-05-11 |
| 16 | 2026-05-09T16:17:29.175Z | [BUG-028](../bugs/BUG-028-agent-email-draft-wrong-recipient-and-signature.md) + [BUG-050](../bugs/BUG-050-agent-wiki-read-enoent-during-compose.md) (compose + wiki **ENOENT**) | 2026-05-11 |
| 17 | 2026-05-09T16:55:13.237Z | [BUG-049 archived](../bugs/archive/BUG-049-archive-emails-tool-reported-success-when-ripmail-local-failed.md) — **fixed** (`archive_emails` counts `local.ok` only; shipped **2026-05-09**) | 2026-05-11 |
