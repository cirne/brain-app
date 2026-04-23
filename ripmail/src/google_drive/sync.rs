//! Index a Google Drive folder tree into `files` + `document_index` (same FTS path as localDir).

use std::collections::VecDeque;
use std::path::Path;
use std::time::Instant;

use rusqlite::{params, Connection};

use crate::attachments::local_file_read_outcome;
use crate::config::{ResolvedSource, SourceKind};
use crate::oauth::ensure_google_access_token;
use crate::sync::run::SyncResult;

use super::api::{
    drive_download_media, drive_export, drive_list_children, MIME_DOC, MIME_FOLDER, MIME_SHEET,
};

const MAX_SCAN_FILES: usize = 2000;
const DEFAULT_MAX_BYTES: u64 = 10_000_000;

fn sanitize_segment(name: &str) -> String {
    let s = name.trim();
    if s.is_empty() {
        return "_".into();
    }
    s.chars()
        .map(|c| if c == '/' || c == '\\' { '_' } else { c })
        .collect()
}

/// Full re-index for `kind == GoogleDrive`: clears prior rows for this source, walks Drive, extracts text.
pub fn run_google_drive_sync(
    conn: &mut Connection,
    home: &Path,
    mb: &ResolvedSource,
    env_file: &std::collections::HashMap<String, String>,
    process_env: &std::collections::HashMap<String, String>,
    progress_stderr: bool,
) -> Result<SyncResult, Box<dyn std::error::Error>> {
    if mb.kind != SourceKind::GoogleDrive {
        return Err("run_google_drive_sync: not a googleDrive source".into());
    }
    let Some(gd) = mb.google_drive.as_ref() else {
        return Err("run_google_drive_sync: missing google_drive".into());
    };

    let token_mb = gd.oauth_token_mailbox_id.as_str();
    let auth = ensure_google_access_token(home, token_mb, env_file, process_env).map_err(|e| {
        format!(
            "Google OAuth for Drive: {e}. Ensure google-oauth.json exists under RIPMAIL_HOME/{token_mb}/."
        )
    })?;

    let started = Instant::now();

    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM document_index WHERE source_id = ?1 AND kind = 'file'",
        [&mb.id],
    )?;
    tx.execute("DELETE FROM files WHERE source_id = ?1", [&mb.id])?;

    let mut insert_file = tx.prepare_cached(
        "INSERT INTO files (source_id, rel_path, abs_path, mtime, size, mime, title, body_text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    let mut insert_doc = tx.prepare_cached(
        "INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso)
         VALUES (?1, 'file', ?2, ?3, ?4, ?5)",
    )?;

    let mut queue: VecDeque<(String, String)> = VecDeque::new();
    queue.push_back((gd.folder_id.clone(), String::new()));

    let mut scanned: u32 = 0;
    let mut indexed: u32 = 0;
    let mut bytes_total: u64 = 0;
    let mut seen_files: usize = 0;
    let mut stopped_limit = false;

    'walk: while let Some((folder_id, prefix)) = queue.pop_front() {
        let mut page_tok: Option<String> = None;
        loop {
            let (page, next) = drive_list_children(&auth, &folder_id, page_tok.as_deref())?;
            for row in page {
                if seen_files >= MAX_SCAN_FILES {
                    stopped_limit = true;
                    break 'walk;
                }
                if row.mime_type == MIME_FOLDER {
                    let seg = sanitize_segment(&row.name);
                    let sub_prefix = if prefix.is_empty() {
                        seg.clone()
                    } else {
                        format!("{prefix}/{seg}")
                    };
                    queue.push_back((row.id.clone(), sub_prefix));
                    continue;
                }

                scanned += 1;
                seen_files += 1;
                let seg = sanitize_segment(&row.name);
                let rel_key = if prefix.is_empty() {
                    seg.clone()
                } else {
                    format!("{prefix}/{seg}")
                };
                let title = row.name.clone();
                let mime = row.mime_type.clone();
                let mtime_unix = row
                    .modified_time
                    .as_deref()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.timestamp())
                    .unwrap_or(0);
                let date_iso = row.modified_time.clone().unwrap_or_default();

                let bytes_result: Result<Vec<u8>, String> = if mime == MIME_DOC {
                    drive_export(&auth, &row.id, "text/plain").map_err(|e| e.to_string())
                } else if mime == MIME_SHEET {
                    drive_export(&auth, &row.id, "text/csv").map_err(|e| e.to_string())
                } else if mime.starts_with("application/vnd.google-apps.") {
                    Err("skip_native_google_app".into())
                } else if row
                    .size
                    .as_deref()
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(0)
                    > DEFAULT_MAX_BYTES
                {
                    Err("too_large".into())
                } else {
                    drive_download_media(&auth, &row.id).map_err(|e| e.to_string())
                };

                let bytes = match bytes_result {
                    Ok(b) => b,
                    Err(_) => continue,
                };

                if bytes.len() as u64 > DEFAULT_MAX_BYTES {
                    continue;
                }

                bytes_total += bytes.len() as u64;
                let len = bytes.len() as i64;
                let fname = seg.as_str();
                let body = local_file_read_outcome(&bytes, &mime, fname).body_text;
                let abs_s = format!("drive://{}/{}", row.id, title);

                insert_file.execute(params![
                    &mb.id, &rel_key, &abs_s, mtime_unix, len, &mime, &title, &body,
                ])?;
                insert_doc.execute(params![&mb.id, &rel_key, &title, &body, &date_iso,])?;
                indexed += 1;
            }
            match next {
                Some(n) if !n.is_empty() => page_tok = Some(n),
                _ => break,
            }
        }
    }

    drop(insert_file);
    drop(insert_doc);

    let inc = if mb.include_in_default { 1 } else { 0 };
    tx.execute(
        "INSERT INTO sources (id, kind, label, include_in_default, last_synced_at, doc_count)
         VALUES (?1, 'googleDrive', NULL, ?2, datetime('now'), ?3)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           include_in_default = excluded.include_in_default,
           last_synced_at = excluded.last_synced_at,
           doc_count = excluded.doc_count",
        params![&mb.id, inc, indexed as i64],
    )?;

    tx.commit()?;

    if progress_stderr {
        if stopped_limit {
            eprintln!(
                "ripmail: googleDrive stopped at {} indexed files (limit {})",
                indexed, MAX_SCAN_FILES
            );
        }
        eprintln!(
            "ripmail: googleDrive indexed {} file(s) from Drive folder {}.",
            indexed, gd.folder_id
        );
    }

    let duration_ms = started.elapsed().as_millis() as u64;
    Ok(SyncResult {
        synced: indexed,
        messages_fetched: scanned,
        bytes_downloaded: bytes_total,
        duration_ms,
        bandwidth_bytes_per_sec: 0.0,
        messages_per_minute: 0.0,
        log_path: String::new(),
        early_exit: None,
        new_message_ids: None,
        mailboxes: None,
    })
}
