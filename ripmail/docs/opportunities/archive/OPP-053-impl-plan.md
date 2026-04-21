# Archived: OPP-053 implementation & validation plan

**Status: Closed — archived 2026-04-21** with [OPP-053](OPP-053-local-gateway-calendar-and-beyond.md). Kept for Phase A validation notes and Phase B sketches.

---

# OPP-053: Implementation & Validation Plan
## Local Gateway CLI — Calendar (Google + EventKit), Mail, Files, and Beyond

**Companion to:** [OPP-053](OPP-053-local-gateway-calendar-and-beyond.md)

**Written:** 2026-04-19

---

## Scope of this document

This plan covers **Phase A** (read + index + query) in full, and sketches **Phase B** (write / scheduling) at the interface level. It also addresses the open architectural questions in the OPP.

---

## Resolving the open questions up front

### 1. Schema: separate tables vs unified `documents`

**Decision: separate `calendar_events` table + dedicated FTS5 virtual table.**

Reasons:
- Calendar events have a fundamentally different shape (start/end, recurrence, attendees, all-day flag) that does not map cleanly into a `documents` abstraction without a very wide nullable column set.
- Keeping event rows separate makes time-range queries efficient (indexed `start_at` / `end_at` columns) without scanning mail rows.
- A `kind` discriminator on a unified table is simpler in theory but forces the query layer to always filter by kind, adds nullable columns for every domain, and couples schema migrations across unrelated sources.
- `sourceId` + `sourceKind` fields on every record (mail, files, events) still provide the unified search story from OPP-051 at the output / JSON layer; the storage split is an implementation detail.

### 2. Default writable calendar for scheduling

**Decision (Phase B gate): require explicit `--calendar <id>` on all write commands; no implicit default.**

- On first run of any write command without `--calendar`, print an error listing the user's writable calendars (by id and name) and ask them to re-run with `--calendar`.
- Optionally persist a `defaultWritableCalendar` per source in config after the user runs `ripmail calendar set-default --source <id> --calendar <id>`.
- This avoids silently writing to the wrong calendar when a user has both Google and Apple writable calendars.

### 3. Linux / Windows

**Decision: Google Calendar API + ICS sources supported everywhere; EventKit is macOS-only with a compile-time feature flag.**

- `Cargo.toml`: feature `apple-eventkit` (enabled by default on macOS targets).
- On non-macOS, `ripmail sources add --kind appleCalendar` returns a clear error: `"appleCalendar sources are only supported on macOS"`.
- CI matrix: run EventKit-dependent tests only on macOS runners.

### 4. Daemon vs pure CLI

**Decision: stay invoke-per-operation for v1.**

- Google Calendar's incremental sync token is cheap to re-establish per invocation.
- EventKit reads via the helper subprocess are fast for typical calendar sizes.
- Re-evaluate if sync latency becomes a problem (i.e., if the agent loop feels slow waiting for a full re-sync on each query).

---

## Architecture overview

```
ripmail binary (Rust)
├── cli/commands/calendar.rs          ← new; Phase A + B commands
├── calendar/
│   ├── mod.rs
│   ├── model.rs                      ← CalendarEvent, Attendee, RecurrenceKind
│   ├── db.rs                         ← insert/query/fts for calendar_events
│   ├── google/
│   │   ├── mod.rs
│   │   ├── sync.rs                   ← full sync + incremental (syncToken)
│   │   ├── api_types.rs              ← serde structs for Calendar API responses
│   │   └── oauth.rs                  ← scope extension + token reuse from OPP-042
│   ├── apple/
│   │   ├── mod.rs
│   │   └── helper_client.rs          ← spawn ripmail-eventkit, parse NDJSON
│   └── ics/
│       ├── mod.rs
│       └── parse.rs                  ← ical → CalendarEvent (reuse or thin-wrap icalendar crate)
└── db/schema.rs                      ← add calendar_events + calendar_events_fts tables

ripmail-eventkit  (separate Swift CLI, new target)
├── main.swift
├── EventKitBridge.swift              ← EKEventStore → NDJSON writer
└── Info.plist                        ← NSCalendarsUsageDescription + NSCalendarsWriteOnlyAccessUsageDescription
```

