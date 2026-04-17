use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

use crate::cli::args::InboxArgs;
use crate::cli::util::ripmail_home_path;
use crate::cli::CliResult;
use ripmail::{
    build_review_json, connect_imap_for_resolved_mailbox, count_indexed_messages_simple_window,
    count_unarchived_messages_by_mailbox, db, google_oauth_credentials_present, inbox_json_hints,
    inbox_rules_fingerprint_for_scope, mailbox_ids_for_default_search,
    mailbox_needs_first_backfill, mark_first_backfill_completed, parse_inbox_window_to_iso_cutoff,
    print_review_text, read_ripmail_env_file, resolve_mailbox_spec, resolve_sync_folder_for_host,
    resolve_sync_since_ymd, run_applemail_sync, run_inbox_scan, run_local_dir_sync,
    DeterministicInboxClassifier, InboxSurfaceMode, MailboxImapAuthKind, ResolvedMailbox,
    RunInboxScanOptions, SourceKind, SyncDirection, SyncFileLogger, SyncMailboxSummary,
    SyncOptions, SyncResult,
};

fn mailbox_imap_ready(home: &std::path::Path, mb: &ResolvedMailbox) -> bool {
    if mb.imap_user.trim().is_empty() {
        return false;
    }
    match mb.imap_auth {
        MailboxImapAuthKind::AppPassword => !mb.imap_password.trim().is_empty(),
        MailboxImapAuthKind::GoogleOAuth => google_oauth_credentials_present(home, &mb.id),
    }
}

fn mailbox_sync_ready(home: &std::path::Path, mb: &ResolvedMailbox) -> bool {
    if mb.kind == SourceKind::LocalDir {
        return mb
            .local_dir
            .as_ref()
            .map(|l| l.root.is_dir())
            .unwrap_or(false);
    }
    if mb.apple_mail_root.is_some() {
        return mb
            .apple_mail_root
            .as_ref()
            .map(|p| ripmail::applemail::envelope_index_path(p).is_file())
            .unwrap_or(false);
    }
    mailbox_imap_ready(home, mb)
}

pub(crate) trait InboxCliArgs {
    fn surface_mode(&self) -> InboxSurfaceMode;
    fn window(&self) -> Option<String>;
    fn since(&self) -> Option<String>;
    /// `ripmail inbox --source` filter (email or id).
    fn mailbox_spec(&self) -> Option<&str>;
    fn replay(&self) -> bool;
    fn include_all(&self) -> bool;
    fn diagnostics(&self) -> bool;
    /// Full per-row fields (note, decisionSource, attachments, matchedRuleIds) for JSON output.
    fn inbox_json_full_detail(&self) -> bool;
    fn text(&self) -> bool;
    fn reclassify(&self) -> bool;
}

impl InboxCliArgs for InboxArgs {
    fn surface_mode(&self) -> InboxSurfaceMode {
        InboxSurfaceMode::Review
    }

    fn window(&self) -> Option<String> {
        self.window.clone()
    }

    fn since(&self) -> Option<String> {
        self.since.clone()
    }

    fn mailbox_spec(&self) -> Option<&str> {
        self.source
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }

    fn replay(&self) -> bool {
        self.thorough || self.replay
    }

    fn include_all(&self) -> bool {
        // Full inbox window (all Gmail/label categories), not only primary-tab mail.
        true
    }

    fn diagnostics(&self) -> bool {
        self.diagnostics
    }

    fn inbox_json_full_detail(&self) -> bool {
        self.diagnostics || self.thorough || self.replay || self.include_all || self.reclassify
    }

    fn text(&self) -> bool {
        self.text
    }

    fn reclassify(&self) -> bool {
        self.thorough || self.reclassify
    }
}

/// Node `parseInboxCliArgs`: `--since` wins; else optional positional `^\d+[dhmwy]?$` only.
fn inbox_rolling_window_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^\d+[dhmwy]?$").expect("regex"))
}

fn resolve_inbox_window_spec(since: Option<String>, window: Option<String>) -> Option<String> {
    if let Some(s) = since {
        return Some(s);
    }
    window.filter(|w| inbox_rolling_window_re().is_match(w.trim()))
}

