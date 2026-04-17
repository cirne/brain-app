//! Sync / search status from DB — mirrors `src/lib/status.ts`.

use rusqlite::{Connection, OptionalExtension};

use std::borrow::Cow;
use std::collections::HashMap;

use crate::config::{Config, MailboxImapAuthKind};
use crate::sync::onboarding::mailbox_needs_first_backfill;
use crate::sync::process_lock::{
    is_sync_lock_held, millis_since_sync_lock_started_at, SyncLockRow,
};
use crate::sync::sync_log_path;
use crate::sync::{connect_imap_for_resolved_mailbox, RealImapTransport, SyncImapTransport};
use crate::sync::{resolve_sync_folder_for_host, resolve_sync_mailbox};

const STATUS_LABEL_WIDTH: usize = 13;

/// Text-mode hint when sync has held the lock with zero indexed messages for longer than this.
const SYNC_INITIAL_HANG_HINT_AFTER_MS: u128 = 5 * 60 * 1000;

#[derive(Debug, Clone)]
pub struct TimeAgo {
    pub human: String,
    pub duration: String,
}

pub fn format_time_ago(iso_date: Option<&str>) -> Option<TimeAgo> {
    let iso = iso_date?;
    let date = if iso.contains('Z') || iso.contains('+') {
        chrono::DateTime::parse_from_rfc3339(iso)
            .ok()
            .map(|d| d.with_timezone(&chrono::Utc))
    } else {
        let normalized = format!("{}Z", iso.replace(' ', "T"));
        chrono::DateTime::parse_from_rfc3339(&normalized)
            .ok()
            .map(|d| d.with_timezone(&chrono::Utc))
    }?;

    let now = chrono::Utc::now();
    let ms = (now - date).num_milliseconds();
    if ms < 0 {
        return None;
    }
    let sec = ms / 1000;
    let min = sec / 60;
    let hr = min / 60;
    let day = hr / 24;
    let week = day / 7;
    let month = day / 30;
    let year = day / 365;

    let (human, duration) = if sec < 60 {
        ("just now".into(), "PT0S".into())
    } else if min < 60 {
        (
            format!(
                "{} {} ago",
                min,
                if min == 1 { "minute" } else { "minutes" }
            ),
            format!("PT{min}M"),
        )
    } else if hr < 24 {
        (
            format!("{} {} ago", hr, if hr == 1 { "hour" } else { "hours" }),
            format!("PT{hr}H"),
        )
    } else if day < 7 {
        (
            format!("{} {} ago", day, if day == 1 { "day" } else { "days" }),
            format!("P{day}D"),
        )
    } else if week < 4 {
        (
            format!("{} {} ago", week, if week == 1 { "week" } else { "weeks" }),
            format!("P{week}W"),
        )
    } else if month < 12 {
        (
            format!(
                "{} {} ago",
                month,
                if month == 1 { "month" } else { "months" }
            ),
            format!("P{}D", month * 30),
        )
    } else {
        (
            format!("{} {} ago", year, if year == 1 { "year" } else { "years" }),
            format!("P{year}Y"),
        )
    };

    Some(TimeAgo { human, duration })
}

#[derive(Debug, Clone)]
pub struct SyncStatus {
    pub is_running: bool,
    pub last_sync_at: Option<String>,
    pub total_messages: i64,
    pub earliest_synced_date: Option<String>,
    pub latest_synced_date: Option<String>,
    pub target_start_date: Option<String>,
    pub sync_start_earliest_date: Option<String>,
    /// PID recorded in `sync_summary` when `is_running` (may be stale if the process exited).
    pub owner_pid: Option<i64>,
    /// When the current sync lock was taken (`sync_summary.sync_lock_started_at`).
    pub sync_lock_started_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StatusData {
    pub sync: SyncStatus,
    pub fts_ready: i64,
    /// True when the DB lock row matches a live process and is not expired (see `process_lock`).
    pub sync_lock_held_by_live_process: bool,
    /// Age of the current lock in milliseconds, or `None` if unknown.
    pub sync_lock_age_ms: Option<u128>,
}

/// JSON shape for [`MailboxStatusLine::latest_mail_ago`].
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessAgoJson {
    pub human: String,
    pub duration: String,
}

impl From<TimeAgo> for FreshnessAgoJson {
    fn from(t: TimeAgo) -> Self {
        Self {
            human: t.human,
            duration: t.duration,
        }
    }
}

/// Per-mailbox row for `ripmail status` ([OPP-016](../docs/opportunities/archive/OPP-016-multi-inbox.md)).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxStatusLine {
    pub mailbox_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub message_count: i64,
    pub last_uid: Option<i64>,
    /// True when this mailbox has credentials but no indexed messages yet (first `refresh` will backfill).
    pub needs_backfill: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub earliest_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_mail_ago: Option<FreshnessAgoJson>,
}