**The EventKit helper is a second Mach-O in the same Cargo workspace** under `eventkit-helper/` (Swift Package or plain `swiftc` build step integrated into `build.rs` or a `Makefile`). It is bundled alongside `ripmail` in the Tauri app and in any release archive. The ripmail binary locates it via `RIPMAIL_EVENTKIT_HELPER` env var or a path relative to the ripmail binary itself.

---

## Data model

### `calendar_events` table

```sql
CREATE TABLE calendar_events (
    id              INTEGER PRIMARY KEY,
    source_id       TEXT NOT NULL,                  -- matches sources[].id in config
    source_kind     TEXT NOT NULL,                  -- 'googleCalendar' | 'appleCalendar' | 'icsSubscription' | 'icsFile'
    calendar_id     TEXT NOT NULL,                  -- Google calendarId, EventKit calendarIdentifier, or ICS filename
    uid             TEXT NOT NULL,                  -- stable event UID from source (RFC 5545 UID or Google event id)
    summary         TEXT,
    description     TEXT,
    location        TEXT,
    start_at        INTEGER NOT NULL,               -- Unix timestamp UTC (seconds); for all-day: midnight UTC of the date
    end_at          INTEGER NOT NULL,               -- exclusive end
    all_day         INTEGER NOT NULL DEFAULT 0,     -- bool
    timezone        TEXT,                           -- IANA tz name from source; NULL for all-day
    status          TEXT,                           -- 'confirmed' | 'tentative' | 'cancelled'
    rrule           TEXT,                           -- RRULE string if recurring; NULL otherwise
    recurrence_json TEXT,                           -- JSON: exceptions, exdates
    attendees_json  TEXT,                           -- JSON: [{email, name, responseStatus}]
    organizer_email TEXT,
    organizer_name  TEXT,
    updated_at      INTEGER,                        -- source-reported update timestamp (Unix)
    synced_at       INTEGER NOT NULL,               -- when ripmail indexed this (Unix)
    raw_json        TEXT,                           -- full source payload (Google API object or iCal VEVENT text); optional, for re-parse without re-sync
    UNIQUE(source_id, uid)
);

CREATE INDEX calendar_events_source ON calendar_events(source_id);
CREATE INDEX calendar_events_time   ON calendar_events(start_at, end_at);
CREATE INDEX calendar_events_uid    ON calendar_events(uid);

CREATE VIRTUAL TABLE calendar_events_fts USING fts5(
    summary, description, location, organizer_email, organizer_name,
    content='calendar_events', content_rowid='id'
);
```

### Source sync state

Add a `calendar_sync_state` table (or reuse an existing key-value store) to hold per-source, per-calendar incremental sync tokens:

```sql
CREATE TABLE calendar_sync_state (
    source_id   TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    sync_token  TEXT,                   -- Google nextSyncToken; NULL means full sync needed
    synced_at   INTEGER,
    PRIMARY KEY (source_id, calendar_id)
);
```

### Normalized `CalendarEvent` Rust struct

```rust
pub struct CalendarEvent {
    pub uid: String,
    pub source_id: String,
    pub source_kind: SourceKind,
    pub calendar_id: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start: EventTime,
    pub end: EventTime,
    pub status: Option<String>,
    pub rrule: Option<String>,
    pub recurrence: Option<serde_json::Value>,
    pub attendees: Vec<Attendee>,
    pub organizer: Option<Organizer>,
    pub updated_at: Option<i64>,
}

pub enum EventTime {
    DateTime { utc_secs: i64, timezone: String },
    Date { date: chrono::NaiveDate },            // all-day
}
```

---

## Phase A: Read + Index

### Step 1 — Schema migration

