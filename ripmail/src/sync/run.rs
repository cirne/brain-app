//! IMAP sync engine (`run_sync`) — mirrors `src/sync/index.ts` `runSync`.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Instant;

use imap::Session;
use rusqlite::{params, Connection, OptionalExtension};

use crate::config::Config;
use crate::db::message_persist::{persist_attachments_from_parsed, persist_message};

use super::error::RunSyncError;
use super::fetch_timeout::timeout_ms_for_fetch_all_attempt;
use super::imap_date::ymd_to_imap_since;
use super::parse_raw_message;
use super::parse_since_to_date;
use super::process_lock::{
    acquire_lock, is_sync_lock_held, read_sync_lock_row_optional, release_lock, SyncKind,
};
use super::retry::{retry_with_backoff, RetryPolicy};
use super::sync_log::SyncFileLogger;
use super::transport::{FetchedMessage, ImapStatusData, SyncImapTransport};
use super::windows::{forward_uid_range, oldest_message_date_for_folder};
use super::write_maildir_message;

const BATCH_SIZE_FORWARD_DEFAULT: usize = 50;
const BATCH_SIZE_BACKWARD_DEFAULT: usize = 100;
/// Default concurrent IMAP sessions for UID FETCH (override with `RIPMAIL_SYNC_FETCH_PARALLEL`).
const PARALLEL_IMAP_FETCH_CONNECTIONS_DEFAULT: usize = 8;
/// Extra batches allowed in the pipeline beyond `n_workers` (FETCH completes while ingest drains).
const FETCH_PIPELINE_EXTRA_BATCHES_DEFAULT: usize = 8;

const NEW_MESSAGE_IDS_CAP: usize = 50;

/// Extra IMAP connections for parallel [`UID FETCH`](https://www.rfc-editor.org/rfc/rfc3501#section-6.4.8) (Gmail allows multiple `EXAMINE` sessions).
type ParallelImapConnect =
    Arc<dyn Fn() -> Result<Session<imap::Connection>, RunSyncError> + Send + Sync>;

/// Parsed `RIPMAIL_SYNC_FETCH_PARALLEL`: 1–32 inclusive, else default.
pub(crate) fn effective_parallel_fetch_connections() -> usize {
    std::env::var("RIPMAIL_SYNC_FETCH_PARALLEL")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|&n| (1..=32).contains(&n))
        .unwrap_or(PARALLEL_IMAP_FETCH_CONNECTIONS_DEFAULT)
}

fn effective_batch_sizes(direction: SyncDirection) -> usize {
    let env_backward = std::env::var("RIPMAIL_SYNC_FETCH_BATCH_BACKWARD")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|&n| (1..=500).contains(&n));
    let env_forward = std::env::var("RIPMAIL_SYNC_FETCH_BATCH_FORWARD")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|&n| (1..=500).contains(&n));

    match direction {
        SyncDirection::Forward => env_forward.unwrap_or(BATCH_SIZE_FORWARD_DEFAULT),
        SyncDirection::Backward => env_backward.unwrap_or(BATCH_SIZE_BACKWARD_DEFAULT),
    }
}

fn effective_fetch_pipeline_extra() -> usize {
    std::env::var("RIPMAIL_SYNC_FETCH_PIPELINE_EXTRA")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|&n| n <= 64)
        .unwrap_or(FETCH_PIPELINE_EXTRA_BATCHES_DEFAULT)
}

fn max_parallel_pipeline_slots_with_extra(n_workers: usize, extra: usize) -> usize {
    let configured = n_workers.saturating_add(extra);
    // Headroom beyond n_workers so out-of-order FETCH completions can buffer without capping dispatch at n_workers.
    configured.max(n_workers.saturating_mul(2))
}

fn max_parallel_pipeline_slots(n_workers: usize) -> usize {
    max_parallel_pipeline_slots_with_extra(n_workers, effective_fetch_pipeline_extra())
}

struct FetchCompletion {
    slot: usize,
    batch_index: usize,
    payload: Result<(Vec<FetchedMessage>, u128), RunSyncError>,
}