fn query_mailbox_date_range(
    conn: &Connection,
    mailbox_id: &str,
) -> Result<Option<(String, String)>, rusqlite::Error> {
    conn.query_row(
        "SELECT MIN(date), MAX(date) FROM messages WHERE source_id = ?1",
        [mailbox_id],
        |row| {
            let earliest: Option<String> = row.get(0)?;
            let latest: Option<String> = row.get(1)?;
            Ok(earliest.zip(latest))
        },
    )
}

fn date_fields_from_range(
    range: Option<(String, String)>,
) -> (Option<String>, Option<String>, Option<FreshnessAgoJson>) {
    let Some((earliest, latest)) = range else {
        return (None, None, None);
    };
    let ago = format_time_ago(Some(latest.as_str())).map(FreshnessAgoJson::from);
    (Some(earliest), Some(latest), ago)
}

/// Message counts and sync checkpoint per configured mailbox.
pub fn mailbox_status_lines(
    conn: &Connection,
    cfg: &Config,
) -> Result<Vec<MailboxStatusLine>, rusqlite::Error> {
    let mut out = Vec::new();
    if cfg.resolved_mailboxes().is_empty() {
        let folder = resolve_sync_mailbox(cfg);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
        let last_uid: Option<i64> = conn
            .query_row(
                "SELECT last_uid FROM sync_state WHERE source_id = '' AND folder = ?1",
                [&folder],
                |r| r.get(0),
            )
            .optional()?;
        let range = query_mailbox_date_range(conn, "")?;
        let (earliest_date, latest_date, latest_mail_ago) = date_fields_from_range(range);
        out.push(MailboxStatusLine {
            mailbox_id: String::new(),
            email: if cfg.imap_user.trim().is_empty() {
                None
            } else {
                Some(cfg.imap_user.clone())
            },
            message_count: count,
            last_uid,
            needs_backfill: false,
            earliest_date,
            latest_date,
            latest_mail_ago,
        });
        return Ok(out);
    }
    for mb in cfg.resolved_mailboxes() {
        let folder = resolve_sync_folder_for_host(&cfg.sync_mailbox, &mb.imap_host);
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE source_id = ?1",
            [&mb.id],
            |r| r.get(0),
        )?;
        let last_uid: Option<i64> = conn
            .query_row(
                "SELECT last_uid FROM sync_state WHERE source_id = ?1 AND folder = ?2",
                [&mb.id, &folder],
                |r| r.get(0),
            )
            .optional()?;
        let needs_backfill = mailbox_needs_first_backfill(conn, mb)?;
        let range = query_mailbox_date_range(conn, &mb.id)?;
        let (earliest_date, latest_date, latest_mail_ago) = date_fields_from_range(range);
        out.push(MailboxStatusLine {
            mailbox_id: mb.id.clone(),
            email: Some(mb.email.clone()),
            message_count: count,
            last_uid,
            needs_backfill,
            earliest_date,
            latest_date,
            latest_mail_ago,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone)]
pub struct ImapStatusSide {
    pub messages: i64,
    pub uid_next: Option<u32>,
    pub uid_validity: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct ImapStatusCoverage {
    pub days_ago: i64,
    pub years_ago: String,
    pub earliest_date: String,
}

#[derive(Debug, Clone)]
pub struct ImapServerComparison {
    pub server: ImapStatusSide,
    pub local: ImapStatusSide,
    pub missing: Option<i64>,
    pub missing_uid_range: Option<(u32, u32)>,
    pub uid_validity_mismatch: bool,
    pub coverage: Option<ImapStatusCoverage>,
}

fn build_imap_server_comparison(
    fts_local_messages: i64,
    coverage_earliest: Option<&str>,
    server_messages: Option<u32>,
    server_uid_next: Option<u32>,
    server_uid_validity: Option<u32>,
    local_last_uid: Option<u32>,
    local_uid_validity: Option<u32>,
) -> ImapServerComparison {
    let uid_validity_mismatch = match (server_uid_validity, local_uid_validity) {
        (Some(server), Some(local)) => server != local,
        _ => false,
    };

    let (missing, missing_uid_range) = match (server_uid_next, local_last_uid) {
        (Some(server_next), Some(local_last))
            if !uid_validity_mismatch && server_next > local_last =>
        {
            let count = i64::from(server_next) - i64::from(local_last) - 1;
            if count > 0 {
                (Some(count), Some((local_last + 1, server_next - 1)))
            } else {
                (Some(0), None)
            }
        }
        _ => (None, None),
    };

    let coverage = coverage_earliest.and_then(|earliest| {
        let date = if earliest.contains('Z') || earliest.contains('+') {
            chrono::DateTime::parse_from_rfc3339(earliest)
                .ok()
                .map(|d| d.with_timezone(&chrono::Utc))
        } else {
            let normalized = format!("{}Z", earliest.replace(' ', "T"));
            chrono::DateTime::parse_from_rfc3339(&normalized)
                .ok()
                .map(|d| d.with_timezone(&chrono::Utc))
        }?;
        let days_ago = (chrono::Utc::now() - date).num_days().max(0);
        Some(ImapStatusCoverage {
            days_ago,
            years_ago: format!("{:.1}", days_ago as f64 / 365.0),
            earliest_date: earliest[..earliest.len().min(10)].to_string(),
        })
    });

    ImapServerComparison {
        server: ImapStatusSide {
            messages: server_messages.unwrap_or(0) as i64,
            uid_next: server_uid_next,
            uid_validity: server_uid_validity,
        },
        local: ImapStatusSide {
            messages: fts_local_messages,
            uid_next: local_last_uid,
            uid_validity: local_uid_validity,
        },
        missing,
        missing_uid_range,
        uid_validity_mismatch,
        coverage,
    }
}

type SyncSummaryRow = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
    Option<String>,
    i64,
    Option<i64>,
    Option<String>,
);

pub fn get_status(conn: &Connection) -> Result<StatusData, rusqlite::Error> {
    let sync_row: Option<SyncSummaryRow> = conn
        .query_row(
            "SELECT earliest_synced_date, latest_synced_date, target_start_date, sync_start_earliest_date,
                    total_messages, last_sync_at, is_running, owner_pid, sync_lock_started_at
             FROM sync_summary WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            },
        )
        .optional()?;

    let messages_count: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;

    let sync = if let Some((
        earliest_synced_date,
        latest_synced_date,
        target_start_date,
        sync_start_earliest_date,
        total_messages,
        last_sync_at,
        is_running,
        owner_pid,
        sync_lock_started_at,
    )) = sync_row
    {
        let total_messages: i64 = total_messages;
        SyncStatus {
            is_running: is_running != 0,
            last_sync_at,
            total_messages: total_messages.max(messages_count),
            earliest_synced_date,
            latest_synced_date,
            target_start_date,
            sync_start_earliest_date,
            owner_pid,
            sync_lock_started_at,
        }
    } else {
        SyncStatus {
            is_running: false,
            last_sync_at: None,
            total_messages: messages_count,
            earliest_synced_date: None,
            latest_synced_date: None,
            target_start_date: None,
            sync_start_earliest_date: None,
            owner_pid: None,
            sync_lock_started_at: None,
        }
    };

    let lock_row = SyncLockRow {
        is_running: if sync.is_running { 1 } else { 0 },
        owner_pid: sync.owner_pid,
        sync_lock_started_at: sync.sync_lock_started_at.clone(),
    };
    let sync_lock_held_by_live_process = is_sync_lock_held(Some(&lock_row));
    let sync_lock_age_ms = millis_since_sync_lock_started_at(sync.sync_lock_started_at.as_deref());

    Ok(StatusData {
        sync,
        fts_ready: messages_count,
        sync_lock_held_by_live_process,
        sync_lock_age_ms,
    })
}