- Add `calendar_events`, `calendar_events_fts`, and `calendar_sync_state` tables to `db/schema.rs`.
- Per repo norms: no migration; bump schema version; users delete `RIPMAIL_HOME` and reconfigure.

### Step 2 — Google Calendar source

**Config shape** (extending OPP-051 sources):

```json
{
  "id": "work-gcal",
  "kind": "googleCalendar",
  "label": "Work Google Calendar",
  "email": "user@gmail.com",        // links to existing OAuth account (same token storage as OPP-042)
  "calendarIds": ["primary"],       // default: ["primary"]; list to sync multiple calendars
  "search": { "includeInDefault": false }
}
```

**OAuth scope additions:**
- Phase A: add `https://www.googleapis.com/auth/calendar.readonly` to the consent screen scopes.
- Phase B: upgrade to `https://www.googleapis.com/auth/calendar` when write commands are introduced.
- Token storage: follow the same `google-oauth.json` per-account pattern from `src/oauth/`. Calendar tokens live at `RIPMAIL_HOME/<source_id>/google-oauth.json` (separate from any IMAP token for the same email, since scopes differ).

**Sync algorithm** (`calendar/google/sync.rs`):

```
fn sync_google_calendar(source, calendar_id, db):
    token = load_sync_token(db, source.id, calendar_id)
    if token is None:
        # Full sync: fetch all events
        response = GET /calendars/{calendarId}/events?singleEvents=true&maxResults=2500
        loop through pages, upsert each event
        store response.nextSyncToken
    else:
        # Incremental sync
        response = GET /calendars/{calendarId}/events?syncToken={token}
        if response.status == 410 Gone:
            clear token, retry as full sync
        upsert changed events, delete tombstoned (status=cancelled) events
        store response.nextSyncToken
```

Key API details:
- `singleEvents=true`: expand recurring events into instances (simpler for Phase A search/read; Phase B needs the master event for edits — switch to `singleEvents=false` or maintain both).
- Pagination: follow `nextPageToken` until exhausted.
- Rate limits: Google Calendar API allows 1M queries/day per project; incremental sync is very cheap.
- Tombstones: `status=cancelled` events from incremental sync → delete from `calendar_events` (or mark deleted).

### Step 3 — Apple EventKit source

**Config shape:**

```json
{
  "id": "apple-cal",
  "kind": "appleCalendar",
  "label": "Apple Calendar",
  "calendarTitles": [],             // empty = all writable + subscribed calendars
  "search": { "includeInDefault": false }
}
```

**EventKit helper (`eventkit-helper/`):**

A small Swift command-line tool:

```
ripmail-eventkit list-calendars [--json]
ripmail-eventkit list-events --from <iso8601> --to <iso8601> [--calendar <id>] [--json]
ripmail-eventkit get-event --uid <uid> [--json]
```

Output: NDJSON, one event per line, matching the `CalendarEvent` JSON shape.

The helper:
1. Calls `EKEventStore.requestFullAccessToEvents()` (macOS 14+) or `requestAccess(to: .event)` (older).
2. On first run, macOS shows the system permission dialog with the `NSCalendarsUsageDescription` string from `Info.plist`.
3. Subsequent runs use the cached TCC grant.
4. If access is denied: exits with code 1, prints `{"error": "calendar_access_denied"}` to stdout.

**TCC / entitlements:**
- CLI (terminal): `ripmail-eventkit` binary requests calendar access directly. Users see: "ripmail-eventkit" wants access to your Calendar."
- Tauri bundle: add `com.apple.security.personal-information.calendars` to `entitlements.plist` so the app bundle is the TCC principal.
- `NSCalendarsUsageDescription` in Info.plist: `"ripmail reads your calendars to help your AI assistant answer scheduling questions."`

**`helper_client.rs`** in ripmail:

