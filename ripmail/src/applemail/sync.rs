//! Index messages from Apple Mail’s local Envelope Index + `.emlx` files into ripmail’s SQLite.

use std::path::Path;
use std::time::{Duration, Instant};

use rusqlite::Connection;

use crate::config::ResolvedMailbox;
use crate::db::message_persist::{
    persist_attachments_from_parsed, persist_message, uids_already_indexed,
};
use crate::sync::parse_message::{parse_raw_message_with_options, ParseMessageOptions};
use crate::sync::process_lock::{acquire_lock, release_lock, SyncKind};
use crate::sync::sync_log::SyncFileLogger;
use crate::sync::SyncResult;

use super::emlx::read_mail_file_bytes;
use super::envelope_index::{self, EnvelopeCandidate};
use super::paths::{
    resolve_emlx_deterministic_then_scan, ApplemailEmlxCache, PathResolveDiag, PathResolveMethod,
};
use super::skip;

const APPLEMAIL_FOLDER: &str = "Apple Mail";

/// Rows per keyset page (Envelope Index query).
const PAGE_SIZE: usize = 1000;
/// Hard cap on rows scanned in one run (safety valve).
const MAX_TOTAL_ROWS_SCANNED: u64 = 10_000_000;

/// Emit progress at end of each Envelope Index page, or this often if a page is very slow.
const PROGRESS_EVERY_SEC: Duration = Duration::from_secs(30);

fn message_date_on_or_after_rfc3339(parsed_date: &str, since_ymd: &str) -> bool {
    if let Some(day) = parsed_date.get(0..10) {
        if day.len() == 10
            && day.as_bytes().get(4) == Some(&b'-')
            && day.as_bytes().get(7) == Some(&b'-')
        {
            return day >= since_ymd;
        }
    }
    true
}

fn path_resolve_tag(d: &PathResolveDiag) -> String {
    match &d.method {
        PathResolveMethod::MailboxUrl => "mailbox_url".to_string(),
        PathResolveMethod::MailboxIndex { files_indexed } => {
            format!("mailbox_index_files={files_indexed}")
        }
        PathResolveMethod::GlobalIndex { files_indexed } => {
            format!("global_index_files={files_indexed}")
        }
        PathResolveMethod::NotFound => "not_found".to_string(),
    }
}

fn opt_ms(o: Option<u128>) -> String {
    o.map(|x| format!("{x}")).unwrap_or_else(|| "-".into())
}

fn format_applemail_keyset_cursor(after: Option<(i64, i64)>) -> String {
    match after {
        None => "start".to_string(),
        Some((d, r)) => format!("({d},{r})"),
    }
}

