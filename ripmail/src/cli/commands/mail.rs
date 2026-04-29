use std::collections::HashSet;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;

use unicode_normalization::UnicodeNormalization;

use crate::cli::args::AttachmentCmd;
use crate::cli::util::{format_attachment_size, load_cfg};
use crate::cli::CliResult;
use ripmail::{
    db, format_read_message_text, infer_placeholder_owner_identities, is_placeholder_mailbox_email,
    list_attachments_for_message, list_thread_messages, local_file_read_outcome_with_options,
    local_file_skipped_too_large, mailbox_ids_for_default_search, normalize_address,
    normalize_search_date_spec, parse_category_list, parse_read_full_with_body_preference,
    read_attachment_bytes, read_attachment_text, read_message_bytes_with_thread,
    resolve_mailbox_spec, resolve_message_id, resolve_search_json_format,
    search_result_to_slim_json_row, search_with_meta, send_draft_by_id, send_simple_message,
    smtp_credentials_ready, smtp_credentials_unavailable_reason, split_address_list, who, whoami,
    Config, LocalFileReadOptions, ReadBodyPreference, ReadMessageJson, SearchOptions,
    SearchResultFormatPreference, SendSimpleFields, SourceKind, WhoOptions, WhoamiResult,
    MAX_LOCAL_FILE_BYTES,
};

fn source_kind_cli_label(k: SourceKind) -> &'static str {
    match k {
        SourceKind::Imap => "imap",
        SourceKind::AppleMail => "applemail",
        SourceKind::LocalDir => "localDir",
        SourceKind::GoogleCalendar => "googleCalendar",
        SourceKind::AppleCalendar => "appleCalendar",
        SourceKind::IcsSubscription => "icsSubscription",
        SourceKind::IcsFile => "icsFile",
    }
}

