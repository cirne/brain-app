//! Regression: Google calendar refresh must not overwrite `sources[].calendarIds` in
//! `config.json` with the full account calendar list returned from Google calendarList.
//!
//! Hub (and `ripmail sources edit --calendar`) store the user's **default-query subset** there.
//! Indexing already uses every discovered calendar independently; replacing `calendarIds` on
//! refresh cleared that selection after every sync.

use std::path::Path;

fn read_sync_rs() -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/calendar/sync.rs"))
        .expect("read src/calendar/sync.rs")
}

#[test]
fn calendar_sync_rs_does_not_write_config_json() {
    let src = read_sync_rs();
    assert!(
        !src.contains("write_config_json"),
        "regression: calendar sync must not mutate config.json (was wiping Hub calendarIds)",
    );
}

#[test]
fn calendar_sync_rs_must_not_assign_discovered_list_to_calendar_ids() {
    let src = read_sync_rs();
    for needle in [
        "calendar_ids = Some(discovered)",
        "calendar_ids=Some(discovered)",
    ] {
        assert!(
            !src.contains(needle),
            "regression: forbidden pattern `{needle}` — do not overwrite user's calendarIds with full Google calendarList",
        );
    }
}

#[test]
fn calendar_sync_rs_documents_calendar_ids_preservation() {
    let src = read_sync_rs();
    assert!(
        src.contains("Do not overwrite `sources[].calendarIds`"),
        "keep inline documentation of why config calendarIds must not follow sync discovery",
    );
}
