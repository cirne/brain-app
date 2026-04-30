//! Local calendar indexing (Google, ICS, Apple Calendar SQLite) — [OPP-053](https://github.com/cirne/zmail).

pub mod apple;
pub mod apple_sqlite;
pub use apple::apple_calendar_sync_available;
pub mod db;
pub mod google;
pub use google::{
    build_google_calendar_event_insert_body, build_google_calendar_event_patch_body,
    build_recurrence_json_array, delete_google_calendar_event, fetch_google_calendar_names_api,
    finalize_rrule_with_count_until, get_google_calendar_event, google_calendar_cancel_future,
    infer_google_recurring_master_event_id, insert_google_calendar_event,
    patch_google_calendar_event_json, InsertGoogleEventArgs, RecurrenceArgs,
};
pub mod ics;
mod model;
pub mod sync;

pub use db::{
    calendar_event_json_matches_scope, count_events_for_source, fetch_event_json_by_rowid,
    fetch_event_json_by_uid, list_events_in_range, list_events_overlapping,
    list_events_overlapping_scoped, search_calendar_events_with_scope, search_events_fts,
    CalendarQueryScope,
};
pub use sync::run_calendar_sync;