/// When `--source` is set, require a configured mail (IMAP / Apple Mail) source.
pub(crate) fn ensure_mail_source_only(cfg: &Config, spec: Option<&str>) -> Result<(), String> {
    let Some(s) = spec.map(str::trim).filter(|x| !x.is_empty()) else {
        return Ok(());
    };
    let Some(mb) = resolve_mailbox_spec(cfg.resolved_mailboxes(), s) else {
        return Err(format!(
            "Unknown source {s:?}. Configured: {}",
            cfg.resolved_mailboxes()
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    };
    if !mb.kind.is_mail() {
        return Err(format!(
            "error: source {} is kind={}; this command only works on mail sources",
            mb.id,
            source_kind_cli_label(mb.kind)
        ));
    }
    Ok(())
}

pub(crate) struct SendCommandArgs {
    pub(crate) draft_id: Option<String>,
    pub(crate) to: Option<String>,
    pub(crate) subject: Option<String>,
    pub(crate) body: Option<String>,
    pub(crate) cc: Option<String>,
    pub(crate) bcc: Option<String>,
    pub(crate) dry_run: bool,
    pub(crate) source: Option<String>,
    pub(crate) text: bool,
}

pub(crate) fn run_send(args: SendCommandArgs) -> CliResult {
    let cfg = load_cfg();

    let SendCommandArgs {
        draft_id,
        to,
        subject,
        body,
        cc,
        bcc,
        dry_run,
        source,
        text,
    } = args;

    if let Err(e) = ensure_mail_source_only(&cfg, source.as_deref()) {
        eprintln!("{e}");
        std::process::exit(1);
    }

    let use_json = !text;
    if let (Some(to_addresses), Some(subject)) = (to.as_ref(), subject.as_ref()) {
        if !smtp_credentials_ready(&cfg) {
            eprintln!("{}", smtp_credentials_unavailable_reason(&cfg));
            std::process::exit(1);
        }
        let fields = SendSimpleFields {
            to: split_address_list(to_addresses),
            cc: cc
                .as_ref()
                .map(|s| split_address_list(s))
                .filter(|v| !v.is_empty()),
            bcc: bcc
                .as_ref()
                .map(|s| split_address_list(s))
                .filter(|v| !v.is_empty()),
            subject: subject.clone(),
            text: body.unwrap_or_default(),
            html: None,
            in_reply_to: None,
            references: None,
        };
        print_send_result(&send_simple_message(&cfg, &fields, dry_run)?, use_json)?;
    } else if let Some(id) = draft_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        print_send_result(
            &send_draft_by_id(&cfg, &cfg.data_dir, id, dry_run)?,
            use_json,
        )?;
    } else {
        eprintln!(
            "Usage: ripmail send --to <addr> --subject <s> [--body <text>] [--cc ...] [--bcc ...] [--dry-run]"
        );
        eprintln!("       ripmail send <draft-id>");
        std::process::exit(1);
    }

    Ok(())
}

pub(crate) fn run_draft(sub: ripmail::draft::DraftCmd) -> CliResult {
    let cfg = load_cfg();
    let source_cli = match &sub {
        ripmail::draft::DraftCmd::New { source, .. } => source.as_deref(),
        ripmail::draft::DraftCmd::Reply { source, .. } => source.as_deref(),
        ripmail::draft::DraftCmd::Forward { source, .. } => source.as_deref(),
        _ => None,
    };
    if let Err(e) = ensure_mail_source_only(&cfg, source_cli) {
        eprintln!("{e}");
        std::process::exit(1);
    }

    let needs_db = matches!(
        &sub,
        ripmail::draft::DraftCmd::Reply { .. } | ripmail::draft::DraftCmd::Forward { .. }
    );
    let conn_owned = if needs_db {
        Some(db::open_file_for_queries(cfg.db_path())?)
    } else {
        None
    };
    ripmail::draft::run_draft(sub, &cfg, conn_owned.as_ref())?;
    Ok(())
}

/// Between messages when `ripmail read` is given multiple ids (text mode only).
const READ_BATCH_TEXT_SEP: &str = "\n\n--- ripmail ---\n\n";

fn read_message_for_cli(
    conn: &rusqlite::Connection,
    message_id: &str,
    data_root: &std::path::Path,
) -> Result<(Vec<u8>, String), io::Error> {
    let (bytes, _mid, thread_id) = read_message_bytes_with_thread(conn, message_id, data_root)
        .map_err(|e| io::Error::other(format!("{message_id}: {e}")))?
        .map_err(|e| io::Error::other(format!("{message_id}: {e}")))?;
    Ok((bytes, thread_id))
}

fn expand_read_path(raw: &str) -> PathBuf {
    let s = raw.trim();
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(h) = dirs::home_dir() {
            return h.join(rest);
        }
    }
    let p = PathBuf::from(s);
    if p.is_absolute() {
        p
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(p)
    }
}

/// JSON for `ripmail read <path> --json` on a local file (structured `readStatus`, no `utf8_lossy` binary dump).
fn local_file_read_json(
    path: &std::path::Path,
    file_opts: LocalFileReadOptions,
) -> Result<serde_json::Value, String> {
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let size = meta.len();
    let path_s = path.to_string_lossy().to_string();
    if size > MAX_LOCAL_FILE_BYTES {
        let o = local_file_skipped_too_large(size, &mime, fname);
        serde_json::to_value(o.to_json(path_s)).map_err(|e| e.to_string())
    } else {
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        let o = local_file_read_outcome_with_options(&bytes, &mime, fname, file_opts);
        serde_json::to_value(o.to_json(path_s)).map_err(|e| e.to_string())
    }
}