pub(crate) fn print_sync_foreground_metrics(r: &SyncResult) {
    let sec = (r.duration_ms as f64) / 1000.0;
    let mb = (r.bytes_downloaded as f64) / (1024.0 * 1024.0);
    let kbps = r.bandwidth_bytes_per_sec / 1024.0;
    println!();
    if let Some(ref per_mb) = r.mailboxes {
        if per_mb.len() > 1 {
            println!("Sync metrics (per mailbox):");
            for m in per_mb {
                let s = (m.duration_ms as f64) / 1000.0;
                let mbb = (m.bytes_downloaded as f64) / (1024.0 * 1024.0);
                println!(
                    "  {} <{}>:  {} new, {} fetched, {:.2} MB, {:.2}s",
                    m.email, m.id, m.synced, m.messages_fetched, mbb, s
                );
            }
            println!();
        }
    }
    println!("Sync metrics (total):");
    println!(
        "  messages:  {} new, {} fetched",
        r.synced, r.messages_fetched
    );
    println!("  downloaded: {:.2} MB ({} bytes)", mb, r.bytes_downloaded);
    println!("  bandwidth: {:.1} KB/s", kbps);
    println!(
        "  throughput: {} msg/min",
        r.messages_per_minute.round() as i64
    );
    println!("  duration:  {sec:.2}s");
    println!("Sync log: {}", r.log_path);
}

