//! Apple Calendar via read-only SQLite (`Calendar.sqlitedb`), same idea as Apple Mail envelope index.

use std::collections::HashMap;
use std::path::Path;
#[cfg(target_os = "macos")]
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

#[cfg(target_os = "macos")]
use super::apple_sqlite::{
    apple_calendar_db_path, open_apple_calendar_readonly, read_apple_calendar_events,
    read_apple_calendar_name_map,
};
#[cfg(target_os = "macos")]
use super::db::{self, upsert_event};

/// Whether `appleCalendar` sources are synced in this build (macOS only; reads local Calendar DB).
pub fn apple_calendar_sync_available() -> bool {
    cfg!(target_os = "macos")
}

pub fn sync_apple_calendar(
    conn: &mut Connection,
    _home: &Path,
    source_id: &str,
    _env_file: &HashMap<String, String>,
    _process_env: &HashMap<String, String>,
) -> Result<u32, Box<dyn std::error::Error>> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = conn;
        let _ = source_id;
        return Err("appleCalendar sources are only supported on macOS.".into());
    }

    #[cfg(target_os = "macos")]
    {
        let Some(path) = apple_calendar_db_path() else {
            return Err("appleCalendar: could not resolve home directory.".into());
        };
        if !path.is_file() {
            return Err(format!(
                "Apple Calendar database not found at:\n  {}\n\n\
                 Open Calendar.app at least once, or check Full Disk Access for this terminal app:\n\
                 System Settings → Privacy & Security → Full Disk Access.",
                path.display()
            )
            .into());
        }

        let apple = open_apple_calendar_readonly(&path).map_err(|e| {
            format!(
                "appleCalendar: could not open Calendar database read-only at:\n  {}\n\n\
                 Grant Full Disk Access to this terminal app (Terminal, iTerm, Cursor, …):\n\
                 System Settings → Privacy & Security → Full Disk Access.\n\
                 Underlying error: {e}",
                path.display()
            )
        })?;

        let cal_names = read_apple_calendar_name_map(&apple).unwrap_or_default();
        if !cal_names.is_empty() {
            let dir = _home.join(source_id);
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(json) = serde_json::to_string_pretty(&cal_names) {
                let _ = std::fs::write(dir.join("calendar-names.json"), json);
            }
        }

        let rows = read_apple_calendar_events(&apple, source_id, "appleCalendar")?;
        let synced_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let tx = conn.transaction()?;
        db::delete_source_events(&tx, source_id)?;
        let mut n = 0u32;
        for mut row in rows {
            row.synced_at = Some(synced_at);
            upsert_event(&tx, &row)?;
            n += 1;
        }
        tx.commit()?;
        Ok(n)
    }
}
