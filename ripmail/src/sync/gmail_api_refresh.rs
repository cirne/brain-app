//! Gmail REST incremental refresh (`history.list` + `messages.get`) for OAuth Gmail mailboxes.
//! See `docs/opportunities/archive/OPP-097-gmail-rest-api-incremental-refresh.md`.

use std::collections::HashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::config::MailboxImapAuthKind;
use crate::db::message_persist::{persist_attachments_from_parsed, persist_message};
use crate::oauth::ensure_google_access_token;
use crate::send::gmail_api_send::should_send_via_gmail_api;
use crate::sync::parse_raw_message;
use crate::sync::process_lock::{release_lock, SyncKind};
use crate::sync::sync_log::SyncFileLogger;
use crate::sync::write_maildir_message;
use crate::sync::SyncDirection;
use crate::sync::SyncOptions;
use crate::sync::SyncResult;

/// OAuth client context for Gmail API refresh (`None` disables the fast path).
#[derive(Clone)]
pub struct GmailApiRefreshContext {
    pub home: PathBuf,
    pub env_file: HashMap<String, String>,
    pub process_env: HashMap<String, String>,
    pub imap_host: String,
    pub imap_auth: MailboxImapAuthKind,
}

#[derive(Debug)]
pub enum GmailApiAttempt {
    /// API path not applicable — caller continues with IMAP (lock held).
    Skipped,
    /// History unavailable / HTTP error — caller continues with IMAP (lock held).
    Fallback,
    /// Incremental sync finished — lock released, metrics logged.
    Completed(SyncResult),
}

fn maildir_basename(uid: u32, message_id: &str) -> String {
    let safe: String = message_id
        .chars()
        .map(|c| match c {
            '<' | '>' | '"' | '\\' | '/' => '_',
            c => c,
        })
        .take(80)
        .collect();
    let safe = if safe.is_empty() { "msg".into() } else { safe };
    format!("{uid}_{safe}")
}

fn label_excluded(labels: &[String], exclude_lower: &HashSet<String>) -> bool {
    labels
        .iter()
        .any(|l| exclude_lower.contains(&l.to_ascii_lowercase()))
}

/// Map Gmail REST `labelIds` into strings compatible with existing inbox/category helpers.
pub(crate) fn gmail_label_ids_to_strings(ids: &[String]) -> Vec<String> {
    ids.iter().filter_map(|id| map_label_id(id)).collect()
}

fn map_label_id(id: &str) -> Option<String> {
    match id {
        "INBOX" => Some("\\Inbox".to_string()),
        "SENT" => Some("\\Sent".to_string()),
        "DRAFT" => Some("\\Draft".to_string()),
        "TRASH" => Some("\\Trash".to_string()),
        "SPAM" => Some("\\Spam".to_string()),
        "STARRED" => Some("\\Flagged".to_string()),
        "IMPORTANT" => Some("\\Important".to_string()),
        "CHAT" => Some("\\Chat".to_string()),
        "CATEGORY_PERSONAL" => Some("\\Important".to_string()),
        "CATEGORY_SOCIAL" => Some("Social".to_string()),
        "CATEGORY_PROMOTIONS" => Some("Promotions".to_string()),
        "CATEGORY_UPDATES" => Some("Updates".to_string()),
        "CATEGORY_FORUMS" => Some("Forums".to_string()),
        other => Some(other.to_string()),
    }
}

fn decode_gmail_web_base64(raw_b64: &str) -> Result<Vec<u8>, String> {
    let mut s = raw_b64.replace('-', "+").replace('_', "/");
    while !s.len().is_multiple_of(4) {
        s.push('=');
    }
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .map_err(|e| format!("base64 decode RFC822: {e}"))
}

/// `history.list` / profile / METADATA — bounded so a stuck TCP write cannot freeze refresh indefinitely.
const GMAIL_API_HTTP_TIMEOUT_HISTORY: Duration = Duration::from_secs(120);
/// Large `messages.get` RFC822 payloads.
const GMAIL_API_HTTP_TIMEOUT_MESSAGE_RAW: Duration = Duration::from_secs(300);

fn http_get_json(
    token: &str,
    url: &str,
    timeout: Duration,
    _span_operation: &'static str,
) -> Result<(u16, String), String> {
    let resp = ureq::get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(timeout)
        .call()
        .map_err(|e| format!("Gmail API GET {url}: {e}"))?;
    let status = resp.status();
    let text = resp
        .into_string()
        .map_err(|e| format!("Gmail API read body: {e}"))?;
    Ok((status, text))
}