#[allow(clippy::too_many_arguments)]
fn log_row_timing(
    progress_stderr: bool,
    logger: &SyncFileLogger,
    row_idx: u32,
    rowid: i64,
    mailbox_rowid: Option<i64>,
    diag: &PathResolveDiag,
    resolve_ms: u128,
    read_ms: Option<u128>,
    parse_ms: Option<u128>,
    dup_ms: Option<u128>,
    persist_ms: Option<u128>,
    wall_ms: u128,
    outcome: &str,
    raw_bytes: Option<usize>,
) {
    let msg = format!(
        "applemail row_timing row={row_idx} envelope_ROWID={rowid} messages.mailbox={mailbox_rowid:?} path={} resolve_ms={resolve_ms} read_ms={} parse_ms={} dup_lookup_ms={} persist_ms={} wall_ms={wall_ms} outcome={outcome} raw_bytes={}",
        path_resolve_tag(diag),
        opt_ms(read_ms),
        opt_ms(parse_ms),
        opt_ms(dup_ms),
        opt_ms(persist_ms),
        raw_bytes
            .map(|b| b.to_string())
            .unwrap_or_else(|| "-".into()),
    );
    logger.info(&msg, None);
    if progress_stderr {
        eprintln!("ripmail: {msg}");
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_applemail_progress(
    progress_stderr: bool,
    logger: &SyncFileLogger,
    email: &str,
    global_row: u32,
    after_cursor: Option<(i64, i64)>,
    page_len: usize,
    row_in_page: u32,
    elapsed: Duration,
    synced: u32,
    skipped_no_path: u32,
    read_err: u32,
    since_skip: u32,
    dup_skip: u32,
    envelope_skip: u32,
    index_skip: u32,
    persist_err: u32,
) {
    let pct_page = if page_len > 0 {
        (row_in_page as u64 * 100) / page_len as u64
    } else {
        0
    };
    let cursor_s = format_applemail_keyset_cursor(after_cursor);
    let msg = format!(
        "applemail progress email={email} after_cursor={cursor_s} page_row={row_in_page}/{page_len} (~{pct_page}% of page) global_row={global_row} elapsed={elapsed:?} new_indexed={synced} no_emlx_path={skipped_no_path} read_err={read_err} since_filter={since_skip} duplicate={dup_skip} envelope_skip={envelope_skip} already_indexed={index_skip} persist_err={persist_err}"
    );
    logger.info(&msg, None);
    if progress_stderr {
        eprintln!("ripmail: {msg}");
    }
}

#[allow(clippy::too_many_arguments)]
fn maybe_emit_applemail_progress(
    progress_stderr: bool,
    logger: &SyncFileLogger,
    email: &str,
    global_row: u32,
    after_cursor: Option<(i64, i64)>,
    page_len: usize,
    row_in_page: u32,
    last_emit: &mut Instant,
    start: Instant,
    synced: u32,
    skipped_no_path: u32,
    read_err: u32,
    since_skip: u32,
    dup_skip: u32,
    envelope_skip: u32,
    index_skip: u32,
    persist_err: u32,
) {
    let end_of_page = page_len > 0 && (row_in_page as usize) == page_len;
    let heartbeat = last_emit.elapsed() >= PROGRESS_EVERY_SEC;
    if !(end_of_page || heartbeat) {
        return;
    }
    *last_emit = Instant::now();
    emit_applemail_progress(
        progress_stderr,
        logger,
        email,
        global_row,
        after_cursor,
        page_len,
        row_in_page,
        start.elapsed(),
        synced,
        skipped_no_path,
        read_err,
        since_skip,
        dup_skip,
        envelope_skip,
        index_skip,
        persist_err,
    );
}

/// Sync one Apple Mail-backed mailbox: read Envelope Index + `.emlx`, insert into `conn`.
///
/// Uses the same PID lock as IMAP sync so `sync_summary.is_running` cannot remain stuck after
/// indexing, and updates `sync_summary` timestamps when the run completes.
pub fn run_applemail_sync(
    conn: &mut Connection,
    logger: &SyncFileLogger,
    mb: &ResolvedMailbox,
    since_ymd: &str,
    progress_stderr: bool,
    verbose: bool,
    sync_kind: SyncKind,
) -> Result<SyncResult, Box<dyn std::error::Error>> {
    let start = Instant::now();
    let log_path = logger.log_path().display().to_string();
    let Some(ref mail_root) = mb.apple_mail_root else {
        return Err("apple_mail_root not set".into());
    };
    let index_path = envelope_index::envelope_index_path(mail_root);
    if !index_path.is_file() {
        return Err(format!(
            "Apple Mail Envelope Index not found at {} (Full Disk Access?)",
            index_path.display()
        )
        .into());
    }
    if verbose {
        logger.debug(
            &format!("applemail: opening {}", index_path.display()),
            None,
        );
    }

    let pid = std::process::id() as i64;
    let lock_result = acquire_lock(conn, pid, sync_kind)?;
    if !lock_result.acquired {
        let duration_ms = start.elapsed().as_millis() as u64;
        return Ok(SyncResult::empty(duration_ms, log_path));
    }
    if lock_result.taken_over {
        logger.info("Recovered stale sync lock", None);
    }

    let inner_result = run_applemail_sync_inner(
        conn,
        logger,
        mb,
        since_ymd,
        progress_stderr,
        verbose,
        start,
        log_path.clone(),
        index_path.as_path(),
    );

    match inner_result {
        Ok(r) => {
            let _ = conn.execute(
                r#"UPDATE sync_summary SET
            earliest_synced_date = COALESCE((SELECT MIN(date) FROM messages), earliest_synced_date),
            latest_synced_date = COALESCE((SELECT MAX(date) FROM messages), latest_synced_date),
            total_messages = (SELECT COUNT(*) FROM messages),
            last_sync_at = datetime('now')
         WHERE id = 1"#,
                [],
            );
            let _ = release_lock(conn, Some(pid), sync_kind);
            Ok(r)
        }
        Err(e) => {
            let _ = release_lock(conn, Some(pid), sync_kind);
            Err(e)
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_applemail_sync_inner(
    conn: &mut Connection,
    logger: &SyncFileLogger,
    mb: &ResolvedMailbox,
    since_ymd: &str,
    progress_stderr: bool,
    verbose: bool,
    start: Instant,
    log_path: String,
    index_path: &Path,
) -> Result<SyncResult, Box<dyn std::error::Error>> {
    let mail_root = mb
        .apple_mail_root
        .as_ref()
        .expect("run_applemail_sync validates apple_mail_root");

    let env_conn = envelope_index::open_envelope_readonly(index_path)?;

    let since_ts = envelope_index::ymd_to_unix_ts(since_ymd)
        .ok_or_else(|| format!("invalid --since date: {since_ymd}"))?;

    let since_banner = format!(
        "applemail: effective --since lower bound (inclusive) {since_ymd} (ts={since_ts}); keyset pagination ORDER BY date_received DESC, ROWID DESC (newest first)"
    );
    logger.info(&since_banner, None);
    if progress_stderr {
        eprintln!("ripmail: {since_banner}");
    }

    match envelope_index::messages_table_row_count(&env_conn) {
        Ok(n) => {
            let intro = format!(
                "applemail: Envelope Index `messages` row count ≈ {n} (paged in batches of {PAGE_SIZE}; WHERE date_received >= --since)"
            );
            logger.info(&intro, None);
            if progress_stderr {
                eprintln!("ripmail: {intro}");
            }
        }
        Err(e) => {
            logger.warn(
                &format!("applemail: could not COUNT(*) messages ({e}); continuing"),
                None,
            );
        }
    }

    logger.info(
        &format!("applemail: two-phase sync (metadata pages + targeted .emlx reads; since ≥ {since_ymd})"),
        None,
    );

    let skip_mailboxes = skip::build_skip_mailbox_map(&env_conn)
        .map_err(|e| format!("applemail: mailboxes table: {e}"))?;

    let include_remote_id = envelope_index::messages_table_has_remote_id(&env_conn)
        .map_err(|e| format!("applemail: envelope schema (messages): {e}"))?;

    let mut synced: u32 = 0;
    let mut messages_fetched: u32 = 0;
    let mut bytes_downloaded: u64 = 0;
    let mut new_ids: Vec<String> = Vec::new();

    let mut emlx_cache = ApplemailEmlxCache::new();

    let mut row_idx: u32 = 0;
    let mut skipped_no_path: u32 = 0;
    let mut read_err: u32 = 0;
    let mut since_skip: u32 = 0;
    let mut dup_skip: u32 = 0;
    let mut envelope_skip: u32 = 0;
    let mut index_skip: u32 = 0;
    let mut persist_err: u32 = 0;
    let mut last_progress_emit = Instant::now();
    let email = mb.email.as_str();

    let mut after_cursor: Option<(i64, i64)> = None;
    let mut total_scanned: u64 = 0;

    'pages: loop {
        if total_scanned >= MAX_TOTAL_ROWS_SCANNED {
            let cap = format!(
                "applemail: stopping: scanned {total_scanned} rows (MAX_TOTAL_ROWS_SCANNED={MAX_TOTAL_ROWS_SCANNED})"
            );
            logger.warn(&cap, None);
            if progress_stderr {
                eprintln!("ripmail: {cap}");
            }
            break;
        }

        let load_start = Instant::now();
        let page = envelope_index::list_candidates_since_keyset(
            &env_conn,
            PAGE_SIZE,
            since_ts,
            after_cursor,
            include_remote_id,
        )
        .map_err(|e| {
            format!(
                "Failed to read Apple Mail messages table (schema may differ on this macOS): {e}"
            )
        })?;
        let load_elapsed = load_start.elapsed();
        let page_len = page.len();

        if page_len == 0 {
            let done_empty = format!(
                "applemail: no more rows after cursor {} (finished in {:?})",
                format_applemail_keyset_cursor(after_cursor),
                start.elapsed()
            );
            logger.info(&done_empty, None);
            if progress_stderr {
                eprintln!("ripmail: {done_empty}");
            }
            break;
        }

        let load_line = format!(
            "applemail: loaded page after_cursor={} rows={page_len} in {:?}",
            format_applemail_keyset_cursor(after_cursor),
            load_elapsed
        );
        logger.info(&load_line, None);
        if progress_stderr && verbose {
            eprintln!("ripmail: {load_line}");
        }

        // Phase 1: filter to candidates we might index; batch dedup against ripmail DB.
        let mut filtered: Vec<EnvelopeCandidate> = Vec::new();
        for c in &page {
            total_scanned += 1;
            row_idx += 1;

            if let Some(env_day) = envelope_index::envelope_candidate_received_date_ymd(c) {
                if env_day.as_str() < since_ymd {
                    since_skip += 1;
                    continue;
                }
            }

            if let Some(reason) = skip::envelope_candidate_skip_reason(c) {
                envelope_skip += 1;
                if verbose {
                    logger.debug(
                        &format!("applemail: skip row (envelope metadata: {reason})"),
                        Some(&c.rowid.to_string()),
                    );
                }
                continue;
            }

            if skip_mailboxes.contains_key(&c.mailbox) {
                envelope_skip += 1;
                if verbose {
                    logger.debug(
                        "applemail: skip row (mailbox url: special folder)",
                        Some(&c.rowid.to_string()),
                    );
                }
                continue;
            }

            filtered.push(c.clone());
        }

        let rowids: Vec<i64> = filtered.iter().map(|c| c.rowid).collect();
        let already = uids_already_indexed(conn, &mb.id, &rowids)
            .map_err(|e| format!("applemail: uid dedup query: {e}"))?;

        let mut row_in_page: u32 = 0;
        for c in filtered {
            if already.contains(&c.rowid) {
                index_skip += 1;
                continue;
            }

            row_in_page += 1;
            let row_wall = Instant::now();

            let t_resolve = Instant::now();
            let (emlx_opt, path_diag) = resolve_emlx_deterministic_then_scan(
                mail_root,
                &env_conn,
                c.mailbox,
                c.rowid,
                c.remote_id,
                &mut emlx_cache,
            );
            let resolve_ms = t_resolve.elapsed().as_millis();

            let Some(emlx_path) = emlx_opt else {
                skipped_no_path += 1;
                if verbose {
                    logger.debug(
                        "applemail: skip row (no .emlx path)",
                        Some(&c.rowid.to_string()),
                    );
                }
                if verbose {
                    log_row_timing(
                        progress_stderr,
                        logger,
                        row_idx,
                        c.rowid,
                        Some(c.mailbox),
                        &path_diag,
                        resolve_ms,
                        None,
                        None,
                        None,
                        None,
                        row_wall.elapsed().as_millis(),
                        "no_path",
                        None,
                    );
                }
                maybe_emit_applemail_progress(
                    progress_stderr,
                    logger,
                    email,
                    row_idx,
                    after_cursor,
                    page_len,
                    row_in_page,
                    &mut last_progress_emit,
                    start,
                    synced,
                    skipped_no_path,
                    read_err,
                    since_skip,
                    dup_skip,
                    envelope_skip,
                    index_skip,
                    persist_err,
                );
                continue;
            };

            let t_read = Instant::now();
            let raw_file = match read_mail_file_bytes(&emlx_path) {
                Ok(b) => b,
                Err(e) => {
                    read_err += 1;
                    let read_ms = t_read.elapsed().as_millis();
                    logger.warn(
                        &format!("applemail: read {}: {e}", emlx_path.display()),
                        None,
                    );
                    if verbose {
                        log_row_timing(
                            progress_stderr,
                            logger,
                            row_idx,
                            c.rowid,
                            Some(c.mailbox),
                            &path_diag,
                            resolve_ms,
                            Some(read_ms),
                            None,
                            None,
                            None,
                            row_wall.elapsed().as_millis(),
                            "read_err",
                            None,
                        );
                    }
                    maybe_emit_applemail_progress(
                        progress_stderr,
                        logger,
                        email,
                        row_idx,
                        after_cursor,
                        page_len,
                        row_in_page,
                        &mut last_progress_emit,
                        start,
                        synced,
                        skipped_no_path,
                        read_err,
                        since_skip,
                        dup_skip,
                        envelope_skip,
                        index_skip,
                        persist_err,
                    );
                    continue;
                }
            };
            let read_ms = t_read.elapsed().as_millis();

            messages_fetched += 1;
            let raw_len = raw_file.len();
            bytes_downloaded += raw_len as u64;

            let t_parse = Instant::now();
            let opts = ParseMessageOptions {
                include_attachments: true,
                include_attachment_bytes: false,
            };
            let mut parsed = parse_raw_message_with_options(&raw_file, opts);
            let parse_ms = t_parse.elapsed().as_millis();

            if !message_date_on_or_after_rfc3339(&parsed.date, since_ymd) {
                since_skip += 1;
                if verbose {
                    log_row_timing(
                        progress_stderr,
                        logger,
                        row_idx,
                        c.rowid,
                        Some(c.mailbox),
                        &path_diag,
                        resolve_ms,
                        Some(read_ms),
                        Some(parse_ms),
                        None,
                        None,
                        row_wall.elapsed().as_millis(),
                        "since_filter",
                        Some(raw_len),
                    );
                }
                maybe_emit_applemail_progress(
                    progress_stderr,
                    logger,
                    email,
                    row_idx,
                    after_cursor,
                    page_len,
                    row_in_page,
                    &mut last_progress_emit,
                    start,
                    synced,
                    skipped_no_path,
                    read_err,
                    since_skip,
                    dup_skip,
                    envelope_skip,
                    index_skip,
                    persist_err,
                );
                continue;
            }

            let raw_path_str = emlx_path.to_string_lossy().to_string();
            let t_persist = Instant::now();
            let inserted = match persist_message(
                conn,
                &mut parsed,
                APPLEMAIL_FOLDER,
                &mb.id,
                c.rowid,
                "[]",
                &raw_path_str,
            ) {
                Ok(b) => b,
                Err(e) => {
                    persist_err += 1;
                    logger.warn(
                        &format!("applemail: persist message rowid={} error: {e}", c.rowid),
                        None,
                    );
                    if verbose {
                        log_row_timing(
                            progress_stderr,
                            logger,
                            row_idx,
                            c.rowid,
                            Some(c.mailbox),
                            &path_diag,
                            resolve_ms,
                            Some(read_ms),
                            Some(parse_ms),
                            None,
                            Some(t_persist.elapsed().as_millis()),
                            row_wall.elapsed().as_millis(),
                            "persist_err",
                            Some(raw_len),
                        );
                    }
                    maybe_emit_applemail_progress(
                        progress_stderr,
                        logger,
                        email,
                        row_idx,
                        after_cursor,
                        page_len,
                        row_in_page,
                        &mut last_progress_emit,
                        start,
                        synced,
                        skipped_no_path,
                        read_err,
                        since_skip,
                        dup_skip,
                        envelope_skip,
                        index_skip,
                        persist_err,
                    );
                    continue;
                }
            };
            if inserted {
                let _ = persist_attachments_from_parsed(
                    conn,
                    &parsed.message_id,
                    &parsed.attachments,
                    Path::new(""),
                );
                synced += 1;
                if new_ids.len() < 50 {
                    new_ids.push(parsed.message_id.clone());
                }
            } else {
                dup_skip += 1;
            }
            let persist_ms = t_persist.elapsed().as_millis();

            if verbose {
                let outcome = if inserted {
                    "indexed"
                } else {
                    "persist_duplicate"
                };
                log_row_timing(
                    progress_stderr,
                    logger,
                    row_idx,
                    c.rowid,
                    Some(c.mailbox),
                    &path_diag,
                    resolve_ms,
                    Some(read_ms),
                    Some(parse_ms),
                    None,
                    Some(persist_ms),
                    row_wall.elapsed().as_millis(),
                    outcome,
                    Some(raw_len),
                );
            }

            maybe_emit_applemail_progress(
                progress_stderr,
                logger,
                email,
                row_idx,
                after_cursor,
                page_len,
                row_in_page,
                &mut last_progress_emit,
                start,
                synced,
                skipped_no_path,
                read_err,
                since_skip,
                dup_skip,
                envelope_skip,
                index_skip,
                persist_err,
            );
        }

        after_cursor = page.last().map(|c| (c.date_received, c.rowid));

        if page_len < PAGE_SIZE {
            let end = format!("applemail: last page (partial) rows={page_len}; end of candidates");
            logger.info(&end, None);
            if progress_stderr {
                eprintln!("ripmail: {end}");
            }
            break 'pages;
        }
    }

    let done = format!(
        "applemail: finished: new_indexed={synced} global_rows_scanned={row_idx} no_emlx_path={skipped_no_path} read_err={read_err} since_filter={since_skip} duplicate={dup_skip} envelope_skip={envelope_skip} already_indexed={index_skip} persist_err={persist_err} total_elapsed={:?}",
        start.elapsed()
    );
    logger.info(&done, None);
    if progress_stderr {
        eprintln!("ripmail: {done}");
    }
    if synced == 0 && row_idx > 0 && (read_err > 0 || skipped_no_path > 0 || persist_err > 0) {
        let hint = format!(
            "applemail: indexed 0 messages — {} read errors, {} missing paths, {} persist errors. Run: cargo run --bin applemail-explore -- inspect",
            read_err, skipped_no_path, persist_err
        );
        logger.warn(&hint, None);
        if progress_stderr {
            eprintln!("ripmail: {hint}");
        }
    }

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

    Ok(SyncResult {
        synced,
        messages_fetched,
        bytes_downloaded,
        duration_ms,
        bandwidth_bytes_per_sec: bandwidth,
        messages_per_minute: msg_per_min,
        log_path,
        early_exit: None,
        gmail_api_partial: None,
        new_message_ids: if new_ids.is_empty() {
            None
        } else {
            Some(new_ids)
        },
        mailboxes: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn since_filter_iso_day() {
        assert!(!message_date_on_or_after_rfc3339(
            "2020-01-15T12:00:00Z",
            "2024-01-01"
        ));
        assert!(message_date_on_or_after_rfc3339(
            "2025-01-15T12:00:00Z",
            "2024-01-01"
        ));
    }
}