fn local_file_read_plain(
    path: &std::path::Path,
    file_opts: LocalFileReadOptions,
) -> Result<String, String> {
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let size = meta.len();
    if size > MAX_LOCAL_FILE_BYTES {
        let o = local_file_skipped_too_large(size, &mime, fname);
        return Ok(o.body_text);
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let o = local_file_read_outcome_with_options(&bytes, &mime, fname, file_opts);
    Ok(o.body_text)
}

pub(crate) fn run_read(
    message_ids: Vec<String>,
    source_narrow: Option<String>,
    plain_body: bool,
    full_body: bool,
    raw: bool,
    json: bool,
) -> CliResult {
    if message_ids.is_empty() {
        eprintln!("Usage: ripmail read <TARGET>… [--source <id|email>] [--plain-body] [--full-body] [--raw] [--json|--text]");
        std::process::exit(1);
    }

    let file_read_opts = LocalFileReadOptions {
        truncate_extracted: !full_body,
    };

    let body_pref = if plain_body {
        ReadBodyPreference::PlainText
    } else {
        ReadBodyPreference::Auto
    };

    let cfg = load_cfg();
    let conn = db::open_file_for_queries(cfg.db_path())?;
    let root = cfg.message_path_root();

    if raw {
        let mut first = true;
        for target in &message_ids {
            let path = expand_read_path(target);
            if path.is_file() {
                let bytes = fs::read(&path).map_err(|e| e.to_string())?;
                if !first {
                    std::io::stdout().write_all(b"\n\n")?;
                }
                first = false;
                std::io::stdout().write_all(&bytes)?;
            } else {
                let (bytes, _) = read_message_for_cli(&conn, target, root)?;
                if !first {
                    std::io::stdout().write_all(b"\n\n")?;
                }
                first = false;
                std::io::stdout().write_all(&bytes)?;
            }
        }
        return Ok(());
    }

    if json {
        if message_ids.len() == 1 {
            let target = &message_ids[0];
            let path = expand_read_path(target);
            if path.is_file() {
                let v = local_file_read_json(&path, file_read_opts)?;
                println!("{}", serde_json::to_string_pretty(&v)?);
            } else {
                let (bytes, thread_id) = read_message_for_cli(&conn, target, root)?;
                let parsed = parse_read_full_with_body_preference(&bytes, body_pref);
                let mut out =
                    serde_json::to_value(ReadMessageJson::from_parsed(&parsed, &thread_id))?;
                if let Ok(Some((_, _, Some(sid)))) =
                    ripmail::ids::resolve_message_id_and_raw_path(&conn, target)
                {
                    if let Some(mb) = cfg.resolved_mailboxes().iter().find(|m| m.id == sid) {
                        out["sourceId"] = serde_json::json!(sid);
                        out["sourceKind"] = serde_json::json!(source_kind_cli_label(mb.kind));
                    }
                }
                if let Some(spec) = source_narrow
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    if let Some(want) = resolve_mailbox_spec(cfg.resolved_mailboxes(), spec) {
                        let got = out.get("sourceId").and_then(|v| v.as_str()).unwrap_or("");
                        if !got.is_empty() && got != want.id {
                            return Err(format!(
                                "message does not belong to source {} (expected {})",
                                got, want.id
                            )
                            .into());
                        }
                    }
                }
                println!("{}", serde_json::to_string_pretty(&out)?);
            }
        } else {
            let mut values: Vec<serde_json::Value> = Vec::with_capacity(message_ids.len());
            for target in &message_ids {
                let path = expand_read_path(target);
                if path.is_file() {
                    values.push(local_file_read_json(&path, file_read_opts)?);
                } else {
                    let (bytes, thread_id) = read_message_for_cli(&conn, target, root)?;
                    let parsed = parse_read_full_with_body_preference(&bytes, body_pref);
                    values.push(serde_json::to_value(ReadMessageJson::from_parsed(
                        &parsed, &thread_id,
                    ))?);
                }
            }
            println!("{}", serde_json::to_string_pretty(&values)?);
        }
        return Ok(());
    }

    let mut first = true;
    for target in &message_ids {
        let path = expand_read_path(target);
        if path.is_file() {
            let text = local_file_read_plain(&path, file_read_opts)?;
            if !first {
                print!("{READ_BATCH_TEXT_SEP}");
            }
            first = false;
            print!("{text}");
        } else {
            let (bytes, _) = read_message_for_cli(&conn, target, root)?;
            let parsed = parse_read_full_with_body_preference(&bytes, body_pref);
            if !first {
                print!("{READ_BATCH_TEXT_SEP}");
            }
            first = false;
            print!("{}", format_read_message_text(&parsed));
        }
    }
    Ok(())
}