fn extract_history_message_ids(body: &str) -> Result<(Vec<String>, Option<String>), String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("history JSON: {e}"))?;
    let mut ids = Vec::new();
    if let Some(arr) = v.get("history").and_then(|x| x.as_array()) {
        for h in arr {
            if let Some(added) = h.get("messagesAdded").and_then(|x| x.as_array()) {
                for m in added {
                    if let Some(id) = m
                        .get("message")
                        .and_then(|x| x.get("id"))
                        .and_then(|x| x.as_str())
                    {
                        ids.push(id.to_string());
                    }
                }
            }
        }
    }
    ids.sort_unstable();
    ids.dedup();
    let hid = v
        .get("historyId")
        .and_then(|x| x.as_str())
        .map(std::string::ToString::to_string);
    Ok((ids, hid))
}

fn history_list_url(start_history_id: &str, page_token: Option<&str>) -> String {
    let mut url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId={}&historyTypes=MESSAGE_ADDED",
        urlencoding::encode(start_history_id)
    );
    if let Some(pt) = page_token {
        if !pt.is_empty() {
            url.push_str("&pageToken=");
            url.push_str(&urlencoding::encode(pt));
        }
    }
    url
}

fn fetch_raw_message(token: &str, message_id: &str) -> Result<Vec<u8>, String> {
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=RAW",
        urlencoding::encode(message_id)
    );
    let (status, body) = http_get_json(
        token,
        &url,
        GMAIL_API_HTTP_TIMEOUT_MESSAGE_RAW,
        "gmail.messages.get.raw",
    )?;
    if status >= 400 {
        return Err(format!(
            "messages.get RAW HTTP {status}: {}",
            truncate_body(&body)
        ));
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| format!("message RAW JSON: {e}"))?;
    let raw_b64 = v
        .get("raw")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "missing raw field".to_string())?;
    decode_gmail_web_base64(raw_b64)
}

fn message_metadata_url(message_id: &str) -> String {
    format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=METADATA&metadataHeaders=Message-ID",
        urlencoding::encode(message_id)
    )
}

fn parse_metadata_labels_and_message_id(
    body: &str,
) -> Result<(Vec<String>, Option<String>), String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("message METADATA JSON: {e}"))?;
    let labels = v
        .get("labelIds")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(std::string::ToString::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mid = v
        .get("payload")
        .and_then(|p| p.get("headers"))
        .and_then(|h| h.as_array())
        .and_then(|headers| {
            headers.iter().find_map(|hdr| {
                let name = hdr.get("name").and_then(|x| x.as_str())?;
                if !name.eq_ignore_ascii_case("Message-ID") {
                    return None;
                }
                let val = hdr.get("value").and_then(|x| x.as_str()).map(str::trim)?;
                if val.is_empty() {
                    return None;
                }
                Some(val.to_string())
            })
        });
    Ok((labels, mid))
}

fn fetch_message_metadata(
    token: &str,
    message_id: &str,
) -> Result<(Vec<String>, Option<String>), String> {
    let url = message_metadata_url(message_id);
    let (status, body) = http_get_json(
        token,
        &url,
        GMAIL_API_HTTP_TIMEOUT_HISTORY,
        "gmail.messages.get.metadata",
    )?;
    if status >= 400 {
        return Err(format!(
            "messages.get METADATA HTTP {status}: {}",
            truncate_body(&body)
        ));
    }
    parse_metadata_labels_and_message_id(&body)
}

/// Values to try against `messages.message_id` (mail-parser often stores angle brackets).
fn message_id_lookup_candidates(header: &str) -> Vec<String> {
    let t = header.trim();
    if t.is_empty() {
        return Vec::new();
    }
    let mut out = vec![t.to_string()];
    if !t.starts_with('<') && t.contains('@') {
        out.push(format!("<{t}>"));
    }
    out
}

