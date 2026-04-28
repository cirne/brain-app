# BUG-027: Calendar — `create_event` rejects source while `list_calendars` returns none

**Status:** Open  
**Tags:** `calendar` · `oauth` · `staging` · `hosted`  

**Related:** [`docs/architecture/data-and-sync.md`](../../architecture/data-and-sync.md) (indexed calendar vs agent tools); [OPP-043](../opportunities/OPP-043-google-oauth-app-verification-milestones.md), [BUG-021 archived](archive/BUG-021-calendar-events-utc-instead-of-user-timezone.md) (timezone display — fixed separately).

---

## Summary

Attempting to create a **timed calendar hold** through the agent failed: **`create_event`** reported that the workflow only supports **Google Calendar sources via OAuth**, and **`list_calendars`** for the configured Gmail-associated source returned **no calendars**. The user could still update wiki content; **calendar mutation did not complete**.

Distinct from archived **BUG-021** (display timezone). This bug is **OAuth/tool plumbing or source wiring** (scopes, consent, token, or stale source id) yielding an **empty calendar list**.

---

## Repro (from feedback)

1. Use a Gmail-based mail setup where the user expects Brain to schedule on their Google Calendar.
2. Ask the assistant to **`create_event`** for a bounded local time window.
3. Observe **`create_event`** rejecting or refusing the configured source (`… only works for Google Calendar sources …` class message).
4. Call **`list_calendars`** with the same source context.
5. Observe **zero calendars**, blocking scheduling.

---

## Expected

Either:

- **`list_calendars`** returns the user’s calendars when Gmail **Calendar scopes** are granted and refresh has run, **or**
- Errors are **actionable**: missing scope / reconnect / which account to authorize — **not** silent empty lists when OAuth is nominally linked.

---

## User feedback

- In-app issue **#11** (`2026-04-26`).