```rust
fn sync_apple_calendar(source, db) -> Result<()> {
    let helper = locate_eventkit_helper()?; // RIPMAIL_EVENTKIT_HELPER or sibling path
    let from = chrono::Utc::now() - Duration::days(30);
    let to = chrono::Utc::now() + Duration::days(180);
    let output = Command::new(helper)
        .args(["list-events", "--from", &from.to_rfc3339(), "--to", &to.to_rfc3339(), "--json"])
        .output()?;
    // parse NDJSON, upsert into calendar_events
}
```

The default sync window (30 days back, 180 forward) is configurable per source in config. A `ripmail refresh --source apple-cal --since 2026-01-01` expands the window.

### Step 4 — ICS source

**Config shape:**

```json
{
  "id": "holidays-ics",
  "kind": "icsSubscription",
  "url": "https://example.com/calendar.ics",  // or "path": "~/Downloads/cal.ics"
  "label": "US Holidays",
  "refreshIntervalHours": 24,
  "search": { "includeInDefault": false }
}
```

**Sync:** HTTP GET (or file read) → parse with the [`icalendar`](https://crates.io/crates/icalendar) crate → normalize to `CalendarEvent` → upsert. ICS UIDs serve as the stable identity.

Read-only: any write command targeting an `icsSubscription` source returns a clear error.

### Step 5 — CLI commands (Phase A)

```
ripmail calendar list-calendars [--source <id>] [--json]
    List calendars available in each configured calendar source.
    Output: [{sourceId, calendarId, name, color, primary, writable}]

ripmail calendar today [--source <id>] [--json]
    Events for today (local time). Alias for --from today --to today+1d.

ripmail calendar upcoming [--days <n=7>] [--source <id>] [--json]
    Events in the next N days.

ripmail calendar search <query> [--from <date>] [--to <date>]
                        [--source <id>] [--calendar <id>] [--json]
    FTS search over summary/description/location filtered by optional time range.
    Output: [{uid, sourceId, calendarId, summary, start, end, location, attendees}]

ripmail calendar read <uid> [--source <id>] [--json]
    Full event detail by UID (or internal rowid from search JSON).

ripmail refresh --source <id>
    Already defined in OPP-051; calendar sources participate in the same refresh contract.
    Syncs the named calendar source (or all sources if --source omitted).

ripmail sources add --kind googleCalendar --email <addr> [--id <id>]
                    [--calendar <calendarId>]... [--label <label>]
    Adds a Google Calendar source. Triggers OAuth if no token for this email+calendar scope.

ripmail sources add --kind appleCalendar [--id <id>] [--label <label>]
    Adds an Apple Calendar source. First refresh triggers TCC prompt.

ripmail sources add --kind icsSubscription --url <url> [--id <id>] [--label <label>]
ripmail sources add --kind icsFile --path <path> [--id <id>] [--label <label>]
```

All new commands follow OPP-051's `--source`, `--json`, and error conventions.

**JSON output contract for `calendar search` / `calendar read`:**

```json
{
  "uid": "abc123@google.com",
  "sourceId": "work-gcal",
  "sourceKind": "googleCalendar",
  "calendarId": "primary",
  "summary": "Team standup",
  "description": "...",
  "location": "Zoom",
  "start": { "dateTime": "2026-04-20T09:00:00-07:00", "allDay": false },
  "end":   { "dateTime": "2026-04-20T09:30:00-07:00", "allDay": false },
  "status": "confirmed",
  "attendees": [
    { "email": "alice@example.com", "name": "Alice", "responseStatus": "accepted" }
  ],
  "organizer": { "email": "bob@example.com", "name": "Bob" },
  "updatedAt": "2026-04-18T14:00:00Z"
}
```

---

## Phase B: Scheduling (Write) — Interface sketch

Phase B gates on Phase A being solid. Listing here for completeness so Phase A schema and OAuth scopes are designed with writes in mind.

```
ripmail calendar create --summary <text>
                        --start <iso8601> --end <iso8601>
                        [--all-day]
                        [--location <text>]
                        [--description <text>]
                        [--attendee <email>]...
                        --source <id> --calendar <calendarId>
                        [--json]
    Create an event. Requires explicit --source and --calendar.
    Google: POST /calendars/{calendarId}/events
    Apple:  ripmail-eventkit create-event ... (Phase B helper extension)
    ICS:    error "icsSubscription sources are read-only"

ripmail calendar update <uid>
                        [--summary <text>] [--start <iso8601>] [--end <iso8601>]
                        [--location <text>] [--description <text>]
                        [--source <id>]
                        [--json]

ripmail calendar delete <uid> [--source <id>] [--yes]

ripmail calendar set-default --source <id> --calendar <calendarId>
    Persist default writable calendar for a source (stored in config).
```

**Write routing logic:**
```
match source.kind {
    googleCalendar => patch Google Calendar API, refresh local index
    appleCalendar  => delegate to ripmail-eventkit write subcommand
    icsSubscription | icsFile => error: "read-only source"
}
```

---

## Brain-app integration

The host app (brain-app) shells out to `ripmail` today for mail. Calendar follows the same pattern:

- Agent tools: `calendar_search(query, from?, to?, source?)`, `calendar_upcoming(days?)`, `calendar_read(uid)`.
- Brain-app calls `ripmail calendar search --json ...` and parses stdout.
- No new IPC protocol needed; the existing subprocess + JSON stdout contract handles it.
- Profilings agent / assistant agent: add calendar context when the user's query mentions scheduling, meetings, or time.

**Exception (documented in brain-app architecture):** iMessage/SMS still uses **direct read-only `chat.db` access in Node** (`list_recent_messages` / `get_message_thread`), not ripmail — see [integrations — trust boundaries](../../../docs/architecture/integrations.md#trust-boundaries-ripmail-vs-direct-sqlite-access); may unify later.

---

## Implementation sequence

| Step | Work | Notes |
|------|------|-------|
| 1 | Schema: `calendar_events` + `calendar_events_fts` + `calendar_sync_state` | Clean slate; wipe RIPMAIL_HOME |
| 2 | `CalendarEvent` model + `db.rs` upsert/query | Unit-testable without network |
| 3 | ICS parse → `CalendarEvent` | Simplest source; good for testing the model |
| 4 | `ripmail calendar search/read/today/upcoming` CLI | Can be validated with ICS data |
| 5 | `ripmail sources add --kind icsSubscription` + `icsFile` | Full end-to-end for ICS |
| 6 | Google Calendar API client + full sync + incremental sync | Depends on OAuth scope extension |
| 7 | `ripmail sources add --kind googleCalendar` + setup flow | OAuth browser flow |
| 8 | `ripmail-eventkit` Swift helper — read path | macOS only; TCC setup |
| 9 | `ripmail sources add --kind appleCalendar` + refresh | Wires helper into ripmail |
| 10 | Phase B: write commands (Google + EventKit) | After read path is stable |

---

## Validation plan

### Unit tests (Rust — `cargo test -p ripmail`)

| Test | What it verifies |
|------|-----------------|
| `calendar::model::test_event_time_all_day` | `Date` variant serializes correctly; no timezone field |
| `calendar::model::test_event_time_datetime` | UTC normalization from Google API datetime strings |
| `calendar::db::test_upsert_and_query_time_range` | Insert 3 events; query overlapping time window; assert correct rows returned |
| `calendar::db::test_fts_search` | Insert event with known summary; FTS query returns it |
| `calendar::db::test_tombstone_delete` | Upsert event; upsert again with `status=cancelled`; assert deleted from table |
| `calendar::google::test_parse_api_response` | Snapshot of real Google API JSON → `CalendarEvent` round-trip |
| `calendar::google::test_incremental_sync_gone` | Simulate 410 response; assert full re-sync triggered |
| `calendar::ics::test_parse_vevent` | VEVENT block → `CalendarEvent` for all-day, timed, and recurring events |
| `calendar::ics::test_parse_recurrence` | RRULE + EXDATE extracted and stored in `recurrence_json` |
| `cli::calendar::test_today_json_output_shape` | subprocess CLI call (in-process or child); assert JSON fields present |
| `cli::calendar::test_search_no_results` | Empty DB; `search "foo"` returns `[]` without error |

### Integration tests

| Test | What it verifies |
|------|-----------------|
| `tests/calendar_google_sync.rs` | Record real Google API responses with `wiremock` or `httpmock`; replay in CI; assert DB state after full + incremental sync |
| `tests/calendar_ics_subscription.rs` | Serve a static ICS file via `httptest`; run `refresh`; assert events indexed |
| `tests/calendar_cli_search.rs` | Seed DB; subprocess `ripmail calendar search "standup" --json`; parse output |
| `tests/calendar_source_add_remove.rs` | `sources add --kind googleCalendar`; assert config updated; `sources remove`; assert rows purged |

### EventKit helper tests

- **Unit (Swift):** `EventKitBridgeTests` with a `MockEKEventStore` that returns fixture events; assert NDJSON output matches expected shape.
- **Rust (shipped):** `calendar::apple::tests_macos::sync_apple_calendar_stub_message` (macOS only) asserts the stub error mentions EventKit / `ripmail-eventkit` until the helper is bundled.
- **TCC (manual):** The eventual `ripmail-eventkit` bundle must ship an `Info.plist` with **`NSCalendarsUsageDescription`** (and write-only variant if Phase B writes use EventKit). After the first sync attempt, confirm **System Settings → Privacy & Security → Calendars** lists the helper (or Terminal / IDE) if you invoke `ripmail` from there.
- **Manual macOS validation (end-to-end, once helper exists):**
  1. `ripmail sources add --kind appleCalendar && ripmail refresh --source apple-cal`
  2. System permission dialog appears and is accepted.
  3. `ripmail calendar today --json` returns events from macOS Calendar.app.
  4. Create an event in Calendar.app, re-run `refresh`, assert new event appears.

### End-to-end agent validation

1. Add a Google Calendar source with a known test event (title: "OPP-053 validation event").
2. Run `ripmail calendar search "OPP-053 validation" --json`.
3. Assert `uid`, `summary`, `start`, and `attendees` fields are present and correct.
4. Add a second Google Calendar source (different `calendarId`); run `ripmail calendar search "event" --source work-gcal --json`; confirm scoping works.
5. Brain-app: ask the assistant "what's on my calendar today?" — confirm it shells out to ripmail and returns calendar data.

### Regression gates

- All existing `cargo test -p ripmail` tests remain green after schema addition (no regressions on mail/IMAP paths).
- `ripmail search "foo" --json` on a mail-only config still works (no calendar source configured).
- `ripmail sources add --kind appleCalendar` on Linux prints a clear `unsupported` error and exits non-zero.

---

## Open decisions deferred to implementation

1. **Recurring event expansion:** start with `singleEvents=true` on Google (expand on their side) for Phase A simplicity; Phase B needs master events for edits — revisit when scheduling is introduced.
2. **EventKit helper build integration:** `build.rs` invoking `swiftc` vs a separate Makefile target vs a Swift Package. Recommendation: start with a `Makefile` target (`make eventkit-helper`) to keep the Cargo workspace clean, then integrate into `build.rs` once the helper shape stabilizes.
3. **`ripmail-eventkit` binary name and distribution:** confirm whether it is a sibling binary in `$PATH` or always resolved relative to the ripmail binary path. Recommend: sibling to the ripmail binary, resolved via `std::env::current_exe()?.parent()?.join("ripmail-eventkit")`.
4. **`ripmail search` unified results:** whether `ripmail search <query>` without `--kind` returns mixed mail + calendar hits in a single stream. OPP-052 governs the search language; calendar integration should not block on it — `ripmail calendar search` is the Phase A entry point.