/// DB says sync is running, but no live process holds the lock (crash, kill, or expired lock).
pub fn status_stale_lock_running(status: &StatusData) -> bool {
    status.sync.is_running && !status.sync_lock_held_by_live_process
}

/// Live sync, zero indexed messages, lock age over five minutes.
pub fn status_initial_sync_hang_suspected(status: &StatusData) -> bool {
    status.sync_lock_held_by_live_process
        && status.sync.is_running
        && status.fts_ready == 0
        && status
            .sync_lock_age_ms
            .map(|m| m > SYNC_INITIAL_HANG_HINT_AFTER_MS)
            .unwrap_or(false)
}

pub fn get_imap_server_status(
    conn: &Connection,
    cfg: &Config,
) -> Result<Option<ImapServerComparison>, String> {
    if cfg.imap_user.trim().is_empty() {
        return Ok(None);
    }
    let mb = match cfg.resolved_mailboxes().first() {
        Some(m) => m,
        None => return Ok(None),
    };
    if mb.imap_auth == MailboxImapAuthKind::AppPassword && mb.imap_password.trim().is_empty() {
        return Ok(None);
    }
    if mb.imap_auth == MailboxImapAuthKind::GoogleOAuth
        && !crate::oauth::google_oauth_credentials_present(&cfg.ripmail_home, &mb.id)
    {
        return Ok(None);
    }

    let env_file = crate::config::read_ripmail_env_file(&cfg.ripmail_home);
    let process_env: HashMap<String, String> = std::env::vars().collect();
    let mut session =
        connect_imap_for_resolved_mailbox(&cfg.ripmail_home, mb, &env_file, &process_env)
            .map_err(|e| e.to_string())?;
    let mut transport = RealImapTransport {
        session: &mut session,
    };
    // Must match sync (`resolve_sync_mailbox`): empty `sync.mailbox` + Gmail → `[Gmail]/All Mail`, etc.
    let imap_folder = resolve_sync_mailbox(cfg);
    let server_status = transport
        .mailbox_status(&imap_folder)
        .map_err(|e| e.to_string())?;

    let sync_state: Option<(Option<i64>, Option<i64>)> = conn
        .query_row(
            "SELECT uidvalidity, last_uid FROM sync_state WHERE folder = ?1 AND source_id = ?2",
            [&imap_folder, &cfg.source_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let local_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE source_id = ?1",
            [&cfg.source_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mb_date_range =
        query_mailbox_date_range(conn, &cfg.source_id).map_err(|e| e.to_string())?;
    let coverage_earliest = mb_date_range.as_ref().map(|(e, _)| e.as_str());

    let local_uid_validity = sync_state.and_then(|(uidvalidity, _)| uidvalidity.map(|v| v as u32));
    let local_last_uid = sync_state.and_then(|(_, last_uid)| last_uid.map(|v| v as u32));
    let _ = session.logout();

    Ok(Some(build_imap_server_comparison(
        local_count,
        coverage_earliest,
        server_status.messages,
        server_status.uid_next,
        server_status.uid_validity,
        local_last_uid,
        local_uid_validity,
    )))
}

fn progress_suffix(status: &StatusData) -> String {
    let Some(ref target) = status.sync.target_start_date else {
        return String::new();
    };
    let Some(ref start_earliest) = status.sync.sync_start_earliest_date else {
        return String::new();
    };
    let Some(ref current_earliest) = status.sync.earliest_synced_date else {
        return String::new();
    };

    let parse_day = |s: &str| -> Option<chrono::NaiveDate> {
        chrono::NaiveDate::parse_from_str(&s[..s.len().min(10)], "%Y-%m-%d").ok()
    };

    let Some(target_date) = parse_day(target) else {
        return String::new();
    };
    let Some(start_earliest_date) = parse_day(start_earliest) else {
        return String::new();
    };
    let Some(current_earliest_date) = parse_day(current_earliest) else {
        return String::new();
    };

    if current_earliest_date <= target_date {
        return " (100% complete)".into();
    }
    if current_earliest_date >= start_earliest_date {
        return String::new();
    }

    let sync_start_point = start_earliest_date.max(target_date);
    let total_range_days = (sync_start_point - target_date).num_days().max(0);
    let progress_range_days = (sync_start_point - current_earliest_date).num_days().max(0);

    if total_range_days > 0 {
        let progress = ((progress_range_days as f64 / total_range_days as f64) * 100.0)
            .round()
            .clamp(0.0, 100.0) as i64;
        format!(" ({progress}% complete)")
    } else if start_earliest_date <= target_date {
        " (100% complete)".into()
    } else {
        String::new()
    }
}

/// Extra text for `Sync:` when a run is active (`is_running`), so "running" is not confused with idle.
fn sync_running_explanation(fts_ready: i64) -> Cow<'static, str> {
    if fts_ready == 0 {
        Cow::Borrowed(" (setting up — first messages not indexed yet)")
    } else {
        Cow::Owned(format!(
            " (in progress — {} message{} indexed)",
            fts_ready,
            if fts_ready == 1 { "" } else { "s" }
        ))
    }
}

/// Human-readable status lines (text mode).
pub fn print_status_text(conn: &Connection, cfg: &Config) -> Result<(), rusqlite::Error> {
    let status = get_status(conn)?;
    let progress_text = progress_suffix(&status);
    let pad = |s: &str| format!("{s:<STATUS_LABEL_WIDTH$}");
    let stale = status_stale_lock_running(&status);
    let hang = status_initial_sync_hang_suspected(&status);

    if stale {
        println!(
            "{}stale (DB shows running, but no live sync process holds the lock)",
            pad("Sync:")
        );
    } else if status.sync.is_running && status.sync_lock_held_by_live_process {
        let detail = sync_running_explanation(status.fts_ready);
        println!(
            "{}running{}{}",
            pad("Sync:"),
            progress_text,
            detail.as_ref()
        );
    } else if let Some(ref last) = status.sync.last_sync_at {
        let short = if last.len() >= 10 {
            &last[..10]
        } else {
            last.as_str()
        };
        println!(
            "{}idle (last: {}, {} messages){}",
            pad("Sync:"),
            short,
            status.sync.total_messages,
            progress_text
        );
    } else {
        println!("{}never run", pad("Sync:"));
    }

    if status.sync.is_running && status.sync_lock_held_by_live_process && status.fts_ready == 0 {
        println!(
            "{}FTS ready (0) — first index pending (UID search / batch in progress)",
            pad("Search:")
        );
    } else {
        println!("{}FTS ready ({})", pad("Search:"), status.fts_ready);
    }

    let mbs = mailbox_status_lines(conn, cfg)?;
    println!();
    let ind = "  ";
    let p = |s: &str| format!("{s:<STATUS_LABEL_WIDTH$}");
    for m in &mbs {
        let title = m
            .email
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                if cfg.imap_user.trim().is_empty() {
                    None
                } else {
                    Some(cfg.imap_user.as_str())
                }
            })
            .unwrap_or("Mailbox");
        println!("{title}:");
        if !m.mailbox_id.is_empty() {
            println!("{ind}{} {}", p("id:"), m.mailbox_id);
        }
        if let (Some(earliest), Some(latest)) = (m.earliest_date.as_ref(), m.latest_date.as_ref()) {
            println!(
                "{ind}{}{} .. {}",
                p("Range:"),
                &earliest[..earliest.len().min(10)],
                &latest[..latest.len().min(10)]
            );
            println!("{ind}{}{}", p("Earliest:"), earliest);
            println!("{ind}{}{}", p("Latest:"), latest);
        }
        if let Some(ref latest) = m.latest_date {
            if let Some(ago) = format_time_ago(Some(latest.as_str())) {
                println!("{ind}{}{} ({})", p("Newest mail:"), ago.human, ago.duration);
            }
        }
        let uid = m
            .last_uid
            .map(|u| u.to_string())
            .unwrap_or_else(|| "—".into());
        println!(
            "{ind}{} {} · last_uid {}",
            p("Messages:"),
            m.message_count,
            uid
        );
        println!();
    }

    let last_sync_ago = if status.sync.is_running && status.sync_lock_held_by_live_process {
        None
    } else {
        format_time_ago(status.sync.last_sync_at.as_deref())
    };
    if let Some(ago) = last_sync_ago {
        println!("{}{} ({})", pad("Last sync:"), ago.human, ago.duration);
    }

    if stale {
        println!();
        println!(
            "Hint: run `ripmail refresh` (or `ripmail refresh --since {}`) to recover; the next run will take over the lock.",
            cfg.sync_default_since
        );
    } else if hang {
        println!();
        let log_path = sync_log_path(&cfg.ripmail_home);
        let log = log_path.display();
        let pid = status
            .sync
            .owner_pid
            .map(|p| p.to_string())
            .unwrap_or_else(|| "?".into());
        println!(
            "Hint: sync has been running over 5 minutes with no messages indexed yet. Large mailboxes can spend a long time in UID search; if nothing changes, check `{log}` (e.g. `tail -f`). To force-retry: `kill {pid}` then `ripmail refresh --foreground --since {}`.",
            cfg.sync_default_since
        );
    }

    let backfill: Vec<&str> = mbs
        .iter()
        .filter(|m| m.needs_backfill)
        .filter_map(|m| m.email.as_deref().or(Some(m.mailbox_id.as_str())))
        .take(8)
        .collect();
    if !status.sync.is_running && !backfill.is_empty() {
        println!();
        println!(
            "Hint: first sync pending for {} — run `ripmail refresh` (or `ripmail refresh --since {}`).",
            backfill.join(", "),
            cfg.sync_default_since
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_sync_status() -> SyncStatus {
        SyncStatus {
            is_running: false,
            last_sync_at: None,
            total_messages: 0,
            earliest_synced_date: None,
            latest_synced_date: None,
            target_start_date: None,
            sync_start_earliest_date: None,
            owner_pid: None,
            sync_lock_started_at: None,
        }
    }

    #[test]
    fn status_stale_when_db_running_without_live_lock() {
        let mut sync = test_sync_status();
        sync.is_running = true;
        let s = StatusData {
            sync,
            fts_ready: 0,
            sync_lock_held_by_live_process: false,
            sync_lock_age_ms: Some(0),
        };
        assert!(status_stale_lock_running(&s));
    }

    #[test]
    fn status_not_stale_when_lock_held() {
        let mut sync = test_sync_status();
        sync.is_running = true;
        let s = StatusData {
            sync,
            fts_ready: 0,
            sync_lock_held_by_live_process: true,
            sync_lock_age_ms: Some(0),
        };
        assert!(!status_stale_lock_running(&s));
    }

    #[test]
    fn hang_suspected_when_lock_age_over_five_minutes_and_zero_fts() {
        let mut sync = test_sync_status();
        sync.is_running = true;
        let s = StatusData {
            sync,
            fts_ready: 0,
            sync_lock_held_by_live_process: true,
            sync_lock_age_ms: Some(5 * 60 * 1000 + 1),
        };
        assert!(status_initial_sync_hang_suspected(&s));
    }

    #[test]
    fn hang_not_suspected_at_exactly_five_minutes() {
        let mut sync = test_sync_status();
        sync.is_running = true;
        let s = StatusData {
            sync,
            fts_ready: 0,
            sync_lock_held_by_live_process: true,
            sync_lock_age_ms: Some(5 * 60 * 1000),
        };
        assert!(!status_initial_sync_hang_suspected(&s));
    }

    #[test]
    fn sync_running_explanation_setup_vs_in_progress() {
        assert!(sync_running_explanation(0).as_ref().contains("setting up"));
        assert!(sync_running_explanation(1)
            .as_ref()
            .contains("1 message indexed"));
        assert!(sync_running_explanation(600)
            .as_ref()
            .contains("600 messages indexed"));
    }

    #[test]
    fn imap_comparison_reports_missing_range() {
        let comparison = build_imap_server_comparison(
            25,
            Some("2024-01-01T00:00:00Z"),
            Some(30),
            Some(15),
            Some(42),
            Some(9),
            Some(42),
        );
        assert_eq!(comparison.missing, Some(5));
        assert_eq!(comparison.missing_uid_range, Some((10, 14)));
        assert!(!comparison.uid_validity_mismatch);
        assert_eq!(comparison.local.messages, 25);
        assert_eq!(comparison.server.messages, 30);
    }

    #[test]
    fn imap_comparison_stops_missing_when_uidvalidity_differs() {
        let comparison =
            build_imap_server_comparison(10, None, Some(10), Some(20), Some(2), Some(5), Some(1));
        assert!(comparison.uid_validity_mismatch);
        assert_eq!(comparison.missing, None);
        assert_eq!(comparison.missing_uid_range, None);
    }

    #[test]
    fn total_messages_reflects_live_count_during_sync() {
        use crate::db::open_memory;

        let conn = open_memory().unwrap();

        let status = get_status(&conn).unwrap();
        assert_eq!(status.sync.total_messages, 0);
        assert_eq!(status.fts_ready, 0);

        for i in 0..3 {
            conn.execute(
                "INSERT INTO messages (message_id, thread_id, folder, uid, from_address, date, raw_path)
                 VALUES (?1, 'th1', 'INBOX', ?2, 'a@b.com', '2025-01-01', '/tmp/x')",
                rusqlite::params![format!("msg-{i}"), i + 1],
            )
            .unwrap();
        }

        // sync_summary.total_messages is still 0 (no sync has completed)
        let cached: i64 = conn
            .query_row(
                "SELECT total_messages FROM sync_summary WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cached, 0);

        let status = get_status(&conn).unwrap();
        assert_eq!(status.sync.total_messages, 3, "should use live COUNT(*)");
        assert_eq!(status.fts_ready, 3);
    }
}
