# BUG-027: Calendar — `create_event` rejects source while `list_calendars` returns none

**Status:** Fixed (2026-05-11)  
**Tags:** `calendar` · `oauth` · `staging` · `hosted`  

**Related:** [`docs/architecture/data-and-sync.md`](../../architecture/data-and-sync.md) (indexed calendar vs agent tools); [OPP-043](../../opportunities/OPP-043-google-oauth-app-verification-milestones.md), [BUG-021 archived](BUG-021-calendar-events-utc-instead-of-user-timezone.md) (timezone display — fixed separately).

---

## Summary

Attempting to create a **timed calendar hold** through the agent failed: **`create_event`** reported that the workflow only supports **Google Calendar sources via OAuth**, and **`list_calendars`** for the configured Gmail-associated source returned **no calendars**. The user could still update wiki content; **calendar mutation did not complete**.

Distinct from archived **BUG-021** (display timezone). This bug was **OAuth/tool plumbing or source wiring** (scopes, consent, token, or stale source id) yielding an **empty calendar list** or **failed mutations** when the token could not refresh.

**Additional symptom (same family):** Google’s token endpoint returned **HTTP 400** during refresh — event creation stayed blocked after “refresh sources” (**user feedback #15**).

---

## Fix summary

- **`list_calendars` live discovery failures are now actionable:** single-source Google Calendar discovery no longer silently collapses live OAuth failures into `{"calendars":[]}` when an OAuth token file exists. The tool tells the assistant to reconnect Google Calendar and includes the underlying error class.
- **Calendar sync now matches Gmail invalid-grant hygiene:** if `syncGoogleCalendarSource` reports `invalid_grant`, refresh removes the owning mailbox’s `google-oauth.json` via `oauthSourceId`, so the next path drives reconnect instead of repeatedly reusing a poisoned token.
- **Tests:** `calendarTools.test.ts` covers the surfaced `list_calendars` OAuth failure; `refresh.test.ts` covers calendar invalid-grant token cleanup; `googleCalendar.test.ts` covers API-layer 400 propagation.

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
- In-app issue **#15** (`2026-04-29`) — calendar **create** blocked; OAuth **token refresh** returned **HTTP 400**; retry after refreshing sources still failed.