struct ImapFetchWorkerHandle {
    task_tx: mpsc::SyncSender<Option<(usize, Vec<u32>)>>,
    boot_rx: mpsc::Receiver<Result<(), RunSyncError>>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl ImapFetchWorkerHandle {
    fn spawn(
        slot: usize,
        connector: ParallelImapConnect,
        folder: String,
        logger: SyncFileLogger,
        complete_tx: mpsc::SyncSender<FetchCompletion>,
    ) -> Self {
        let (task_tx, task_rx) = mpsc::sync_channel::<Option<(usize, Vec<u32>)>>(2);
        let (boot_tx, boot_rx) = mpsc::sync_channel(1);
        let join = std::thread::spawn(move || {
            let mut session = match connector() {
                Ok(s) => s,
                Err(e) => {
                    let _ = boot_tx.send(Err(e));
                    return;
                }
            };
            let mut transp = super::transport::RealImapTransport {
                session: &mut session,
            };
            if let Err(e) = transp.examine_mailbox(&folder) {
                let _ = boot_tx.send(Err(e));
                return;
            }
            let _ = boot_tx.send(Ok(()));
            while let Ok(maybe_task) = task_rx.recv() {
                let Some((batch_index, uids)) = maybe_task else {
                    break;
                };
                let uid_csv: String = uids
                    .iter()
                    .map(|u| u.to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                let t_fetch = Instant::now();
                let payload =
                    match uid_fetch_with_retries(&mut transp, &uid_csv, &logger, uids.len()) {
                        Ok(fetched) => Ok((fetched, t_fetch.elapsed().as_millis())),
                        Err(e) => Err(e),
                    };
                if complete_tx
                    .send(FetchCompletion {
                        slot,
                        batch_index,
                        payload,
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        Self {
            task_tx,
            boot_rx,
            join: Some(join),
        }
    }

    fn wait_boot(&self) -> Result<(), RunSyncError> {
        match self.boot_rx.recv() {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(RunSyncError::Imap(
                "parallel IMAP fetch worker failed to start (boot channel closed)".into(),
            )),
        }
    }
}

fn spawn_parallel_imap_fetch_pool(
    n_workers: usize,
    connector: ParallelImapConnect,
    folder: &str,
    logger: &SyncFileLogger,
) -> Result<(Vec<ImapFetchWorkerHandle>, mpsc::Receiver<FetchCompletion>), RunSyncError> {
    let cap = max_parallel_pipeline_slots(n_workers)
        .saturating_mul(2)
        .max(32);
    let (complete_tx, complete_rx) = mpsc::sync_channel::<FetchCompletion>(cap);

    let folder = folder.to_string();
    let mut handles = Vec::with_capacity(n_workers);
    for slot in 0..n_workers {
        handles.push(ImapFetchWorkerHandle::spawn(
            slot,
            Arc::clone(&connector),
            folder.clone(),
            logger.clone(),
            complete_tx.clone(),
        ));
    }
    drop(complete_tx);
    for h in &handles {
        if let Err(e) = h.wait_boot() {
            shutdown_parallel_imap_fetch_pool(handles);
            return Err(e);
        }
    }
    Ok((handles, complete_rx))
}

fn shutdown_parallel_imap_fetch_pool(mut handles: Vec<ImapFetchWorkerHandle>) {
    for h in &handles {
        let _ = h.task_tx.send(None);
    }
    for h in handles.drain(..) {
        if let Some(j) = h.join {
            let _ = j.join();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncDirection {
    Forward,
    Backward,
}

#[derive(Debug, Clone)]
pub struct SyncOptions {
    /// Which PID lock row (`sync_summary` id=1 refresh vs id=2 backfill).
    pub kind: SyncKind,
    pub direction: SyncDirection,
    /// Resolved calendar start `YYYY-MM-DD` (from `--since` or `sync.defaultSince`).
    pub since_ymd: String,
    pub force: bool,
    pub progress_stderr: bool,
    /// Extra `DEBUG` lines in the sync log (`ripmail refresh --verbose`).
    pub verbose: bool,
}

/// Per-mailbox metrics when `ripmail refresh` runs multiple accounts.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncMailboxSummary {
    pub id: String,
    pub email: String,
    pub synced: u32,
    pub messages_fetched: u32,
    pub bytes_downloaded: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncResult {
    pub synced: u32,
    pub messages_fetched: u32,
    pub bytes_downloaded: u64,
    pub duration_ms: u64,
    pub bandwidth_bytes_per_sec: f64,
    pub messages_per_minute: f64,
    pub log_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub early_exit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gmail_api_partial: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_message_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mailboxes: Option<Vec<SyncMailboxSummary>>,
}

impl SyncResult {
    pub(crate) fn empty(duration_ms: u64, log_path: String) -> Self {
        Self {
            synced: 0,
            messages_fetched: 0,
            bytes_downloaded: 0,
            duration_ms,
            bandwidth_bytes_per_sec: 0.0,
            messages_per_minute: 0.0,
            log_path,
            early_exit: None,
            gmail_api_partial: None,
            new_message_ids: None,
            mailboxes: None,
        }
    }
}

/// Resolve mailbox name (Gmail All Mail vs INBOX).
pub fn resolve_sync_mailbox(cfg: &Config) -> String {
    resolve_sync_folder_for_host(&cfg.sync_mailbox, &cfg.imap_host)
}

/// Resolve IMAP folder for a specific host.  Use this in per-mailbox loops
/// where each account may have a different IMAP provider.
pub fn resolve_sync_folder_for_host(sync_mailbox_cfg: &str, imap_host: &str) -> String {
    if !sync_mailbox_cfg.trim().is_empty() {
        return sync_mailbox_cfg.to_owned();
    }
    if imap_host.to_lowercase().contains("gmail") {
        "[Gmail]/All Mail".into()
    } else {
        "INBOX".into()
    }
}

/// True when STATUS says there is nothing new after `last_uid` (forward refresh only).
pub fn should_early_exit_forward(
    force: bool,
    state: Option<(u32, u32)>,
    status: &ImapStatusData,
) -> bool {
    if force {
        return false;
    }
    let Some((st_v, st_last)) = state else {
        return false;
    };
    let Some(un) = status.uid_next else {
        return false;
    };
    let Some(sv) = status.uid_validity else {
        return false;
    };
    if sv != st_v {
        return false;
    }
    un.saturating_sub(1) <= st_last
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

fn load_sync_state(
    conn: &Connection,
    mailbox_id: &str,
    folder: &str,
) -> rusqlite::Result<Option<(u32, u32)>> {
    conn.query_row(
        "SELECT uidvalidity, last_uid FROM sync_state WHERE source_id = ?1 AND folder = ?2",
        [mailbox_id, folder],
        |row| Ok((row.get::<_, i64>(0)? as u32, row.get::<_, i64>(1)? as u32)),
    )
    .optional()
}

fn max_uid_messages(conn: &Connection, mailbox_id: &str, folder: &str) -> rusqlite::Result<i64> {
    let v: Option<i64> = conn.query_row(
        "SELECT MAX(uid) FROM messages WHERE source_id = ?1 AND folder = ?2",
        [mailbox_id, folder],
        |row| row.get(0),
    )?;
    Ok(v.unwrap_or(0))
}

fn existing_uids_set(
    conn: &Connection,
    mailbox_id: &str,
    folder: &str,
) -> rusqlite::Result<HashSet<u32>> {
    let mut stmt = conn.prepare("SELECT uid FROM messages WHERE source_id = ?1 AND folder = ?2")?;
    let rows = stmt.query_map([mailbox_id, folder], |row| row.get::<_, i64>(0))?;
    rows.map(|r| r.map(|uid| uid as u32)).collect()
}

fn label_excluded(labels: &[String], exclude_lower: &HashSet<String>) -> bool {
    labels
        .iter()
        .any(|l| exclude_lower.contains(&l.to_lowercase()))
}

fn uid_fetch_with_retries(
    transport: &mut dyn SyncImapTransport,
    uid_csv: &str,
    logger: &SyncFileLogger,
    batch_len: usize,
) -> Result<Vec<FetchedMessage>, RunSyncError> {
    let policy = RetryPolicy::uid_fetch_batch();
    let fetched = retry_with_backoff(
        &policy,
        || transport.uid_fetch_rfc822_batch(uid_csv),
        |attempt, err, _sleep| {
            let recommended_timeout = timeout_ms_for_fetch_all_attempt(batch_len, attempt as u32);
            let es = err.to_string();
            logger.warn(
                "UID FETCH batch failed",
                Some(
                    format!(
                        "{{\"attempt\":{attempt},\"recommendedTimeoutMs\":{recommended_timeout},\"err\":\"{es}\"}}"
                    )
                    .as_str(),
                ),
            );
        },
    );
    match fetched {
        Ok(v) => Ok(v),
        Err(e) => {
            let s = e.to_string();
            if s.contains("timed out") || s.contains("timeout") {
                Err(RunSyncError::FetchTimeout)
            } else {
                Err(e)
            }
        }
    }
}

fn progress_line(options: &SyncOptions, logger: &SyncFileLogger, msg: &str) {
    if options.progress_stderr {
        eprintln!("ripmail: {msg}");
    }
    logger.info(msg, None);
}

/// Before slow `uid_search_keys` calls so `sync.log` shows activity during long IMAP waits.
fn log_imap_uid_search_start(logger: &SyncFileLogger, kind: &str, query: &str) {
    logger.info(&format!("UID SEARCH ({kind}): {query}"), None);
}

/// Mirror Node `logSyncMetrics`: structured "Sync complete" + one-line "Sync metrics" for agents tailing `sync.log`.
fn log_sync_metrics(logger: &SyncFileLogger, r: &SyncResult) {
    let complete = serde_json::json!({
        "synced": r.synced,
        "messagesFetched": r.messages_fetched,
        "bytesDownloaded": r.bytes_downloaded,
        "durationMs": r.duration_ms,
        "bandwidthBytesPerSec": r.bandwidth_bytes_per_sec.round() as i64,
        "messagesPerMinute": r.messages_per_minute.round() as i64,
    })
    .to_string();
    logger.info("Sync complete", Some(&complete));

    let duration_sec = (r.duration_ms as f64) / 1000.0;
    let down = format_bytes_u64(r.bytes_downloaded);
    let bandwidth = format_bytes_per_sec(r.bandwidth_bytes_per_sec);
    let throughput = format!("{} msg/min", r.messages_per_minute.round() as i64);
    let summary = format!(
        "{} new, {} fetched | {} down | {} | {} | {duration_sec:.2}s",
        r.synced, r.messages_fetched, down, bandwidth, throughput
    );
    let metrics_line = serde_json::json!({ "summary": summary }).to_string();
    logger.info("Sync metrics", Some(&metrics_line));
    let finished = serde_json::json!({ "outcome": "ok", "success": true }).to_string();
    logger.info("Sync run finished", Some(&finished));
}

pub(crate) fn log_sync_metrics_public(logger: &SyncFileLogger, r: &SyncResult) {
    log_sync_metrics(logger, r);
}

fn format_bytes_u64(n: u64) -> String {
    format_bytes_f64(n as f64)
}

fn format_bytes_f64(n: f64) -> String {
    if n >= 1024.0 * 1024.0 {
        format!("{:.2} MB", n / (1024.0 * 1024.0))
    } else if n >= 1024.0 {
        format!("{:.2} KB", n / 1024.0)
    } else {
        format!("{:.0} B", n)
    }
}

fn format_bytes_per_sec(n: f64) -> String {
    format!("{}/s", format_bytes_f64(n))
}

fn ensure_maildir(maildir: &Path) -> Result<(), RunSyncError> {
    for sub in ["cur", "new", "tmp", "attachments"] {
        std::fs::create_dir_all(maildir.join(sub))?;
    }
    Ok(())
}

fn ymd_minus_one_day(ymd: &str) -> Option<String> {
    let d = chrono::NaiveDate::parse_from_str(ymd, "%Y-%m-%d").ok()?;
    d.checked_sub_days(chrono::Days::new(1))
        .map(|x| x.format("%Y-%m-%d").to_string())
}

struct RunSyncLockedPrelude {
    exclude_lower: HashSet<String>,
    log_path_str: String,
}

enum RunSyncPreAcquire {
    Done(SyncResult),
    AcquireLock(RunSyncLockedPrelude),
}

/// Parse + persist messages from one UID FETCH result; checkpoints `sync_state.last_uid`.
///
/// Runs one SQLite transaction per batch. Logs `Sync UID batch timings` when `fetch_wall_ms` is set.
#[allow(clippy::too_many_arguments)]
fn apply_fetched_uid_batch(
    options: &SyncOptions,
    logger: &SyncFileLogger,
    conn: &mut Connection,
    maildir_path: &Path,
    exclude_lower: &HashSet<String>,
    chunk: &[u32],
    fetched: Vec<FetchedMessage>,
    imap_folder: &str,
    mailbox_id: &str,
    uidvalidity: u32,
    batch_index_one_based: usize,
    total_batches: usize,
    checkpoint_uid: &mut u32,
    synced: &mut u32,
    messages_fetched: &mut u32,
    bytes_downloaded: &mut u64,
    earliest_date: &mut Option<String>,
    latest_date: &mut Option<String>,
    new_message_ids: &mut Vec<String>,
    fetch_wall_ms: Option<u128>,
) -> Result<(), RunSyncError> {
    progress_line(
        options,
        logger,
        &format!(
            "Fetching batch {}/{} ({} message(s))…",
            batch_index_one_based,
            total_batches,
            chunk.len()
        ),
    );
    if options.verbose {
        let uid_min = chunk.iter().copied().min();
        let uid_max = chunk.iter().copied().max();
        let b = serde_json::json!({
            "batch": batch_index_one_based,
            "of": total_batches,
            "uidsInBatch": chunk.len(),
            "uidMin": uid_min,
            "uidMax": uid_max,
        })
        .to_string();
        logger.debug("UID FETCH batch", Some(&b));
    }

    let t_ingest = Instant::now();
    {
        let tx = conn.transaction()?;
        for msg in fetched {
            *messages_fetched += 1;
            *bytes_downloaded += msg.raw.len() as u64;

            if label_excluded(&msg.labels, exclude_lower) {
                continue;
            }

            let mut parsed = parse_raw_message(&msg.raw);

            let dup: Option<i32> = tx
                .query_row(
                    "SELECT 1 FROM messages WHERE message_id = ?1",
                    [&parsed.message_id],
                    |row| row.get(0),
                )
                .optional()?;
            if dup.is_some() {
                continue;
            }

            let basename = maildir_basename(msg.uid, &parsed.message_id);
            let cur = maildir_path.join("cur");
            let written = write_maildir_message(&cur, &basename, &msg.raw, &msg.labels)?;
            let labels_json = serde_json::to_string(&msg.labels).unwrap_or_else(|_| "[]".into());

            let inserted = persist_message(
                &tx,
                &mut parsed,
                imap_folder,
                mailbox_id,
                msg.uid as i64,
                &labels_json,
                &written.relative_raw_path,
            )?;
            if inserted {
                *synced += 1;
                persist_attachments_from_parsed(
                    &tx,
                    &parsed.message_id,
                    &parsed.attachments,
                    maildir_path,
                )?;
                if new_message_ids.len() < NEW_MESSAGE_IDS_CAP {
                    new_message_ids.push(parsed.message_id.clone());
                }
                let d = &parsed.date;
                *earliest_date = Some(match earliest_date.as_ref() {
                    Some(e) if e.as_str() < d.as_str() => e.clone(),
                    _ => d.clone(),
                });
                *latest_date = Some(match latest_date.as_ref() {
                    Some(l) if l.as_str() > d.as_str() => l.clone(),
                    _ => d.clone(),
                });
            }
        }

        let batch_max = *chunk.iter().max().unwrap_or(&0);
        if batch_max > *checkpoint_uid {
            *checkpoint_uid = batch_max;
            tx.execute(
                "INSERT OR REPLACE INTO sync_state (source_id, folder, uidvalidity, last_uid) VALUES (?1, ?2, ?3, ?4)",
                params![mailbox_id, imap_folder, uidvalidity as i64, *checkpoint_uid as i64],
            )?;
        }
        tx.commit()?;
    }
    let ingest_wall_ms = t_ingest.elapsed().as_millis();
    if let Some(fw) = fetch_wall_ms {
        let timing = serde_json::json!({
            "batch": batch_index_one_based,
            "fetchWaitMs": fw,
            "ingestMs": ingest_wall_ms,
        })
        .to_string();
        logger.info("Sync UID batch timings", Some(&timing));
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_sync_pre_acquire(
    conn: &mut Connection,
    logger: &SyncFileLogger,
    maildir_path: &Path,
    exclude_labels: &[String],
    options: &SyncOptions,
    start: Instant,
    pid_u32: u32,
    _pid: i64,
) -> Result<RunSyncPreAcquire, RunSyncError> {
    let log_path_str = logger.log_path().to_string_lossy().to_string();
    logger.write_separator(pid_u32);
    let exclude_lower: HashSet<String> = exclude_labels.iter().map(|s| s.to_lowercase()).collect();

    let lock_row = read_sync_lock_row_optional(conn, options.kind)?;

    if is_sync_lock_held(lock_row.as_ref()) {
        logger.info("Sync already running, exiting", None);
        let duration_ms = start.elapsed().as_millis() as u64;
        return Ok(RunSyncPreAcquire::Done(SyncResult::empty(
            duration_ms,
            log_path_str,
        )));
    }

    ensure_maildir(maildir_path)?;

    let from_ymd = options.since_ymd.as_str();
    let lane_id = options.kind.row_id();
    conn.execute(
        "UPDATE sync_summary SET target_start_date = ?1,
         sync_start_earliest_date = (SELECT earliest_synced_date FROM sync_summary WHERE id = 1)
         WHERE id = ?2",
        params![from_ymd, lane_id],
    )?;

    Ok(RunSyncPreAcquire::AcquireLock(RunSyncLockedPrelude {
        exclude_lower,
        log_path_str,
    }))
}

#[allow(clippy::too_many_arguments)]
fn run_sync_imap_phase(
    transport: &mut dyn SyncImapTransport,
    conn: &mut Connection,
    logger: &SyncFileLogger,
    mailbox_id: &str,
    imap_folder: &str,
    maildir_path: &Path,
    exclude_lower: &HashSet<String>,
    options: &SyncOptions,
    start: Instant,
    log_path_str: String,
    pid: i64,
    parallel_imap_connector: Option<ParallelImapConnect>,
) -> Result<SyncResult, RunSyncError> {
    let from_ymd = options.since_ymd.as_str();
    let state = load_sync_state(conn, mailbox_id, imap_folder)?;

    let status = match transport.mailbox_status(imap_folder) {
        Ok(s) => s,
        Err(e) => {
            logger.warn("STATUS failed, continuing", Some(&e.to_string()));
            ImapStatusData::default()
        }
    };

    if options.direction == SyncDirection::Forward
        && should_early_exit_forward(options.force, state, &status)
    {
        conn.execute(
            "UPDATE sync_summary SET last_sync_at = datetime('now') WHERE id = 1",
            [],
        )?;
        release_lock(conn, Some(pid), options.kind)?;
        let duration_ms = start.elapsed().as_millis() as u64;
        let mut r = SyncResult::empty(duration_ms, log_path_str.clone());
        r.early_exit = Some(true);
        logger.info("Early exit: no new messages", None);
        log_sync_metrics(logger, &r);
        progress_line(
            options,
            logger,
            "No new mail (server reports nothing after last sync).",
        );
        return Ok(r);
    }

    progress_line(options, logger, "Opening mailbox…");
    let uidvalidity = transport.examine_mailbox(imap_folder)?;
    if options.verbose {
        let ex = serde_json::json!({
            "folder": imap_folder,
            "uidValidity": uidvalidity,
        })
        .to_string();
        logger.debug("Examined mailbox", Some(&ex));
    }
    progress_line(
        options,
        logger,
        "Mailbox open; searching for messages to sync…",
    );
    let state_u32 = state;

    let mut uids: Vec<u32> = Vec::new();
    let mut is_expanding_range_backward = false;

    // Forward with valid `sync_state`: UID range only (empty UIDs ⇒ no date fallback).
    let mut forward_checkpoint_only = false;
    if options.direction == SyncDirection::Forward {
        if let Some((st_v, st_last)) = state_u32 {
            if st_last > 0 && st_v == uidvalidity {
                let q = format!("UID {}", forward_uid_range(st_last as i64));
                log_imap_uid_search_start(logger, "forward_checkpoint", &q);
                uids = transport.uid_search_keys(&q)?;
                logger.info(
                    "Forward sync (checkpoint)",
                    Some(format!("{{\"uids\":{}}}", uids.len()).as_str()),
                );
                forward_checkpoint_only = true;
            }
        }
    }

    if !forward_checkpoint_only {
        if uids.is_empty() && options.direction == SyncDirection::Forward {
            let local_max = max_uid_messages(conn, mailbox_id, imap_folder)?;
            if local_max > 0 && uidvalidity > 0 {
                let checkpoint_ok = state_u32.map(|(v, _)| v == uidvalidity).unwrap_or(true);
                if checkpoint_ok {
                    let q = format!("UID {}", forward_uid_range(local_max));
                    log_imap_uid_search_start(logger, "forward_max_recovery", &q);
                    uids = transport.uid_search_keys(&q)?;
                    logger.info(
                        "Forward sync (MAX uid recovery)",
                        Some(
                            format!("{{\"localMax\":{local_max},\"uids\":{}}}", uids.len())
                                .as_str(),
                        ),
                    );
                }
            }
        }

        if uids.is_empty() {
            let imap_since = ymd_to_imap_since(from_ymd).map_err(RunSyncError::Config)?;
            let since_date = chrono::NaiveDate::parse_from_str(from_ymd, "%Y-%m-%d")
                .map_err(|e| RunSyncError::Config(e.to_string()))?;

            let mut effective_since_ymd = from_ymd.to_string();

            if options.direction == SyncDirection::Backward {
                if let Some(oldest_s) =
                    oldest_message_date_for_folder(conn, mailbox_id, imap_folder)?
                {
                    let oldest_day: String = oldest_s.chars().take(10).collect();
                    if oldest_day.len() == 10 && oldest_day.as_str() > from_ymd {
                        is_expanding_range_backward = true;
                        effective_since_ymd = from_ymd.to_string();
                    }
                }
            }

            let imap_eff = ymd_to_imap_since(&effective_since_ymd).map_err(RunSyncError::Config)?;

            let since_q = format!("SINCE {imap_eff}");
            log_imap_uid_search_start(logger, "since_date", &since_q);
            uids = transport.uid_search_keys(&since_q)?;
            logger.info(
                "Date-based UID search",
                Some(
                    format!(
                        "{{\"count\":{},\"since\":\"{}\",\"backward\":{}}}",
                        uids.len(),
                        effective_since_ymd,
                        options.direction == SyncDirection::Backward
                    )
                    .as_str(),
                ),
            );

            if options.direction == SyncDirection::Backward {
                if let Some((st_v, st_last)) = state_u32 {
                    if st_last > 0 && st_v == uidvalidity {
                        if is_expanding_range_backward {
                            let existing = existing_uids_set(conn, mailbox_id, imap_folder)?;
                            let before = uids.len();
                            uids.retain(|u| !existing.contains(u));
                            logger.info(
                                "Filtered UIDs (range expand)",
                                Some(
                                    format!("{{\"before\":{before},\"after\":{}}}", uids.len())
                                        .as_str(),
                                ),
                            );
                        } else {
                            let all_le = !uids.is_empty() && uids.iter().all(|&u| u <= st_last);
                            if all_le {
                                if let Some(oldest_s) =
                                    oldest_message_date_for_folder(conn, mailbox_id, imap_folder)?
                                {
                                    let oldest_day: String = oldest_s.chars().take(10).collect();
                                    if let Some(prev) = ymd_minus_one_day(&oldest_day) {
                                        if chrono::NaiveDate::parse_from_str(&prev, "%Y-%m-%d")
                                            .map(|d| d >= since_date)
                                            .unwrap_or(false)
                                        {
                                            let before_imap = ymd_to_imap_since(&prev)
                                                .map_err(RunSyncError::Config)?;
                                            let q =
                                                format!("SINCE {imap_since} BEFORE {before_imap}");
                                            log_imap_uid_search_start(
                                                logger,
                                                "backward_window",
                                                &q,
                                            );
                                            uids = transport.uid_search_keys(&q)?;
                                        } else {
                                            uids.clear();
                                        }
                                    }
                                }
                            } else {
                                let before = uids.len();
                                uids.retain(|&u| u > st_last);
                                if before != uids.len() {
                                    logger.info(
                                        "Filtered UIDs (last_uid)",
                                        Some(
                                            format!(
                                                "{{\"before\":{before},\"after\":{}}}",
                                                uids.len()
                                            )
                                            .as_str(),
                                        ),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    uids.sort_unstable_by(|a, b| b.cmp(a));

    if options.verbose && !uids.is_empty() {
        let uid_min = uids.iter().copied().min();
        let uid_max = uids.iter().copied().max();
        let q = serde_json::json!({
            "count": uids.len(),
            "uidMin": uid_min,
            "uidMax": uid_max,
        })
        .to_string();
        logger.debug("UID work queue (newest-first)", Some(&q));
    }

    if uids.is_empty() {
        progress_line(options, logger, "No messages to download for this run.");
        conn.execute(
            "UPDATE sync_summary SET last_sync_at = datetime('now') WHERE id = 1",
            [],
        )?;
        release_lock(conn, Some(pid), options.kind)?;
        let duration_ms = start.elapsed().as_millis() as u64;
        let r = SyncResult::empty(duration_ms, log_path_str.clone());
        log_sync_metrics(logger, &r);
        return Ok(r);
    }

    progress_line(
        options,
        logger,
        &format!("Downloading {} message(s)…", uids.len()),
    );

    let batch_size = effective_batch_sizes(options.direction);

    let mut synced = 0u32;
    let mut messages_fetched = 0u32;
    let mut bytes_downloaded = 0u64;
    let mut earliest_date: Option<String> = None;
    let mut latest_date: Option<String> = None;
    let mut new_message_ids: Vec<String> = Vec::new();

    let mut checkpoint_uid = state_u32
        .filter(|(v, _)| *v == uidvalidity)
        .map(|(_, u)| u)
        .unwrap_or(0);

    let chunks_vec: Vec<Vec<u32>> = uids.chunks(batch_size).map(|c| c.to_vec()).collect();
    let total_batches = chunks_vec.len();

    if let Some(connector_arc) = parallel_imap_connector {
        let n_workers = effective_parallel_fetch_connections()
            .min(total_batches)
            .max(1);
        let max_pipeline = max_parallel_pipeline_slots(n_workers);

        logger.info(
            "IMAP parallel UID FETCH",
            Some(
                &serde_json::json!({
                    "sessions": n_workers,
                    "batchSize": batch_size,
                    "batches": total_batches,
                    "maxPipelineSlots": max_pipeline,
                })
                .to_string(),
            ),
        );

        let (fetch_pool, complete_rx) =
            spawn_parallel_imap_fetch_pool(n_workers, connector_arc, imap_folder, logger)?;

        let mut next_consume = 0usize;
        let mut next_dispatch = 0usize;
        let mut pending: BTreeMap<usize, (Vec<FetchedMessage>, u128)> = BTreeMap::new();
        let mut worker_idle = vec![true; n_workers];
        let mut in_flight = 0usize;

        let download_result = (|| -> Result<(), RunSyncError> {
            while next_consume < total_batches || in_flight > 0 {
                if crate::runtime_limits::shutdown_requested() {
                    return Err(RunSyncError::Interrupted);
                }
                if crate::runtime_limits::wall_clock_expired() {
                    return Err(RunSyncError::WallClockLimit);
                }

                while next_dispatch < total_batches
                    && next_dispatch.saturating_sub(next_consume) < max_pipeline
                {
                    let Some(slot) = worker_idle.iter().position(|&x| x) else {
                        break;
                    };
                    worker_idle[slot] = false;
                    let bi = next_dispatch;
                    fetch_pool[slot]
                        .task_tx
                        .send(Some((bi, chunks_vec[bi].clone())))
                        .map_err(|_| {
                            RunSyncError::Imap("parallel UID FETCH task send failed".into())
                        })?;
                    next_dispatch += 1;
                    in_flight += 1;
                }

                if next_consume >= total_batches && in_flight == 0 {
                    break;
                }

                let done = complete_rx.recv().map_err(|_| {
                    RunSyncError::Imap("parallel UID FETCH completion channel closed".into())
                })?;
                worker_idle[done.slot] = true;
                in_flight -= 1;
                let (messages, fw) = done.payload?;
                pending.insert(done.batch_index, (messages, fw));

                while let Some((messages, fw)) = pending.remove(&next_consume) {
                    apply_fetched_uid_batch(
                        options,
                        logger,
                        conn,
                        maildir_path,
                        exclude_lower,
                        &chunks_vec[next_consume],
                        messages,
                        imap_folder,
                        mailbox_id,
                        uidvalidity,
                        next_consume + 1,
                        total_batches,
                        &mut checkpoint_uid,
                        &mut synced,
                        &mut messages_fetched,
                        &mut bytes_downloaded,
                        &mut earliest_date,
                        &mut latest_date,
                        &mut new_message_ids,
                        Some(fw),
                    )?;
                    next_consume += 1;
                }
            }
            Ok(())
        })();

        shutdown_parallel_imap_fetch_pool(fetch_pool);

        if let Err(e) = download_result {
            if matches!(&e, RunSyncError::Interrupted | RunSyncError::WallClockLimit) {
                let _ = release_lock(conn, Some(pid), options.kind);
            }
            return Err(e);
        }
    } else {
        for (bi, chunk) in uids.chunks(batch_size).enumerate() {
            if crate::runtime_limits::shutdown_requested() {
                let _ = release_lock(conn, Some(pid), options.kind);
                return Err(RunSyncError::Interrupted);
            }
            if crate::runtime_limits::wall_clock_expired() {
                let _ = release_lock(conn, Some(pid), options.kind);
                return Err(RunSyncError::WallClockLimit);
            }
            let uid_csv: String = chunk
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let t_fetch = Instant::now();
            let fetched = uid_fetch_with_retries(transport, &uid_csv, logger, chunk.len())?;
            let fetch_ms = t_fetch.elapsed().as_millis();
            apply_fetched_uid_batch(
                options,
                logger,
                conn,
                maildir_path,
                exclude_lower,
                chunk,
                fetched,
                imap_folder,
                mailbox_id,
                uidvalidity,
                bi + 1,
                total_batches,
                &mut checkpoint_uid,
                &mut synced,
                &mut messages_fetched,
                &mut bytes_downloaded,
                &mut earliest_date,
                &mut latest_date,
                &mut new_message_ids,
                Some(fetch_ms),
            )?;
        }
    }

    conn.execute(
        "UPDATE sync_summary SET
            earliest_synced_date = COALESCE(?1, earliest_synced_date),
            latest_synced_date = COALESCE(?2, latest_synced_date),
            total_messages = (SELECT COUNT(*) FROM messages),
            last_sync_at = datetime('now')
         WHERE id = 1",
        params![earliest_date, latest_date],
    )?;
    if options.kind == SyncKind::Backfill {
        conn.execute(
            "UPDATE sync_summary SET last_sync_at = datetime('now') WHERE id = 2",
            [],
        )?;
    }
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
        log_path: log_path_str.clone(),
        early_exit: None,
        gmail_api_partial: None,
        new_message_ids: if new_message_ids.is_empty() {
            None
        } else {
            Some(new_message_ids)
        },
        mailboxes: None,
    };
    log_sync_metrics(logger, &r);
    Ok(r)
}

/// Run one sync pass using the given transport (real IMAP or test fake).
#[allow(clippy::too_many_arguments)]
pub fn run_sync<T: SyncImapTransport>(
    transport: &mut T,
    conn: &mut Connection,
    logger: &SyncFileLogger,
    mailbox_id: &str,
    imap_folder: &str,
    maildir_path: &Path,
    exclude_labels: &[String],
    options: &SyncOptions,
) -> Result<SyncResult, RunSyncError> {
    let start = Instant::now();
    let pid_u32 = std::process::id();
    let pid = pid_u32 as i64;

    let prelude = match run_sync_pre_acquire(
        conn,
        logger,
        maildir_path,
        exclude_labels,
        options,
        start,
        pid_u32,
        pid,
    )? {
        RunSyncPreAcquire::Done(r) => return Ok(r),
        RunSyncPreAcquire::AcquireLock(p) => p,
    };

    let lock_result = acquire_lock(conn, pid, options.kind)?;
    if !lock_result.acquired {
        logger.info("Could not acquire sync lock", None);
        let duration_ms = start.elapsed().as_millis() as u64;
        return Ok(SyncResult::empty(duration_ms, prelude.log_path_str.clone()));
    }
    if lock_result.taken_over {
        logger.info("Recovered stale sync lock", None);
    }

    let sync_result = run_sync_imap_phase(
        transport,
        conn,
        logger,
        mailbox_id,
        imap_folder,
        maildir_path,
        &prelude.exclude_lower,
        options,
        start,
        prelude.log_path_str.clone(),
        pid,
        None,
    );

    if sync_result.is_err() {
        let _ = release_lock(conn, Some(pid), options.kind);
    }

    sync_result
}

/// Same as [`run_sync`], but overlaps TCP/TLS connect with SQLite lock acquisition (foreground paths).
///
/// When `gmail_api_refresh` is set for an OAuth Gmail mailbox, attempts Gmail REST partial sync first
/// (`history.list`); on success releases the lock without opening IMAP.
#[allow(clippy::too_many_arguments)]
pub fn run_sync_with_parallel_imap_connect<F>(
    conn: &mut Connection,
    logger: &SyncFileLogger,
    mailbox_id: &str,
    imap_folder: &str,
    maildir_path: &Path,
    exclude_labels: &[String],
    options: &SyncOptions,
    gmail_api_refresh: Option<&super::gmail_api_refresh::GmailApiRefreshContext>,
    connect: F,
) -> Result<SyncResult, RunSyncError>
where
    F: Fn() -> Result<Session<imap::Connection>, RunSyncError> + Send + Sync + 'static,
{
    let connect: ParallelImapConnect = Arc::new(connect);
    use std::sync::mpsc;

    let start = Instant::now();
    let pid_u32 = std::process::id();
    let pid = pid_u32 as i64;

    let prelude = match run_sync_pre_acquire(
        conn,
        logger,
        maildir_path,
        exclude_labels,
        options,
        start,
        pid_u32,
        pid,
    )? {
        RunSyncPreAcquire::Done(r) => return Ok(r),
        RunSyncPreAcquire::AcquireLock(p) => p,
    };

    let lock_result = acquire_lock(conn, pid, options.kind)?;
    if !lock_result.acquired {
        logger.info("Could not acquire sync lock", None);
        let duration_ms = start.elapsed().as_millis() as u64;
        return Ok(SyncResult::empty(duration_ms, prelude.log_path_str.clone()));
    }
    if lock_result.taken_over {
        logger.info("Recovered stale sync lock", None);
    }

    if let Some(ctx) = gmail_api_refresh {
        use super::gmail_api_refresh::{try_gmail_api_incremental_refresh, GmailApiAttempt};
        match try_gmail_api_incremental_refresh(
            conn,
            logger,
            ctx,
            mailbox_id,
            imap_folder,
            maildir_path,
            &prelude.exclude_lower,
            options,
            start,
            &prelude.log_path_str,
            pid,
        ) {
            Ok(GmailApiAttempt::Completed(r)) => return Ok(r),
            Ok(GmailApiAttempt::Skipped | GmailApiAttempt::Fallback) => {}
            Err(e) => {
                let _ = release_lock(conn, Some(pid), options.kind);
                return Err(e);
            }
        }
    }

    let (tx, rx) = mpsc::sync_channel(1);
    {
        let c = Arc::clone(&connect);
        std::thread::spawn(move || {
            let _ = tx.send(c());
        });
    }

    let connect_result = match rx.recv_timeout(crate::runtime_limits::imap_connect_timeout()) {
        Ok(r) => r,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            drop(rx);
            let _ = release_lock(conn, Some(pid), options.kind);
            return Err(RunSyncError::Imap(
                "IMAP connect timed out (RIPMAIL_IMAP_CONNECT_TIMEOUT_SECS)".into(),
            ));
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            let _ = release_lock(conn, Some(pid), options.kind);
            return Err(RunSyncError::Imap(
                "IMAP connect thread disconnected".into(),
            ));
        }
    };
    let mut session = connect_result?;

    let mut transport = super::transport::RealImapTransport {
        session: &mut session,
    };
    let sync_result = run_sync_imap_phase(
        &mut transport,
        conn,
        logger,
        mailbox_id,
        imap_folder,
        maildir_path,
        &prelude.exclude_lower,
        options,
        start,
        prelude.log_path_str.clone(),
        pid,
        Some(Arc::clone(&connect)),
    );

    if sync_result.is_err() {
        let _ = release_lock(conn, Some(pid), options.kind);
    }

    sync_result
}

/// Build [`SyncOptions`] after resolving `since` CLI/config into `YYYY-MM-DD`.
pub fn resolve_sync_since_ymd(
    cfg: &Config,
    since_cli: Option<&str>,
) -> Result<String, RunSyncError> {
    let spec = since_cli
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(cfg.sync_default_since.as_str());
    parse_since_to_date(spec).map_err(RunSyncError::Config)
}

#[cfg(test)]
mod resolve_sync_mailbox_tests {
    use super::resolve_sync_mailbox;
    use crate::config::{resolve_smtp_settings, Config};

    fn gmail_cfg_empty_sync_mailbox() -> Config {
        let smtp = resolve_smtp_settings("imap.gmail.com", None).unwrap();
        Config {
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            imap_user: "a@b.com".into(),
            imap_aliases: vec![],
            imap_password: "secret".into(),
            imap_auth: crate::config::MailboxImapAuthKind::AppPassword,
            smtp,
            sync_default_since: "1y".into(),
            sync_mailbox: String::new(),
            sync_exclude_labels: vec![],
            attachments_cache_extracted_text: false,
            inbox_default_window: "24h".into(),
            inbox_bootstrap_archive_older_than: "1d".into(),
            mailbox_management_enabled: false,
            mailbox_management_allow_archive: false,
            ripmail_home: std::path::PathBuf::from("/tmp"),
            data_dir: std::path::PathBuf::from("/tmp"),
            db_path: std::path::PathBuf::from("/tmp/z.db"),
            maildir_path: std::path::PathBuf::from("/tmp/m"),
            message_path_root: std::path::PathBuf::from("/tmp"),
            source_id: "a_b_com".into(),
            resolved_sources: vec![],
        }
    }

    /// `get_imap_server_status` must use this same resolution (see BUG-039).
    #[test]
    fn empty_sync_mailbox_gmail_defaults_to_all_mail() {
        let cfg = gmail_cfg_empty_sync_mailbox();
        assert_eq!(resolve_sync_mailbox(&cfg), "[Gmail]/All Mail");
    }

    #[test]
    fn explicit_sync_mailbox_is_preserved() {
        let mut cfg = gmail_cfg_empty_sync_mailbox();
        cfg.sync_mailbox = "INBOX".into();
        assert_eq!(resolve_sync_mailbox(&cfg), "INBOX");
    }

    #[test]
    fn non_gmail_host_defaults_to_inbox() {
        use super::resolve_sync_folder_for_host;
        assert_eq!(
            resolve_sync_folder_for_host("", "mail.privateemail.com"),
            "INBOX"
        );
    }

    #[test]
    fn per_host_gmail_defaults_to_all_mail() {
        use super::resolve_sync_folder_for_host;
        assert_eq!(
            resolve_sync_folder_for_host("", "imap.gmail.com"),
            "[Gmail]/All Mail"
        );
    }

    #[test]
    fn per_host_explicit_overrides() {
        use super::resolve_sync_folder_for_host;
        assert_eq!(
            resolve_sync_folder_for_host("Archive", "mail.privateemail.com"),
            "Archive"
        );
    }
}

#[cfg(test)]
mod fetch_pipeline_scheduler_tests {
    //! Invariants for the parallel UID FETCH pipeline (ordered checkpoint ingest + bounded prefetch).

    use std::collections::{BTreeMap, BTreeSet};

    use super::max_parallel_pipeline_slots_with_extra;

    #[test]
    fn pipeline_slots_floor_is_twice_worker_count_without_extra() {
        assert_eq!(max_parallel_pipeline_slots_with_extra(1, 0), 2);
        assert_eq!(max_parallel_pipeline_slots_with_extra(3, 0), 6);
        assert_eq!(max_parallel_pipeline_slots_with_extra(8, 0), 16);
    }

    #[test]
    fn pipeline_slots_adds_extra_when_above_twice_workers() {
        assert_eq!(max_parallel_pipeline_slots_with_extra(3, 10), 13);
        assert_eq!(max_parallel_pipeline_slots_with_extra(8, 16), 24);
    }

    fn simulate_wave(
        total_batches: usize,
        n_workers: usize,
        max_pipeline: usize,
        completion_order: &[usize],
    ) {
        let mut next_consume = 0usize;
        let mut next_dispatch = 0usize;
        let mut pending: BTreeMap<usize, ()> = BTreeMap::new();
        let mut worker_idle = vec![true; n_workers];
        let mut in_flight = 0usize;
        let mut active: Vec<Option<usize>> = vec![None; n_workers];
        let mut active_set: BTreeSet<usize> = BTreeSet::new();

        let mut ci = 0usize;
        while next_consume < total_batches || in_flight > 0 {
            while next_dispatch < total_batches
                && next_dispatch.saturating_sub(next_consume) < max_pipeline
            {
                let Some(slot) = worker_idle.iter().position(|&x| x) else {
                    break;
                };
                worker_idle[slot] = false;
                let bi = next_dispatch;
                active[slot] = Some(bi);
                active_set.insert(bi);
                next_dispatch += 1;
                in_flight += 1;
            }

            assert!(
                in_flight <= n_workers,
                "in_flight={in_flight} workers={n_workers}"
            );

            if next_consume >= total_batches && in_flight == 0 {
                break;
            }

            assert!(ci < completion_order.len(), "completion_order too short");
            let bi = completion_order[ci];
            ci += 1;
            assert!(
                active_set.remove(&bi),
                "completed batch {bi} that was not in flight"
            );
            let slot = (0..n_workers)
                .find(|&s| active[s] == Some(bi))
                .expect("slot for batch");
            worker_idle[slot] = true;
            active[slot] = None;
            in_flight -= 1;

            pending.insert(bi, ());
            while pending.remove(&next_consume).is_some() {
                next_consume += 1;
            }
        }

        assert_eq!(next_consume, total_batches, "did not consume all batches");
        assert_eq!(ci, completion_order.len());
    }

    #[test]
    fn out_of_order_completion_drains_in_batch_index_order() {
        simulate_wave(6, 3, 12, &[1, 2, 0, 4, 3, 5]);
    }

    #[test]
    fn reverse_completion_order_still_finishes() {
        simulate_wave(5, 2, 10, &[1, 0, 3, 2, 4]);
    }

    #[test]
    fn single_worker_strict_pipeline() {
        simulate_wave(4, 1, 4, &[0, 1, 2, 3]);
    }
}