pub(crate) fn run_thread(thread_id: String, json: bool) -> CliResult {
    let cfg = load_cfg();
    let conn = db::open_file_for_queries(cfg.db_path())?;
    let rows = list_thread_messages(&conn, &thread_id)?;
    if json {
        println!("{}", serde_json::to_string_pretty(&rows)?);
    } else {
        for row in rows {
            println!(
                "{}  {}  {}",
                &row.date[..row.date.len().min(10)],
                row.from_address,
                row.subject
            );
        }
    }
    Ok(())
}

pub(crate) fn run_attachment(sub: AttachmentCmd) -> CliResult {
    let cfg = load_cfg();
    let conn = db::open_file(cfg.db_path())?;
    let cache = cfg.attachments_cache_extracted_text;

    match sub {
        AttachmentCmd::List {
            message_id_pos,
            message_id_flag,
            text,
        } => {
            let message_id = message_id_flag.or(message_id_pos).ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "missing message id: pass MESSAGE_ID or --message-id <id>",
                )
            })?;
            let exists = resolve_message_id(&conn, &message_id)?.is_some();
            if !exists {
                println!("{}", if text { "No attachments found." } else { "[]" });
                return Ok(());
            }

            let rows = list_attachments_for_message(&conn, &message_id)?;
            if text {
                print_attachment_table(&message_id, &rows);
            } else {
                let json_rows: Vec<serde_json::Value> = rows
                    .iter()
                    .enumerate()
                    .map(|(index, attachment)| {
                        serde_json::json!({
                            "index": index + 1,
                            "filename": &attachment.filename,
                            "mimeType": &attachment.mime_type,
                            "size": attachment.size,
                            "extracted": attachment.extracted,
                        })
                    })
                    .collect();
                println!("{}", serde_json::to_string_pretty(&json_rows)?);
            }
        }
        AttachmentCmd::Read {
            message_id,
            index_or_name,
            raw,
            no_cache,
        } => {
            let rows = list_attachments_for_message(&conn, &message_id)?;
            if rows.is_empty() {
                eprintln!("No attachments found for message.");
                std::process::exit(1);
            }
            let attachment = resolve_attachment(&rows, &index_or_name);
            if raw {
                let bytes = read_attachment_bytes(&conn, cfg.message_path_root(), attachment.id)?;
                std::io::stdout().write_all(&bytes)?;
            } else {
                let text = read_attachment_text(
                    &conn,
                    cfg.message_path_root(),
                    attachment.id,
                    cache,
                    no_cache,
                )
                .map_err(std::io::Error::other)?;
                println!("{text}");
            }
        }
    }

    Ok(())
}

pub(crate) fn run_who(
    query: Option<String>,
    limit: usize,
    source: Option<String>,
    include_noreply: bool,
    text: bool,
) -> CliResult {
    let cfg = load_cfg();
    let conn = db::open_file_for_queries(cfg.db_path())?;
    let mailbox_ids = who_mailbox_ids(&cfg, source.as_deref());
    let mut owner_identities = resolve_who_owner_identities(&cfg, mailbox_ids.as_ref());
    let inferred = infer_placeholder_owner_identities(&conn, &cfg, mailbox_ids.as_ref())?;
    if !inferred.is_empty() {
        match &mut owner_identities {
            None => owner_identities = Some(inferred),
            Some(v) => {
                v.retain(|e| !is_placeholder_mailbox_email(e));
                for a in inferred {
                    let n = normalize_address(&a);
                    if !v.iter().any(|b| normalize_address(b) == n) {
                        v.push(a);
                    }
                }
            }
        }
    }
    let mut omit_identity_norms = all_mailbox_identity_norms(&cfg);
    if let Some(ids) = owner_identities.as_ref() {
        for e in ids {
            omit_identity_norms.insert(normalize_address(e));
        }
    }
    let result = who(
        &conn,
        &WhoOptions {
            query: query.unwrap_or_default(),
            limit,
            include_noreply,
            mailbox_ids,
            owner_identities,
            omit_identity_norms,
        },
    )?;
    if text {
        for person in &result.people {
            println!(
                "{}  sent={} recv={}  rank={:.2}",
                person.primary_address,
                person.sent_count,
                person.received_count,
                person.contact_rank
            );
        }
    } else {
        println!("{}", serde_json::to_string_pretty(&result)?);
    }
    Ok(())
}

