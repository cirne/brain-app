//! Local calendar indexing (Google, ICS; Apple EventKit planned) — [OPP-053](https://github.com/cirne/zmail).

pub mod apple;
pub use apple::apple_calendar_sync_available;
pub mod db;
pub mod google;
pub mod ics;
mod model;
pub mod sync;

pub use db::{
    count_events_for_source, fetch_event_json_by_rowid, fetch_event_json_by_uid,
    list_events_in_range, list_events_overlapping, search_events_fts,
};
pub use sync::run_calendar_sync;