fn message_already_indexed(conn: &Connection, header_message_id: &str) -> rusqlite::Result<bool> {
    for cand in message_id_lookup_candidates(header_message_id) {
        let dup: Option<i32> = conn
            .query_row(
                "SELECT 1 FROM messages WHERE message_id = ?1",
                [&cand],
                |row| row.get(0),
            )
            .optional()?;
        if dup.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn truncate_body(s: &str) -> String {
    const MAX: usize = 400;
    if s.len() <= MAX {
        s.to_string()
    } else {
        format!("{}…", &s[..MAX])
    }
}

pub(crate) fn load_gmail_history_id(
    conn: &Connection,
    source_id: &str,
    folder: &str,
) -> rusqlite::Result<Option<String>> {
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT gmail_history_id FROM sync_state WHERE source_id = ?1 AND folder = ?2",
            [source_id, folder],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    Ok(row.flatten())
}

fn clear_gmail_history_id(
    conn: &mut Connection,
    source_id: &str,
    folder: &str,
) -> rusqlite::Result<()> {
    let _ = conn.execute(
        "UPDATE sync_state SET gmail_history_id = NULL WHERE source_id = ?1 AND folder = ?2",
        [source_id, folder],
    );
    Ok(())
}

fn save_gmail_history_id(
    conn: &mut Connection,
    source_id: &str,
    folder: &str,
    history_id: &str,
) -> rusqlite::Result<()> {
    let _n = conn.execute(
        "UPDATE sync_state SET gmail_history_id = ?1 WHERE source_id = ?2 AND folder = ?3",
        params![history_id, source_id, folder],
    )?;
    Ok(())
}

/// After a successful IMAP refresh for Gmail OAuth, persist `users.profile.historyId` when missing.
#[allow(clippy::too_many_arguments)]
pub fn bootstrap_gmail_history_if_missing(
    conn: &mut Connection,
    home: &Path,
    mailbox_id: &str,
    imap_folder: &str,
    imap_host: &str,
    imap_auth: MailboxImapAuthKind,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
    logger: &SyncFileLogger,
) -> Result<(), String> {
    if !should_send_via_gmail_api(imap_host, imap_auth) {
        return Ok(());
    }
    let existing =
        load_gmail_history_id(conn, mailbox_id, imap_folder).map_err(|e| e.to_string())?;
    if existing.as_ref().is_some_and(|s| !s.is_empty()) {
        return Ok(());
    }
    let row: Option<(i64, i64)> = conn
        .query_row(
            "SELECT uidvalidity, last_uid FROM sync_state WHERE source_id = ?1 AND folder = ?2",
            [mailbox_id, imap_folder],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((_uv, _lu)) = row else {
        return Ok(());
    };

    let token = ensure_google_access_token(home, mailbox_id, env_file, process_env)
        .map_err(|e| e.to_string())?;
    let (status, body) = http_get_json(
        &token,
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        GMAIL_API_HTTP_TIMEOUT_HISTORY,
        "gmail.users.profile",
    )
    .map_err(|e| e.to_string())?;
    if status >= 400 {
        logger.warn(
            "Gmail profile fetch for history bootstrap failed",
            Some(&format!("HTTP {status}: {}", truncate_body(&body))),
        );
        return Ok(());
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let hid = v
        .get("historyId")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "profile missing historyId".to_string())?;
    conn.execute(
        "UPDATE sync_state SET gmail_history_id = ?1 WHERE source_id = ?2 AND folder = ?3",
        params![hid, mailbox_id, imap_folder],
    )
    .map_err(|e| e.to_string())?;
    logger.info(
        "Gmail API historyId bootstrapped from profile",
        Some(
            &json!({
                "path": "gmail_api_bootstrap",
                "historyId": hid,
            })
            .to_string(),
        ),
    );
    Ok(())
}

/// Try Gmail partial sync after the refresh lane lock is acquired.
#[allow(clippy::too_many_arguments)]
pub fn try_gmail_api_incremental_refresh(
    conn: &mut Connection,
    logger: &SyncFileLogger,
    ctx: &GmailApiRefreshContext,
    mailbox_id: &str,
    imap_folder: &str,
    maildir_path: &Path,
    exclude_lower: &HashSet<String>,
    options: &SyncOptions,
    start: Instant,
    log_path_str: &str,
    pid: i64,
) -> Result<GmailApiAttempt, crate::sync::error::RunSyncError> {
    use crate::sync::error::RunSyncError;

    if !should_send_via_gmail_api(ctx.imap_host.as_str(), ctx.imap_auth) {
        return Ok(GmailApiAttempt::Skipped);
    }
    if options.kind != SyncKind::Refresh || options.direction != SyncDirection::Forward {
        return Ok(GmailApiAttempt::Skipped);
    }
    if options.force {
        return Ok(GmailApiAttempt::Skipped);
    }

    let start_hist = match load_gmail_history_id(conn, mailbox_id, imap_folder)? {
        Some(s) if !s.trim().is_empty() => s,
        _ => {
            logger.info(
                "Gmail API incremental refresh skipped (no stored historyId yet)",
                None,
            );
            return Ok(GmailApiAttempt::Skipped);
        }
    };

    let token = ensure_google_access_token(
        ctx.home.as_path(),
        mailbox_id,
        &ctx.env_file,
        &ctx.process_env,
    )
    .map_err(|e| RunSyncError::Imap(e.to_string()))?;

    logger.info(
        "Gmail API incremental refresh starting",
        Some(
            &json!({
                "path": "gmail_api_partial",
                "startHistoryId": start_hist,
            })
            .to_string(),
        ),
    );

    let t_hist = Instant::now();
    let mut page_token: Option<String> = None;
    let mut latest_history_id: Option<String> = None;
    let mut message_ids: Vec<String> = Vec::new();

    loop {
        let url = history_list_url(&start_hist, page_token.as_deref());
        let (status, body) = http_get_json(
            &token,
            &url,
            GMAIL_API_HTTP_TIMEOUT_HISTORY,
            "gmail.users.history.list",
        )
        .map_err(RunSyncError::Imap)?;

        if status == 404 {
            clear_gmail_history_id(conn, mailbox_id, imap_folder)?;
            logger.warn(
                "Gmail history.list returned 404 (expired history); cleared historyId — falling back to IMAP",
                Some(&truncate_body(&body)),
            );
            return Ok(GmailApiAttempt::Fallback);
        }
        if status >= 400 {
            logger.warn(
                "Gmail history.list HTTP error; falling back to IMAP",
                Some(&format!("HTTP {status}: {}", truncate_body(&body))),
            );
            return Ok(GmailApiAttempt::Fallback);
        }

        let (mut chunk_ids, page_latest) =
            extract_history_message_ids(&body).map_err(RunSyncError::Imap)?;
        message_ids.append(&mut chunk_ids);
        if let Some(h) = page_latest {
            latest_history_id = Some(h);
        }

        let v: Value =
            serde_json::from_str(&body).map_err(|e| RunSyncError::Imap(e.to_string()))?;
        page_token = v
            .get("nextPageToken")
            .and_then(|x| x.as_str())
            .map(std::string::ToString::to_string);
        if page_token.is_none() {
            break;
        }
    }

    message_ids.sort_unstable();
    message_ids.dedup();

    let hist_ms = t_hist.elapsed().as_millis() as u64;
    logger.info(
        "Gmail API history.list complete",
        Some(
            &json!({
                "path": "gmail_api_partial",
                "historyWaitMs": hist_ms,
                "newMessageIds": message_ids.len(),
            })
            .to_string(),
        ),
    );

    if options.progress_stderr {
        eprintln!(
            "ripmail: Gmail API: {} new message ref(s) from history",
            message_ids.len()
        );
    }

    let mut synced = 0u32;
    let mut messages_fetched = 0u32;
    let mut bytes_downloaded = 0u64;
    let mut new_message_ids: Vec<String> = Vec::new();

    let cur = maildir_path.join("cur");
    std::fs::create_dir_all(maildir_path.join("tmp"))?;
    std::fs::create_dir_all(&cur)?;

    for gm_id in &message_ids {
        if crate::runtime_limits::shutdown_requested() {
            let _ = release_lock(conn, Some(pid), options.kind);
            return Err(RunSyncError::Interrupted);
        }
        if crate::runtime_limits::wall_clock_expired() {
            let _ = release_lock(conn, Some(pid), options.kind);
            return Err(RunSyncError::WallClockLimit);
        }

        let (label_ids, header_message_id) =
            fetch_message_metadata(&token, gm_id).map_err(RunSyncError::Imap)?;
        let labels = gmail_label_ids_to_strings(&label_ids);

        messages_fetched += 1;

        if label_excluded(&labels, exclude_lower) {
            continue;
        }

        if let Some(ref hm) = header_message_id {
            if message_already_indexed(conn, hm).map_err(RunSyncError::Sqlite)? {
                continue;
            }
        }

        let raw = fetch_raw_message(&token, gm_id).map_err(RunSyncError::Imap)?;
        bytes_downloaded += raw.len() as u64;

        let mut parsed = parse_raw_message(&raw);
        let dup: Option<i32> = conn
            .query_row(
                "SELECT 1 FROM messages WHERE message_id = ?1",
                [&parsed.message_id],
                |row| row.get(0),
            )
            .optional()?;
        if dup.is_some() {
            continue;
        }

        let basename = maildir_basename(0, &parsed.message_id);
        let written =
            write_maildir_message(&cur, &basename, &raw, &labels).map_err(RunSyncError::Io)?;
        let labels_json = serde_json::to_string(&labels).unwrap_or_else(|_| "[]".into());

        let tx = conn.transaction()?;
        let inserted = persist_message(
            &tx,
            &mut parsed,
            imap_folder,
            mailbox_id,
            0,
            &labels_json,
            &written.relative_raw_path,
        )?;
        if inserted {
            synced += 1;
            persist_attachments_from_parsed(
                &tx,
                &parsed.message_id,
                &parsed.attachments,
                maildir_path,
            )?;
            if new_message_ids.len() < 50 {
                new_message_ids.push(parsed.message_id.clone());
            }
        }
        tx.commit()?;
    }

    if let Some(ref hid) = latest_history_id {
        save_gmail_history_id(conn, mailbox_id, imap_folder, hid)?;
    }

    conn.execute(
        "UPDATE sync_summary SET last_sync_at = datetime('now') WHERE id = 1",
        [],
    )?;
    release_lock(conn, Some(pid), options.kind)?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let duration_sec = (duration_ms as f64) / 1000.0;
    let bandwidth = if duration_sec > 0.0 {
        bytes_downloaded as f64 / duration_sec
    } else {
        0.0
    };
    let msg_per_min = if duration_sec > 0.0 {
        (messages_fetched as f64 / duration_sec) * 60.0
    } else {
        0.0
    };

    let r = SyncResult {
        synced,
        messages_fetched,
        bytes_downloaded,
        duration_ms,
        bandwidth_bytes_per_sec: bandwidth,
        messages_per_minute: msg_per_min,
        log_path: log_path_str.to_string(),
        early_exit: None,
        gmail_api_partial: Some(true),
        new_message_ids: if new_message_ids.is_empty() {
            None
        } else {
            Some(new_message_ids)
        },
        mailboxes: None,
    };

    super::run::log_sync_metrics_public(logger, &r);
    logger.info(
        "Gmail API incremental refresh finished",
        Some(
            &json!({
                "path": "gmail_api_partial",
                "outcome": "ok",
            })
            .to_string(),
        ),
    );

    Ok(GmailApiAttempt::Completed(r))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_standard_label_ids() {
        let v = vec![
            "INBOX".into(),
            "CATEGORY_PROMOTIONS".into(),
            "Label_Foo".into(),
        ];
        let out = gmail_label_ids_to_strings(&v);
        assert!(out.iter().any(|s| s.contains("Inbox") || s == "\\Inbox"));
        assert!(out.iter().any(|s| s == "Promotions"));
        assert!(out.iter().any(|s| s == "Label_Foo"));
    }

    #[test]
    fn extract_history_parses_messages_added() {
        let body = r#"{
            "historyId": "9999",
            "history": [
                {
                    "id": "1",
                    "messagesAdded": [
                        { "message": { "id": "m1", "threadId": "t1" } },
                        { "message": { "id": "m2", "threadId": "t1" } }
                    ]
                }
            ]
        }"#;
        let (ids, hid) = extract_history_message_ids(body).unwrap();
        assert_eq!(ids, vec!["m1".to_string(), "m2".to_string()]);
        assert_eq!(hid.as_deref(), Some("9999"));
    }

    #[test]
    fn parse_metadata_extracts_labels_and_message_id() {
        let body = r#"{
            "labelIds": ["INBOX", "SENT"],
            "payload": {
                "headers": [
                    {"name": "Message-ID", "value": " <foo@bar.com> "}
                ]
            }
        }"#;
        let (labels, mid) = parse_metadata_labels_and_message_id(body).unwrap();
        assert!(labels.contains(&"INBOX".into()));
        assert_eq!(mid.as_deref(), Some("<foo@bar.com>"));
    }

    #[test]
    fn message_id_lookup_candidates_adds_brackets() {
        let c = message_id_lookup_candidates("abc@x.test");
        assert!(c.iter().any(|s| s == "abc@x.test"));
        assert!(c.iter().any(|s| s == "<abc@x.test>"));
    }
}