fn mailboxes_to_run(
    cfg: &ripmail::Config,
    mailbox_filter: Option<&str>,
) -> Result<Vec<ResolvedMailbox>, Box<dyn std::error::Error>> {
    let list: Vec<&ResolvedMailbox> = if let Some(spec) = mailbox_filter {
        let m = resolve_mailbox_spec(cfg.resolved_mailboxes(), spec).ok_or_else(|| {
            format!(
                "Unknown source {spec:?}. Configured ids: {}",
                cfg.resolved_mailboxes()
                    .iter()
                    .map(|x| x.id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;
        vec![m]
    } else {
        cfg.resolved_mailboxes().iter().collect()
    };
    if list.is_empty() {
        return Err("No sources configured. Run `ripmail setup` or `ripmail sources add`.".into());
    }
    Ok(list.into_iter().cloned().collect())
}

fn merge_sync_runs(
    runs: Vec<SyncResult>,
    summaries: Vec<SyncMailboxSummary>,
    log_path: String,
) -> SyncResult {
    if runs.is_empty() {
        return SyncResult {
            synced: 0,
            messages_fetched: 0,
            bytes_downloaded: 0,
            duration_ms: 0,
            bandwidth_bytes_per_sec: 0.0,
            messages_per_minute: 0.0,
            log_path,
            early_exit: None,
            new_message_ids: None,
            mailboxes: None,
        };
    }
    let mut synced = 0u32;
    let mut messages_fetched = 0u32;
    let mut bytes_downloaded = 0u64;
    let mut duration_ms = 0u64;
    let mut new_ids: Vec<String> = Vec::new();
    let mut early_exit = None;
    for r in runs {
        synced += r.synced;
        messages_fetched += r.messages_fetched;
        bytes_downloaded += r.bytes_downloaded;
        duration_ms += r.duration_ms;
        if let Some(e) = r.early_exit {
            early_exit = Some(e);
        }
        if let Some(ids) = r.new_message_ids {
            for id in ids {
                if new_ids.len() < 50 {
                    new_ids.push(id);
                }
            }
        }
    }
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
    SyncResult {
        synced,
        messages_fetched,
        bytes_downloaded,
        duration_ms,
        bandwidth_bytes_per_sec: bandwidth,
        messages_per_minute: msg_per_min,
        log_path,
        early_exit,
        new_message_ids: if new_ids.is_empty() {
            None
        } else {
            Some(new_ids)
        },
        mailboxes: if summaries.len() > 1 {
            Some(summaries)
        } else {
            None
        },
    }
}

pub(crate) fn run_sync_foreground_backward(
    cfg: &ripmail::Config,
    since_override: Option<&str>,
    mailbox_filter: Option<&str>,
    verbose: bool,
) -> Result<SyncResult, Box<dyn std::error::Error>> {
    let home = ripmail_home_path();
    let to_run = mailboxes_to_run(cfg, mailbox_filter)?;
    let logger = SyncFileLogger::open(&home)?;
    let mut conn = db::open_file(cfg.db_path())?;
    let since_ymd = resolve_sync_since_ymd(cfg, since_override)?;
    let mut runs = Vec::new();
    let mut summaries = Vec::new();
    let log_path = logger.log_path().display().to_string();
    let env_file = read_ripmail_env_file(&home);
    let process_env: HashMap<String, String> = std::env::vars().collect();
    let exclude_labels = cfg.sync_exclude_labels.clone();
    let sync_mailbox = cfg.sync_mailbox.clone();
    for mb in &to_run {
        if !mailbox_sync_ready(&home, mb) {
            if mb.kind == SourceKind::LocalDir {
                eprintln!(
                    "ripmail: skipping {} (localDir root missing or not a directory)",
                    mb.id
                );
            } else {
                eprintln!(
                    "ripmail: skipping {} (missing IMAP credentials or Apple Mail Envelope Index)",
                    mb.id
                );
            }
            continue;
        }
        let mailbox_id = mb.id.clone();
        if mb.kind == SourceKind::LocalDir {
            eprintln!("ripmail: indexing local directory {}…", mb.id);
            let result = run_local_dir_sync(&mut conn, mb, true)?;
            summaries.push(SyncMailboxSummary {
                id: mb.id.clone(),
                email: String::new(),
                synced: result.synced,
                messages_fetched: result.messages_fetched,
                bytes_downloaded: result.bytes_downloaded,
                duration_ms: result.duration_ms,
            });
            runs.push(result);
            continue;
        }
        if mb.apple_mail_root.is_some() {
            eprintln!("ripmail: indexing Apple Mail for {}…", mb.email);
            let result = run_applemail_sync(&mut conn, &logger, mb, &since_ymd, true, verbose)?;
            mark_first_backfill_completed(&conn, &mailbox_id)?;
            eprintln!("ripmail: Apple Mail index pass done.");
            summaries.push(SyncMailboxSummary {
                id: mb.id.clone(),
                email: mb.email.clone(),
                synced: result.synced,
                messages_fetched: result.messages_fetched,
                bytes_downloaded: result.bytes_downloaded,
                duration_ms: result.duration_ms,
            });
            runs.push(result);
            continue;
        }
        eprintln!("ripmail: Connecting to {} ({})…", mb.imap_host, mb.email);
        let imap_folder = resolve_sync_folder_for_host(&sync_mailbox, &mb.imap_host);
        let mb_owned = mb.clone();
        let home_c = home.clone();
        let env_file = env_file.clone();
        let process_env = process_env.clone();
        let maildir_path = mb.maildir_path.clone();
        let opts = SyncOptions {
            direction: SyncDirection::Backward,
            since_ymd: since_ymd.clone(),
            force: false,
            progress_stderr: true,
            verbose,
        };
        let result = ripmail::run_sync_with_parallel_imap_connect(
            &mut conn,
            &logger,
            &mailbox_id,
            &imap_folder,
            &maildir_path,
            &exclude_labels,
            &opts,
            move || connect_imap_for_resolved_mailbox(&home_c, &mb_owned, &env_file, &process_env),
        )?;
        mark_first_backfill_completed(&conn, &mailbox_id)?;
        eprintln!("ripmail: Connected.");
        summaries.push(SyncMailboxSummary {
            id: mb.id.clone(),
            email: mb.email.clone(),
            synced: result.synced,
            messages_fetched: result.messages_fetched,
            bytes_downloaded: result.bytes_downloaded,
            duration_ms: result.duration_ms,
        });
        runs.push(result);
    }
    Ok(merge_sync_runs(runs, summaries, log_path))
}

pub(crate) fn run_sync_foreground_refresh(
    cfg: &ripmail::Config,
    force: bool,
    progress_stderr: bool,
    mailbox_filter: Option<&str>,
    verbose: bool,
) -> Result<SyncResult, Box<dyn std::error::Error>> {
    let home = ripmail_home_path();
    let to_run = mailboxes_to_run(cfg, mailbox_filter)?;
    let logger = SyncFileLogger::open(&home)?;
    let mut conn = db::open_file(cfg.db_path())?;
    let since_ymd = resolve_sync_since_ymd(cfg, None)?;
    let log_path = logger.log_path().display().to_string();
    let mut runs = Vec::new();
    let mut summaries = Vec::new();
    let env_file = read_ripmail_env_file(&home);
    let process_env: HashMap<String, String> = std::env::vars().collect();
    let exclude_labels = cfg.sync_exclude_labels.clone();
    let sync_mailbox = cfg.sync_mailbox.clone();
    for mb in &to_run {
        if !mailbox_sync_ready(&home, mb) {
            if progress_stderr {
                if mb.kind == SourceKind::LocalDir {
                    eprintln!(
                        "ripmail: skipping {} (localDir root missing or not a directory)",
                        mb.id
                    );
                } else {
                    eprintln!(
                        "ripmail: skipping {} (missing IMAP credentials or Apple Mail Envelope Index)",
                        mb.id
                    );
                }
            }
            continue;
        }
        let mailbox_id = mb.id.clone();
        if mb.kind == SourceKind::LocalDir {
            if progress_stderr {
                eprintln!("ripmail: indexing local directory {}…", mb.id);
            }
            let result = run_local_dir_sync(&mut conn, mb, progress_stderr)?;
            summaries.push(SyncMailboxSummary {
                id: mb.id.clone(),
                email: String::new(),
                synced: result.synced,
                messages_fetched: result.messages_fetched,
                bytes_downloaded: result.bytes_downloaded,
                duration_ms: result.duration_ms,
            });
            runs.push(result);
            continue;
        }
        if mb.apple_mail_root.is_some() {
            if progress_stderr {
                eprintln!("ripmail: indexing Apple Mail for {}…", mb.email);
            }
            let needs_first = mailbox_needs_first_backfill(&conn, mb)?;
            let result =
                run_applemail_sync(&mut conn, &logger, mb, &since_ymd, progress_stderr, verbose)?;
            if needs_first {
                mark_first_backfill_completed(&conn, &mailbox_id)?;
            }
            if progress_stderr {
                eprintln!("ripmail: Apple Mail index pass done.");
            }
            summaries.push(SyncMailboxSummary {
                id: mb.id.clone(),
                email: mb.email.clone(),
                synced: result.synced,
                messages_fetched: result.messages_fetched,
                bytes_downloaded: result.bytes_downloaded,
                duration_ms: result.duration_ms,
            });
            runs.push(result);
            continue;
        }
        if progress_stderr {
            eprintln!("ripmail: Connecting to {} ({})…", mb.imap_host, mb.email);
        }
        let imap_folder = resolve_sync_folder_for_host(&sync_mailbox, &mb.imap_host);
        let mb_owned = mb.clone();
        let home_c = home.clone();
        let env_file = env_file.clone();
        let process_env = process_env.clone();
        let maildir_path = mb.maildir_path.clone();
        let needs_first = mailbox_needs_first_backfill(&conn, mb)?;
        let direction = if needs_first {
            SyncDirection::Backward
        } else {
            SyncDirection::Forward
        };
        let opts = SyncOptions {
            direction,
            since_ymd: since_ymd.clone(),
            force,
            progress_stderr,
            verbose,
        };
        let result = ripmail::run_sync_with_parallel_imap_connect(
            &mut conn,
            &logger,
            &mailbox_id,
            &imap_folder,
            &maildir_path,
            &exclude_labels,
            &opts,
            move || connect_imap_for_resolved_mailbox(&home_c, &mb_owned, &env_file, &process_env),
        )?;
        if direction == SyncDirection::Backward {
            mark_first_backfill_completed(&conn, &mailbox_id)?;
        }
        if progress_stderr {
            eprintln!("ripmail: Connected.");
        }
        summaries.push(SyncMailboxSummary {
            id: mb.id.clone(),
            email: mb.email.clone(),
            synced: result.synced,
            messages_fetched: result.messages_fetched,
            bytes_downloaded: result.bytes_downloaded,
            duration_ms: result.duration_ms,
        });
        runs.push(result);
    }
    Ok(merge_sync_runs(runs, summaries, log_path))
}

pub(crate) fn run_triage_command(cfg: &ripmail::Config, args: &impl InboxCliArgs) -> CliResult {
    let window_spec = resolve_inbox_window_spec(args.since(), args.window());
    let spec = window_spec.unwrap_or_else(|| cfg.inbox_default_window.clone());
    let cutoff_iso = match parse_inbox_window_to_iso_cutoff(&spec) {
        Ok(value) => value,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    };

    let owner = (!cfg.imap_user.trim().is_empty()).then(|| cfg.imap_user.clone());
    let mailbox_ids = inbox_scan_mailbox_ids(cfg, args);
    let mailbox_order = mailbox_order_for_inbox_json(cfg, args, &mailbox_ids);

    let opts = RunInboxScanOptions {
        surface_mode: args.surface_mode(),
        cutoff_iso: cutoff_iso.clone(),
        include_all: args.include_all(),
        replay: args.replay(),
        reapply_llm: args.reclassify(),
        include_archived_candidates: false,
        diagnostics: args.diagnostics(),
        rules_fingerprint: None,
        owner_address: owner,
        owner_aliases: cfg.imap_aliases.clone(),
        candidate_cap: None,
        notable_cap: None,
        batch_size: None,
        source_ids: mailbox_ids,
    };

    let scan = run_triage_scan(cfg, args, &opts)?;
    let conn = db::open_file(cfg.db_path())?;
    let mailbox_ids_for_index: Vec<String> =
        mailbox_order.iter().map(|(id, _)| id.clone()).collect();
    let indexed_in_window =
        count_indexed_messages_simple_window(&conn, &cutoff_iso, &mailbox_ids_for_index)?;
    let total_unarchived = count_unarchived_messages_by_mailbox(&conn, &mailbox_ids_for_index)?;

    let hints = inbox_json_hints(
        args.surface_mode(),
        &scan.surfaced,
        &scan.counts,
        scan.candidates_scanned,
        args.diagnostics(),
        Some(scan.processed.as_slice()),
    );
    let json = build_review_json(
        &scan.surfaced,
        args.diagnostics().then_some(scan.processed.as_slice()),
        &scan.counts,
        scan.candidates_scanned,
        scan.llm_duration_ms,
        &hints,
        args.inbox_json_full_detail(),
        &mailbox_order,
        &opts.source_ids,
        &scan.candidate_count_by_mailbox,
        &indexed_in_window,
        &total_unarchived,
    );
    if args.text() {
        print_review_text(
            &scan.surfaced,
            args.diagnostics().then_some(scan.processed.as_slice()),
            &scan.counts,
        );
    } else {
        println!("{}", serde_json::to_string_pretty(&json)?);
    }

    Ok(())
}

fn mailbox_order_for_inbox_json(
    cfg: &ripmail::Config,
    args: &impl InboxCliArgs,
    scan_mailbox_ids: &[String],
) -> Vec<(String, String)> {
    if args.mailbox_spec().is_some() {
        scan_mailbox_ids
            .iter()
            .filter_map(|id| {
                cfg.resolved_mailboxes()
                    .iter()
                    .find(|m| m.id == *id)
                    .map(|m| (m.id.clone(), m.email.clone()))
            })
            .collect()
    } else {
        cfg.resolved_mailboxes()
            .iter()
            .map(|m| (m.id.clone(), m.email.clone()))
            .collect()
    }
}

fn inbox_scan_mailbox_ids(cfg: &ripmail::Config, args: &impl InboxCliArgs) -> Vec<String> {
    if let Some(spec) = args.mailbox_spec() {
        if let Some(mb) = resolve_mailbox_spec(cfg.resolved_mailboxes(), spec) {
            return vec![mb.id.clone()];
        }
        eprintln!(
            "Unknown mailbox {spec:?}. Configured: {}",
            cfg.resolved_mailboxes()
                .iter()
                .map(|m| m.email.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
        std::process::exit(1);
    }
    mailbox_ids_for_default_search(cfg.resolved_mailboxes())
}

fn run_triage_scan(
    cfg: &ripmail::Config,
    _args: &impl InboxCliArgs,
    opts: &RunInboxScanOptions,
) -> Result<ripmail::RunInboxScanResult, Box<dyn std::error::Error>> {
    let conn = db::open_file(cfg.db_path())?;
    let owner = (!cfg.imap_user.trim().is_empty()).then(|| cfg.imap_user.clone());
    let home = ripmail_home_path();
    let mut scan_opts = opts.clone();
    scan_opts.rules_fingerprint = Some(inbox_rules_fingerprint_for_scope(&home, &opts.source_ids)?);
    scan_opts.owner_address = owner;

    let mut classifier = DeterministicInboxClassifier::new_for_home(&conn, &home, &scan_opts)?;
    let runtime = tokio::runtime::Runtime::new()?;
    let scan = runtime.block_on(run_inbox_scan(&conn, &scan_opts, &mut classifier))?;
    Ok(scan)
}
