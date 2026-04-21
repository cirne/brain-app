# Archived: OPP-053 — Indexed calendar in ripmail

**Status: Closed — archived 2026-04-21.** Phase A (sources, `refresh`, SQLite + FTS, `ripmail calendar`) shipped and maintained in code. Phase B (writes / scheduling), EventKit, and “beyond” items are **not** on the near-term roadmap; tracking epic retired.

---

# OPP-053: Indexed calendar in ripmail (read path)

**Historical status:** Phase A **implemented** (ripmail: sources, `refresh`, SQLite + FTS, `ripmail calendar …`). Phase B (**scheduling** / writes) not started. Optional **EventKit** helper still pending (macOS).

**Created:** 2026-04-19.

---

## Summary

Add **calendar** as a first-class `**sources[]` kind** in ripmail: events land in **normalized rows** in SQLite (dedicated tables + FTS), `**ripmail refresh`** pulls Google / ICS / (future) Apple, and agents query via `**ripmail calendar`** (`list-calendars`, `today`, `upcoming`, `search`, `read`) with `**-S` / `--source**` and `**--json**`, consistent with mail.

**Overall architecture** (one CLI, multiple corpora, host alignment, Messages exception): **[ripmail ADR-029](../ARCHITECTURE.md)** and **brain-app** [integrations — trust boundaries](../../../docs/architecture/integrations.md#trust-boundaries-ripmail-vs-direct-sqlite-access).

---

## Problem

- **ICS-only caches** in a host app are fine for simple read-only subscriptions but are weak for **stable identity**, **incremental sync**, and **writes** (recurrence, exceptions, attendees).
- **Calendar accounts are not the same as mail accounts**; config should allow linking identities without implying one IMAP mailbox implies one calendar backend.
- **Agents** need one predictable contract: `**refresh`**, structured JSON, `**--source`**, stable ids — same patterns as search/read for mail.

---

## Scope

### Phase A (done)

- Schema: `**calendar_events**`, `**calendar_events_fts**`, `**calendar_sync_state**` (clean break on schema bump per repo norms).
- Config: `**googleCalendar**`, `**appleCalendar**`, `**icsSubscription**`, `**icsFile**`; fields for OAuth linkage, `**calendarIds**`, `**ics_url**`, file `**path**`.
- `**ripmail sources**`: add/list/edit/remove/status for calendar kinds (with `**sources add --help**` for required flags).
- `**ripmail refresh**`: syncs calendar sources in the same foreground/background pipeline as mail / local dir (`**-S` / `--source**`).
- Backends: **ICS** (file + URL); **Google Calendar API** with existing OAuth token flow and **read-only** calendar scope; **Apple**: stub until `**ripmail-eventkit`** (or equivalent) ships.
- CLI: `**ripmail calendar`** query commands; **root help** line + sources line (workflow index, not a second manual).

### Phase B (future)

- `**ripmail calendar create|update|delete`**, explicit `**--calendar`** for writes, broader OAuth scopes where needed.
- **Apple Calendar** end-to-end via a **single** native helper (NDJSON or similar), **Info.plist** TCC strings — see impl notes in [OPP-053-impl-plan.md](OPP-053-impl-plan.md).

---

## Backends (Phase A)


| Kind                              | Role                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| **icsFile** / **icsSubscription** | No OAuth; validates parse → DB → CLI.                                           |
| **googleCalendar**                | Calendar API + OAuth reuse ([OPP-042](OPP-042-google-oauth-cli-auth.md)).       |
| **appleCalendar**                 | macOS only; EventKit via future helper (currently errors with a clear message). |


**ICS** remains an **ingest** format; the **source of truth** for queries in ripmail is the **index**, not the raw `.ics` file alone.

---

## Brain-app

Today the **web UI** and agent tool `**get_calendar_events`** still use the **ICS → JSON cache** under `**$BRAIN_HOME/cache/`** (env-driven URLs — see [data-and-sync](../../../docs/architecture/data-and-sync.md)). **Switching** those paths to `**ripmail calendar … --json`** (or merging both) is **follow-up work**; it is **not** required to consider Phase A of this opp done.

---

## Related

- [OPP-051](OPP-051-unified-sources-mail-local-files-future-connectors.md) — unified `sources`, `refresh`, `--source`.
- [OPP-052](OPP-052-search-query-language-regex-metadata-flags.md) — generalized search language (alignment over time).
- [OPP-042](OPP-042-google-oauth-cli-auth.md) — Google OAuth for CLI; token reuse for Calendar API.
- [OPP-050](OPP-050-applemail-localhost-mailbox.md) — Apple Mail indexing; same “local macOS resource” family as EventKit.
- [OPP-053-impl-plan.md](OPP-053-impl-plan.md) — validation plan, manual TCC notes when the EventKit helper exists.
- Brain-app [OPP-019](../../../docs/opportunities/OPP-019-gmail-first-class-brain.md), [OPP-022](../../../docs/opportunities/OPP-022-google-oauth-app-verification.md) — product OAuth and verification when scopes widen.

---

## Open questions (calendar)

1. **Default writable calendar** when the user has both Google and Apple writable calendars (Phase B).
2. **Incremental Google sync** — tune `syncToken` / 410 recovery vs full-window behavior in the field.
3. **Linux / Windows:** Google API + ICS only; Apple calendar kinds remain **unsupported** off-macOS (clear errors).
4. Optional **long-lived helper** vs **invoke-per-`refresh`** if sync latency becomes an issue.