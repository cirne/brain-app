//! Apple Calendar via EventKit helper (macOS). Stub returns a clear error until `ripmail-eventkit` ships.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::Connection;

/// Whether Calendar.app / EventKit indexing is implemented in this build.
/// When `false`, `ripmail refresh` **skips** `appleCalendar` sources so mail and other calendars still sync.
/// Turn this on together with a real [`sync_apple_calendar`] implementation.
pub fn apple_calendar_sync_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

pub fn sync_apple_calendar(
    _conn: &mut Connection,
    _home: &Path,
    _source_id: &str,
    _env_file: &HashMap<String, String>,
    _process_env: &HashMap<String, String>,
) -> Result<u32, Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    {
        Err(
            "appleCalendar: EventKit helper (ripmail-eventkit) is not bundled in this build yet. \
             Use icsSubscription / icsFile or googleCalendar for now."
                .into(),
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("appleCalendar sources are only supported on macOS.".into())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests_macos {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn sync_apple_calendar_stub_message() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        let home = std::path::Path::new(".");
        let env = HashMap::new();
        let err = sync_apple_calendar(&mut conn, home, "apple-test", &env, &env).unwrap_err();
        let s = err.to_string();
        assert!(
            s.contains("EventKit") || s.contains("ripmail-eventkit"),
            "unexpected stub error: {s}"
        );
    }
}
