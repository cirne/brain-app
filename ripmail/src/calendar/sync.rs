//! Orchestrate calendar refresh for a [`ResolvedMailbox`](crate::config::ResolvedMailbox).

use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use rusqlite::Connection;

use crate::config::{
    load_config_json, write_config_json, CalendarSourceResolved, ResolvedMailbox, SourceKind,
};
use crate::sync::run::SyncResult;
use crate::sync::sync_log::SyncFileLogger;

use super::apple::sync_apple_calendar;
use super::db::{self, upsert_event, upsert_source_registry};
use super::google::sync_google_calendars;
use super::ics::parse_ics_to_rows;

pub fn run_calendar_sync(
    conn: &mut Connection,
    home: &Path,
    mb: &ResolvedMailbox,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
    logger: &SyncFileLogger,
    progress_stderr: bool,
) -> Result<SyncResult, Box<dyn std::error::Error>> {
    let started = Instant::now();
    let Some(cal) = mb.calendar.as_ref() else {
        return Err("run_calendar_sync: not a calendar source".into());
    };

    let kind_str = match mb.kind {
        SourceKind::GoogleCalendar => "googleCalendar",
        SourceKind::AppleCalendar => "appleCalendar",
        SourceKind::IcsSubscription => "icsSubscription",
        SourceKind::IcsFile => "icsFile",
        _ => return Err("run_calendar_sync: unexpected source kind".into()),
    };

    logger.info(
        &format!(
            "Calendar sync starting (source_id={} kind={} email={})",
            mb.id,
            kind_str,
            mb.email.trim()
        ),
        None,
    );

    let log_path = logger.log_path().display().to_string();

    let mut sync_body = || -> Result<u32, Box<dyn std::error::Error>> {
        let n = match cal {
            CalendarSourceResolved::Google {
                calendar_ids,
                token_mailbox_id,
                ..
            } => {
                let (n, discovered, cal_names) = sync_google_calendars(
                    conn,
                    home,
                    &mb.id,
                    calendar_ids,
                    token_mailbox_id,
                    env_file,
                    process_env,
                )?;
                if !discovered.is_empty() && discovered != *calendar_ids {
                    let mut cfg_json = load_config_json(home);
                    if let Some(sources) = cfg_json.sources.as_mut() {
                        if let Some(idx) = sources.iter().position(|s| s.id == mb.id) {
                            sources[idx].calendar_ids = Some(discovered);
                            let _ = write_config_json(home, &cfg_json);
                        }
                    }
                }
                if !cal_names.is_empty() {
                    let dir = home.join(&mb.id);
                    let _ = std::fs::create_dir_all(&dir);
                    if let Ok(json) = serde_json::to_string_pretty(&cal_names) {
                        let _ = std::fs::write(dir.join("calendar-names.json"), json);
                    }
                }
                n
            }
            CalendarSourceResolved::Apple => {
                sync_apple_calendar(conn, home, &mb.id, env_file, process_env)?
            }
            CalendarSourceResolved::IcsUrl { url } => {
                sync_ics_url(conn, home, &mb.id, kind_str, url)?
            }
            CalendarSourceResolved::IcsPath { path } => {
                sync_ics_file(conn, &mb.id, kind_str, path.as_path())?
            }
        };

        let doc_count = db::count_events_for_source(conn, &mb.id)? as i64;
        upsert_source_registry(conn, &mb.id, kind_str, mb.include_in_default, doc_count)?;
        Ok(n)
    };

    match sync_body() {
        Ok(n) => {
            if progress_stderr {
                eprintln!(
                    "ripmail: calendar source {} synced ({} event row(s)).",
                    mb.id, n
                );
            }

            let duration_ms = started.elapsed().as_millis() as u64;
            logger.info(
                &format!(
                    "Calendar sync finished (source_id={} kind={} events_written={} duration_ms={})",
                    mb.id, kind_str, n, duration_ms
                ),
                None,
            );

            Ok(SyncResult {
                synced: n,
                messages_fetched: n,
                bytes_downloaded: 0,
                duration_ms,
                bandwidth_bytes_per_sec: 0.0,
                messages_per_minute: 0.0,
                log_path,
                early_exit: None,
                new_message_ids: None,
                mailboxes: None,
            })
        }
        Err(e) => {
            logger.error(
                &format!(
                    "Calendar sync failed (source_id={} kind={})",
                    mb.id, kind_str
                ),
                Some(&e.to_string()),
            );
            Err(e)
        }
    }
}

fn sync_ics_file(
    conn: &mut Connection,
    source_id: &str,
    source_kind: &str,
    path: &std::path::Path,
) -> Result<u32, Box<dyn std::error::Error>> {
    let raw = std::fs::read_to_string(path)?;
    apply_ics_rows(
        conn,
        source_id,
        source_kind,
        path.to_string_lossy().as_ref(),
        &raw,
    )
}

fn sync_ics_url(
    conn: &mut Connection,
    _home: &Path,
    source_id: &str,
    source_kind: &str,
    url: &str,
) -> Result<u32, Box<dyn std::error::Error>> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(60))
        .call()?;
    if !(200..300).contains(&resp.status()) {
        return Err(format!("ICS fetch HTTP {}", resp.status()).into());
    }
    let raw = resp.into_string()?;
    apply_ics_rows(conn, source_id, source_kind, url, &raw)
}

fn apply_ics_rows(
    conn: &mut Connection,
    source_id: &str,
    source_kind: &str,
    calendar_id: &str,
    raw: &str,
) -> Result<u32, Box<dyn std::error::Error>> {
    let tx = conn.transaction()?;
    db::delete_source_events(&tx, source_id)?;
    let rows = parse_ics_to_rows(raw, source_id, source_kind, calendar_id);
    let mut n = 0u32;
    for mut row in rows {
        row.synced_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        );
        upsert_event(&tx, &row)?;
        n += 1;
    }
    tx.commit()?;
    Ok(n)
}