pub(crate) fn run_whoami(source: Option<String>, text: bool) -> CliResult {
    let cfg = load_cfg();
    let conn = db::open_file_for_queries(cfg.db_path())?;
    let spec = source.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(s) = spec {
        if resolve_mailbox_spec(cfg.resolved_mailboxes(), s).is_none() {
            eprintln!(
                "Unknown mailbox {s:?}. Configured: {}",
                cfg.resolved_mailboxes()
                    .iter()
                    .map(|m| m.email.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            std::process::exit(1);
        }
    }
    let result = whoami(&conn, &cfg.ripmail_home, &cfg, spec)?;
    if text {
        print_whoami_text(&result);
    } else {
        println!("{}", serde_json::to_string_pretty(&result)?);
    }
    Ok(())
}

fn print_whoami_text(r: &WhoamiResult) {
    if r.mailboxes.is_empty() {
        println!("No mailboxes configured.");
        return;
    }
    for mb in &r.mailboxes {
        println!(
            "Mailbox: {}  configAddress: {}",
            mb.mailbox_id, mb.config_address
        );
        println!("  source: {}", mb.source);
        if !mb.imap_aliases.is_empty() {
            println!("  imapAliases: {}", mb.imap_aliases.join(", "));
        }
        println!("  includeInDefaultSearch: {}", mb.include_in_default_search);
        if let Some(ref t) = mb.mailbox_type {
            println!("  mailboxType: {t}");
        }
        if let Some(ref id) = mb.identity {
            if let Some(ref n) = id.preferred_name {
                println!("  preferredName: {n}");
            }
            if let Some(ref n) = id.full_name {
                println!("  fullName: {n}");
            }
            if let Some(ref sid) = id.signature_id {
                println!("  signatureId: {sid}");
            }
            if id
                .signatures
                .as_ref()
                .map(|m| !m.is_empty())
                .unwrap_or(false)
            {
                println!(
                    "  signatures: ({} block(s))",
                    id.signatures.as_ref().unwrap().len()
                );
            }
        }
        if let Some(ref inf) = mb.inferred {
            if let Some(ref e) = inf.primary_email {
                println!("  primaryEmail (inferred): {e}");
            }
            if let Some(ref n) = inf.display_name_from_mail {
                println!("  inferredDisplayName (from mail): {n}");
            }
            if let Some(ref n) = inf.suggested_name_from_email {
                println!("  suggestedName (from email local-part): {n}");
            }
        }
        println!();
    }
}

fn search_mailbox_ids(cfg: &ripmail::Config, mailbox_cli: Option<&str>) -> Option<Vec<String>> {
    if let Some(spec) = mailbox_cli.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(m) = resolve_mailbox_spec(cfg.resolved_mailboxes(), spec) {
            return Some(vec![m.id.clone()]);
        }
        eprintln!(
            "Unknown source {spec:?}. Configured ids: {}",
            cfg.resolved_mailboxes()
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
        std::process::exit(1);
    }
    let ids = mailbox_ids_for_default_search(cfg.resolved_mailboxes());
    if ids.is_empty() || ids.len() == cfg.resolved_mailboxes().len() {
        None
    } else {
        Some(ids)
    }
}

fn who_mailbox_ids(cfg: &ripmail::Config, mailbox_cli: Option<&str>) -> Option<Vec<String>> {
    search_mailbox_ids(cfg, mailbox_cli)
}

/// Primary + IMAP aliases for owner-centric `who` stats. With multiple mailboxes, uses the union
/// of every mailbox’s email + aliases so `From:` matches real mail for sent/received counts.
fn resolve_who_owner_identities(
    cfg: &ripmail::Config,
    mailbox_ids: Option<&Vec<String>>,
) -> Option<Vec<String>> {
    fn identities_from_mailbox(mb: &ripmail::ResolvedMailbox) -> Vec<String> {
        let mut v = vec![mb.email.clone()];
        v.extend(mb.imap_aliases.iter().cloned());
        v
    }

    match mailbox_ids {
        Some(ids) if ids.len() == 1 => cfg
            .resolved_mailboxes()
            .iter()
            .find(|m| m.id == ids[0])
            .map(identities_from_mailbox),
        _ if cfg.resolved_mailboxes().len() == 1 => {
            Some(identities_from_mailbox(&cfg.resolved_mailboxes()[0]))
        }
        _ => {
            if cfg.resolved_mailboxes().is_empty() {
                return None;
            }
            let mut seen = HashSet::new();
            let mut v = Vec::new();
            for mb in cfg.resolved_mailboxes() {
                for addr in std::iter::once(mb.email.as_str())
                    .chain(mb.imap_aliases.iter().map(|s| s.as_str()))
                {
                    let t = addr.trim();
                    if t.is_empty() {
                        continue;
                    }
                    let n = normalize_address(t);
                    if seen.insert(n) {
                        v.push(t.to_string());
                    }
                }
            }
            (!v.is_empty()).then_some(v)
        }
    }
}

fn all_mailbox_identity_norms(cfg: &ripmail::Config) -> HashSet<String> {
    let mut s = HashSet::new();
    for mb in cfg.resolved_mailboxes() {
        s.insert(normalize_address(&mb.email));
        for a in &mb.imap_aliases {
            let t = a.trim();
            if !t.is_empty() {
                s.insert(normalize_address(t));
            }
        }
    }
    s
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run_search(
    query: Option<String>,
    limit: Option<usize>,
    from: Option<String>,
    to: Option<String>,
    subject: Option<String>,
    case_sensitive: bool,
    after: Option<String>,
    since: Option<String>,
    before: Option<String>,
    source: Option<String>,
    include_all: bool,
    category: Option<String>,
    text: bool,
    result_format: Option<String>,
    timings: bool,
) -> CliResult {
    let has_filters = from.is_some()
        || to.is_some()
        || subject.is_some()
        || after.is_some()
        || since.is_some()
        || before.is_some()
        || category.is_some()
        || source.is_some()
        || include_all;
    if query.is_none() && !has_filters {
        eprintln!(
            "error: at least one search constraint required: provide a <PATTERN> and/or one of --from, --to, --subject, --after, --since, --before, --category, --source"
        );
        std::process::exit(1);
    }

    let normalize_date_flag = |label: &str, raw: &str| {
        normalize_search_date_spec(raw).unwrap_or_else(|e| {
            eprintln!("error: invalid {label} value: {e}");
            std::process::exit(1);
        })
    };

    let after_date = since
        .or(after)
        .map(|s| normalize_date_flag("--after/--since", &s));
    let before_date = before
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| normalize_date_flag("--before", s));

    let cfg = load_cfg();
    let conn = db::open_file_for_queries(cfg.db_path())?;
    let owner = (!cfg.imap_user.trim().is_empty()).then(|| cfg.imap_user.clone());
    let mailbox_ids = search_mailbox_ids(&cfg, source.as_deref());
    let result = search_with_meta(
        &conn,
        &SearchOptions {
            query,
            case_sensitive,
            limit,
            from_address: from,
            to_address: to,
            subject,
            after_date,
            before_date,
            include_all,
            categories: category
                .as_deref()
                .map(parse_category_list)
                .unwrap_or_default(),
            owner_address: owner,
            owner_aliases: cfg.imap_aliases.clone(),
            mailbox_ids,
            ..Default::default()
        },
    )?;

    if text {
        let count = result.results.len();
        let total = result.total_matched.unwrap_or(count as i64);
        println!(
            "Found {count} result{}{}",
            if count == 1 { "" } else { "s" },
            if total > count as i64 {
                format!(" (of {total} total)")
            } else {
                String::new()
            }
        );
        for row in &result.results {
            println!(
                "{}  {}  {}",
                &row.date[..row.date.len().min(10)],
                row.from_address,
                row.subject
            );
        }
    } else {
        let preference = match result_format.as_deref() {
            Some("full") => SearchResultFormatPreference::Full,
            Some("slim") => SearchResultFormatPreference::Slim,
            _ => SearchResultFormatPreference::Auto,
        };
        let format = resolve_search_json_format(result.results.len(), preference, true);
        let rows: Vec<serde_json::Value> = match format {
            ripmail::SearchJsonFormat::Slim => result
                .results
                .iter()
                .map(search_result_to_slim_json_row)
                .collect(),
            ripmail::SearchJsonFormat::Full => result
                .results
                .iter()
                .map(|row| serde_json::to_value(row).unwrap())
                .collect(),
        };
        let mut out = serde_json::json!({
            "results": rows,
            "totalMatched": result.total_matched.unwrap_or(rows.len() as i64),
        });
        if !result.hints.is_empty() {
            out["hints"] = serde_json::json!(result.hints);
        }
        if let Some(ref nq) = result.normalized_query {
            out["normalizedQuery"] = serde_json::json!(nq);
        }
        if timings {
            out["timings"] = serde_json::to_value(&result.timings)?;
        }
        println!("{}", serde_json::to_string_pretty(&out)?);
    }
    Ok(())
}

fn print_send_result(result: &ripmail::SendResult, use_json: bool) -> CliResult {
    if use_json {
        println!("{}", serde_json::to_string_pretty(result)?);
    } else {
        print!("ok={} messageId={}", result.ok, result.message_id);
        if result.dry_run == Some(true) {
            print!(" dryRun=true");
        }
        println!();
        if let Some(response) = &result.smtp_response {
            println!("{response}");
        }
        for h in &result.hints {
            println!("{h}");
        }
    }
    Ok(())
}

fn print_attachment_table(message_id: &str, rows: &[ripmail::AttachmentListRow]) {
    if rows.is_empty() {
        println!("No attachments found.");
        return;
    }

    println!("Attachments for {message_id}:\n");
    println!(
        "  {:>4}  {:<40}  {:<38}  {:>9}  EXTRACTED",
        "#", "FILENAME", "MIME TYPE", "SIZE"
    );
    println!("  {}", "-".repeat(100));
    for row in rows {
        let size = format_attachment_size(row.size);
        let filename = if row.filename.len() > 40 {
            format!("{}...", &row.filename[..37])
        } else {
            format!("{:<40}", row.filename)
        };
        let mime = if row.mime_type.len() > 38 {
            format!("{}...", &row.mime_type[..35])
        } else {
            format!("{:<38}", row.mime_type)
        };
        println!(
            "  {:>4}  {}  {}  {:>9}  {}",
            row.index,
            filename,
            mime,
            size,
            if row.extracted { "yes" } else { "no" }
        );
    }
}

fn resolve_attachment<'a>(
    rows: &'a [ripmail::AttachmentListRow],
    index_or_name: &str,
) -> &'a ripmail::AttachmentListRow {
    if let Ok(index) = index_or_name.parse::<usize>() {
        if index >= 1 && index <= rows.len() {
            return &rows[index - 1];
        }
        eprintln!(
            "No attachment \"{}\" in this message. Use index 1-{}.",
            index_or_name,
            rows.len()
        );
        std::process::exit(1);
    }

    if let Some(attachment) = rows
        .iter()
        .find(|row| attachment_filename_matches(&row.filename, index_or_name))
    {
        return attachment;
    }

    eprintln!(
        "No attachment \"{}\" in this message. Use index 1-{} or exact filename.",
        index_or_name,
        rows.len()
    );
    std::process::exit(1);
}

fn attachment_filename_matches(stored: &str, query: &str) -> bool {
    if stored == query {
        return true;
    }
    let a: String = stored.nfc().collect();
    let b: String = query.nfc().collect();
    a == b
}
