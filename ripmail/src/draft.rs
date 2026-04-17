//! `ripmail draft` subcommands.

pub use crate::draft_args::{DraftIndexedMessageId, DraftReplyForwardLiteralBody};

/// Default subject when `draft new` is run without `--subject` (fill in later with `draft rewrite` / `draft edit`).
pub const DRAFT_NEW_PLACEHOLDER_SUBJECT: &str = "(no subject yet)";

/// Default body when `draft new` is run with only `--to` or without body content.
pub const DRAFT_NEW_PLACEHOLDER_BODY: &str = "(No body yet — use `ripmail draft rewrite <id> …` to set the body, or `ripmail draft edit <id> <instruction>` with LLM credentials.)";

use clap::{ArgAction, Subcommand};
use rusqlite::Connection;
use std::path::PathBuf;

use crate::config::{
    draft_compose_identity_for_mailbox, resolve_llm, Config, DraftComposeIdentity,
    LoadConfigOptions, ResolvedLlm,
};
use crate::ids::resolve_message_id;
use crate::search::SearchResultFormatPreference;
use crate::send::split_address_list;
use crate::send::{
    apply_recipient_header_ops, build_draft_list_json_payload, compose_forward_draft_body,
    compose_forward_preamble_from_instruction, compose_new_draft_from_instruction,
    compose_reply_draft_from_instruction, create_draft_id, draft_file_to_json,
    format_draft_view_text, list_draft_rows, load_forward_source_excerpt, read_draft_in_data_dir,
    rewrite_draft_with_instruction, write_draft, DraftMeta, DraftRecipientCliArgs,
    RecipientHeaderOps,
};

/// Appended to `ripmail draft new --help` (long help only).
const DRAFT_NEW_AFTER_LONG_HELP: &str = "\
Recommended: `ripmail draft new --to <addr> --instruction \"...\"` — LLM generates subject and body (requires LLM credentials per AGENTS.md). Omit `--subject`; do not combine `--subject` with `--instruction` (that path treats the message as explicit subject + body instead).

Use `--subject` with `--body` / `--body-file` only for verbatim text. `--to` alone creates a placeholder; refine with `ripmail draft edit <id>` or `draft rewrite`.
";

#[derive(Subcommand)]
pub enum DraftCmd {
    /// List drafts (JSON by default)
    List {
        #[arg(long, conflicts_with = "json")]
        text: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
        #[arg(long, value_parser = ["auto", "full", "slim"])]
        result_format: Option<String>,
    },
    /// Show one draft
    View {
        id: String,
        #[arg(long, conflicts_with = "json")]
        text: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
        #[arg(long)]
        with_body: bool,
    },
    /// Create a new draft (prefer `--instruction` for LLM compose; `--body` / `--body-file` are fallbacks for verbatim text)
    #[command(after_long_help = DRAFT_NEW_AFTER_LONG_HELP)]
    New {
        #[arg(long, help = "Recipient address(es). Required.")]
        to: Option<String>,
        #[arg(
            long,
            help = "Use with --body/--body-file for explicit text. Omit when using --instruction (LLM compose must not set --subject)."
        )]
        subject: Option<String>,
        #[arg(
            long,
            help = "LLM-generated subject and body from this text (requires LLM credentials; see AGENTS.md). Omit --subject for this path."
        )]
        instruction: Option<String>,
        #[arg(
            long,
            help = "Literal body text (fallback: exact quotes, templates, or compliance). Prefer --instruction or draft edit for natural prose."
        )]
        body: Option<String>,
        #[arg(
            long,
            help = "Same as --body but from a file (fallback for large verbatim bodies)."
        )]
        body_file: Option<PathBuf>,
        #[arg(long)]
        with_body: bool,
        #[arg(long, conflicts_with = "json")]
        text: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
        /// Send this draft from this source (email or id); omit for the default account
        #[arg(long, short = 'S')]
        source: Option<String>,
    },
    /// Reply draft from indexed message
    ///
    /// Prefer `--instruction` for LLM subject+body; otherwise optional `--body` / `--body-file` are literal fallbacks.
    Reply {
        #[command(flatten)]
        indexed: DraftIndexedMessageId,
        #[arg(long)]
        to: Option<String>,
        #[arg(long, conflicts_with = "instruction")]
        subject: Option<String>,
        #[arg(
            long,
            conflicts_with_all = ["body", "body_file", "subject"],
            help = "LLM-generated subject and reply body (requires LLM credentials; see AGENTS.md). Do not combine with --subject, --body, or --body-file."
        )]
        instruction: Option<String>,
        #[command(flatten)]
        literal_body: DraftReplyForwardLiteralBody,
        #[arg(long)]
        with_body: bool,
        #[arg(long, conflicts_with = "json")]
        text: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
        /// Send this draft from this source (email or id); omit for the default account
        #[arg(long, short = 'S')]
        source: Option<String>,
    },
    /// Forward draft from indexed message
    ///
    /// Prefer `--instruction` for an LLM preamble; optional `--body` / `--body-file` are literal fallbacks before the quoted original.
    Forward {
        #[command(flatten)]
        indexed: DraftIndexedMessageId,
        #[arg(long)]
        to: String,
        #[arg(long, conflicts_with = "instruction")]
        subject: Option<String>,
        #[arg(
            long,
            conflicts_with_all = ["body", "body_file", "subject"],
            help = "LLM-generated preamble before the forwarded block (requires LLM credentials). Do not combine with --subject, --body, or --body-file."
        )]
        instruction: Option<String>,
        #[command(flatten)]
        literal_body: DraftReplyForwardLiteralBody,
        #[arg(long)]
        with_body: bool,
        #[arg(long, conflicts_with = "json")]
        text: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
        /// Send this draft from this source (email or id); omit for the default account
        #[arg(long, short = 'S')]
        source: Option<String>,
    },
    /// LLM edit of an existing draft. Put `--to` / `--cc` / `--add-cc` / … before the instruction words, or use `--` before the instruction.
    ///
    /// Prefer this over `draft rewrite` for natural-language changes to tone or structure.
    Edit {
        id: String,
        #[arg(long)]
        subject: Option<String>,
        #[arg(long)]
        to: Option<String>,
        #[arg(long)]
        cc: Option<String>,
        #[arg(long)]
        bcc: Option<String>,
        #[arg(long = "add-to", action = ArgAction::Append, value_name = "ADDR")]
        add_to: Vec<String>,
        #[arg(long = "add-cc", action = ArgAction::Append, value_name = "ADDR")]
        add_cc: Vec<String>,
        #[arg(long = "add-bcc", action = ArgAction::Append, value_name = "ADDR")]
        add_bcc: Vec<String>,
        #[arg(long = "remove-to", action = ArgAction::Append, value_name = "ADDR")]
        remove_to: Vec<String>,
        #[arg(long = "remove-cc", action = ArgAction::Append, value_name = "ADDR")]
        remove_cc: Vec<String>,
        #[arg(long = "remove-bcc", action = ArgAction::Append, value_name = "ADDR")]
        remove_bcc: Vec<String>,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        instruction: Vec<String>,
        #[arg(long)]
        with_body: bool,
        #[arg(long, conflicts_with = "json")]
        text: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
    },
    /// Replace draft body (and optional headers) without LLM
    ///
    /// For natural-language revision, use `draft edit` instead.
    Rewrite {
        id: String,
        #[arg(long)]
        subject: Option<String>,
        #[arg(long)]
        to: Option<String>,
        #[arg(long)]
        cc: Option<String>,
        #[arg(long)]
        bcc: Option<String>,
        #[arg(long = "add-to", action = ArgAction::Append, value_name = "ADDR")]
        add_to: Vec<String>,
        #[arg(long = "add-cc", action = ArgAction::Append, value_name = "ADDR")]
        add_cc: Vec<String>,
        #[arg(long = "add-bcc", action = ArgAction::Append, value_name = "ADDR")]
        add_bcc: Vec<String>,
        #[arg(long = "remove-to", action = ArgAction::Append, value_name = "ADDR")]
        remove_to: Vec<String>,
        #[arg(long = "remove-cc", action = ArgAction::Append, value_name = "ADDR")]
        remove_cc: Vec<String>,
        #[arg(long = "remove-bcc", action = ArgAction::Append, value_name = "ADDR")]
        remove_bcc: Vec<String>,
        #[arg(long)]
        keep_body: bool,
        #[arg(long)]
        body_file: Option<PathBuf>,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        body_words: Vec<String>,
        #[arg(long)]
        with_body: bool,
        #[arg(long, conflicts_with = "json")]
        text: bool,
        #[arg(long, conflicts_with = "text")]
        json: bool,
    },
}

fn parse_result_format(s: Option<&str>) -> SearchResultFormatPreference {
    match s {
        Some("full") => SearchResultFormatPreference::Full,
        Some("slim") => SearchResultFormatPreference::Slim,
        _ => SearchResultFormatPreference::Auto,
    }
}

fn read_literal_body_fallback(
    body: Option<String>,
    body_file: Option<&std::path::PathBuf>,
) -> Result<String, std::io::Error> {
    if let Some(p) = body_file {
        return std::fs::read_to_string(p);
    }
    Ok(body.unwrap_or_default())
}

fn draft_identity_for_compose(
    cfg: &Config,
    mailbox_cli: Option<&str>,
    mailbox_from_row: Option<&str>,
) -> Option<DraftComposeIdentity> {
    let spec = mailbox_cli
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            mailbox_from_row
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        });
    draft_compose_identity_for_mailbox(&cfg.ripmail_home, cfg.resolved_mailboxes(), spec.as_deref())
}

fn resolve_llm_for_draft(
    ctx: &'static str,
) -> Result<(ResolvedLlm, tokio::runtime::Runtime), String> {
    let llm = resolve_llm(&LoadConfigOptions {
        home: std::env::var("RIPMAIL_HOME").ok().map(PathBuf::from),
        env: None,
    })
    .map_err(|e| format!("ripmail draft {ctx}: {e}"))?;
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    Ok((llm, rt))
}

/// Drop mistaken `--body` tokens from `draft edit` / `draft rewrite` trailing args (BUG-054). These
/// subcommands have no `--body` flag; after `--`, `--body` parses as a literal token.
fn drop_leading_trailing_body_flag_tokens(mut tokens: Vec<String>) -> Vec<String> {
    while tokens.first().is_some_and(|s| s == "--body") {
        tokens.remove(0);
    }
    tokens
}

/// In **JSON** mode (default for mutating draft commands), the optional banner goes to **stderr** so **stdout is only JSON** (pipe-friendly for `jq`). In **`--text`** mode, the banner stays on stdout above the draft view.
fn print_draft_output(
    banner: Option<&str>,
    d: &crate::send::DraftFile,
    text: bool,
    with_body: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(b) = banner {
        if text {
            println!("{b}");
        } else {
            eprintln!("{b}");
        }
    }
    if text {
        println!("{}", format_draft_view_text(d));
    } else {
        let v = draft_file_to_json(d, with_body);
        println!("{}", serde_json::to_string_pretty(&v)?);
    }
    Ok(())
}

pub fn run_draft(
    cmd: DraftCmd,
    cfg: &Config,
    conn: Option<&Connection>,
) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = &cfg.data_dir;
    let drafts_dir = data_dir.join("drafts");

    match cmd {
        DraftCmd::List {
            text,
            json: _,
            result_format,
        } => {
            let pref = parse_result_format(result_format.as_deref());
            let rows = list_draft_rows(&drafts_dir)?;
            if text {
                use crate::search::{resolve_search_json_format, SearchJsonFormat};
                let fmt = resolve_search_json_format(rows.len(), pref, true);
                for r in &rows {
                    println!(
                        "{}\t{}\t{}\t{}",
                        r.id,
                        r.kind,
                        r.subject.as_deref().unwrap_or(""),
                        r.path.display()
                    );
                    if matches!(fmt, SearchJsonFormat::Full) && !r.body_preview.trim().is_empty() {
                        let preview: String = r.body_preview.chars().take(120).collect();
                        let ellip = if r.body_preview.chars().count() > 120 {
                            "…"
                        } else {
                            ""
                        };
                        println!("    {preview}{ellip}");
                    }
                }
                if matches!(fmt, SearchJsonFormat::Slim) && !rows.is_empty() {
                    println!();
                    println!("{}", crate::send::draft_list_slim_hint());
                }
            } else {
                let v = build_draft_list_json_payload(&rows, pref);
                println!("{}", serde_json::to_string_pretty(&v)?);
            }
        }
        DraftCmd::View {
            id,
            text,
            json: _,
            with_body,
        } => {
            let d = read_draft_in_data_dir(data_dir, &id).map_err(|e| e.to_string())?;
            if text {
                println!("{}", format_draft_view_text(&d));
            } else {
                let v = draft_file_to_json(&d, with_body);
                println!("{}", serde_json::to_string_pretty(&v)?);
            }
        }
        DraftCmd::New {
            to,
            subject,
            instruction,
            body,
            body_file,
            with_body,
            text,
            json: _,
            source,
        } => {
            let Some(to_s) = to.filter(|s| !s.trim().is_empty()) else {
                return Err("ripmail draft new requires --to".into());
            };
            let to_list = split_address_list(&to_s);
            let subj_opt = subject
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let instr_opt = instruction
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            // LLM compose: --instruction (no --subject). No stdin for instruction (avoids hangs in non-TTY).
            let use_llm = subj_opt.is_none() && instr_opt.is_some();
            let has_explicit_body = body.is_some() || body_file.is_some();

            let (subj, body_s) = if use_llm {
                let instr = instr_opt.unwrap();
                let (llm, rt) = resolve_llm_for_draft("new (LLM compose)")?;
                let compose_id = draft_identity_for_compose(cfg, source.as_deref(), None);
                rt.block_on(compose_new_draft_from_instruction(
                    to_list.clone(),
                    &instr,
                    &llm,
                    compose_id.as_ref(),
                ))?
            } else if let Some(subj) = subj_opt {
                let b = read_literal_body_fallback(body, body_file.as_ref())?;
                (subj, b)
            } else if has_explicit_body {
                // No subject but --body and/or --body_file: placeholder subject + that content (no stdin).
                let b = read_literal_body_fallback(body, body_file.as_ref())?;
                (DRAFT_NEW_PLACEHOLDER_SUBJECT.to_string(), b)
            } else {
                // Only --to (or nothing else): placeholder subject + body; edit/rewrite later.
                (
                    DRAFT_NEW_PLACEHOLDER_SUBJECT.to_string(),
                    DRAFT_NEW_PLACEHOLDER_BODY.to_string(),
                )
            };
            let id = create_draft_id(&drafts_dir, &subj)?;
            let mailbox_id = source
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let meta = DraftMeta {
                kind: Some("new".into()),
                to: Some(to_list),
                subject: Some(subj),
                mailbox_id,
                ..Default::default()
            };
            write_draft(&drafts_dir, &id, &meta, &body_s)?;
            let d = read_draft_in_data_dir(data_dir, &id).map_err(|e| e.to_string())?;
            print_draft_output(
                Some(&format!("Draft updated (new): {id}")),
                &d,
                text,
                with_body,
            )?;
        }
        DraftCmd::Reply {
            indexed,
            to,
            subject,
            instruction,
            literal_body,
            with_body,
            text,
            json: _,
            source,
        } => {
            let message_id = indexed
                .message_id_flag
                .or(indexed.message_id_pos)
                .ok_or_else(|| {
                    "Missing message id: pass it as the first argument or use --message-id <id>"
                        .to_string()
                })?;
            let Some(conn) = conn else {
                return Err(
                    "internal error: draft reply requires the local database connection".into(),
                );
            };
            let Some(mid) = resolve_message_id(conn, &message_id)? else {
                return Err(format!("Message not found: {message_id}").into());
            };
            let row: Option<(String, String, String, String, String)> = conn
                .query_row(
                    "SELECT message_id, from_address, subject, thread_id, source_id FROM messages WHERE message_id = ?1",
                    [&mid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .ok();
            let Some((msg_id, from_addr, subj_row, thread_id, mb_row)) = row else {
                return Err(format!("Message not found: {message_id}").into());
            };
            let to_list = if let Some(t) = to.filter(|s| !s.trim().is_empty()) {
                split_address_list(&t)
            } else {
                vec![from_addr]
            };
            let instr_opt = instruction
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let use_llm = instr_opt.is_some();
            let mailbox_for_path = source.as_deref().map(str::trim).filter(|s| !s.is_empty());
            let (subj, body_s) = if use_llm {
                let excerpt = load_forward_source_excerpt(
                    conn,
                    cfg.message_path_root(),
                    &msg_id,
                    mailbox_for_path,
                )?;
                let instr = instr_opt.unwrap();
                let (llm, rt) = resolve_llm_for_draft("reply (LLM compose)")?;
                let mb_from = if mb_row.trim().is_empty() {
                    None
                } else {
                    Some(mb_row.as_str())
                };
                let compose_id = draft_identity_for_compose(cfg, source.as_deref(), mb_from);
                rt.block_on(compose_reply_draft_from_instruction(
                    to_list.clone(),
                    &instr,
                    &excerpt,
                    &llm,
                    compose_id.as_ref(),
                ))?
            } else {
                let subj = subject.unwrap_or_else(|| {
                    if subj_row.starts_with("Re:") {
                        subj_row.clone()
                    } else {
                        format!("Re: {subj_row}")
                    }
                });
                let body_s =
                    read_literal_body_fallback(literal_body.body, literal_body.body_file.as_ref())?;
                (subj, body_s)
            };
            let id = create_draft_id(&drafts_dir, &subj)?;
            let mailbox_id_meta = source
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    if mb_row.trim().is_empty() {
                        None
                    } else {
                        Some(mb_row)
                    }
                });
            let meta = DraftMeta {
                kind: Some("reply".into()),
                to: Some(to_list),
                subject: Some(subj),
                source_message_id: Some(msg_id),
                thread_id: Some(thread_id),
                mailbox_id: mailbox_id_meta,
                ..Default::default()
            };
            write_draft(&drafts_dir, &id, &meta, &body_s)?;
            let d = read_draft_in_data_dir(data_dir, &id).map_err(|e| e.to_string())?;
            print_draft_output(
                Some(&format!("Draft updated (reply): {id}")),
                &d,
                text,
                with_body,
            )?;
        }
        DraftCmd::Forward {
            indexed,
            to,
            subject,
            instruction,
            literal_body,
            with_body,
            text,
            json: _,
            source,
        } => {
            let message_id = indexed
                .message_id_flag
                .or(indexed.message_id_pos)
                .ok_or_else(|| {
                    "Missing message id: pass it as the first argument or use --message-id <id>"
                        .to_string()
                })?;
            let Some(conn) = conn else {
                return Err(
                    "internal error: draft forward requires the local database connection".into(),
                );
            };
            let Some(mid) = resolve_message_id(conn, &message_id)? else {
                return Err(format!("Message not found: {message_id}").into());
            };
            let row: Option<(String, String, String, String)> = conn
                .query_row(
                    "SELECT message_id, subject, thread_id, source_id FROM messages WHERE message_id = ?1",
                    [&mid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .ok();
            let Some((msg_id, subj_row, thread_id, mb_row)) = row else {
                return Err(format!("Message not found: {message_id}").into());
            };
            let to_list = split_address_list(&to);
            let instr_opt = instruction
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let use_llm = instr_opt.is_some();
            let mailbox_for_path = source.as_deref().map(str::trim).filter(|s| !s.is_empty());
            let excerpt = load_forward_source_excerpt(
                conn,
                cfg.message_path_root(),
                &msg_id,
                mailbox_for_path,
            )?;
            let subj = if use_llm {
                format!("Fwd: {subj_row}")
            } else {
                subject.unwrap_or_else(|| format!("Fwd: {subj_row}"))
            };
            let pre = if use_llm {
                let instr = instr_opt.unwrap();
                let (llm, rt) = resolve_llm_for_draft("forward (LLM preamble)")?;
                let mb_from = if mb_row.trim().is_empty() {
                    None
                } else {
                    Some(mb_row.as_str())
                };
                let compose_id = draft_identity_for_compose(cfg, source.as_deref(), mb_from);
                rt.block_on(compose_forward_preamble_from_instruction(
                    to_list.clone(),
                    &instr,
                    &excerpt,
                    &llm,
                    compose_id.as_ref(),
                ))?
            } else {
                read_literal_body_fallback(literal_body.body, literal_body.body_file.as_ref())?
            };
            let body_s = compose_forward_draft_body(&pre, &excerpt);
            let id = create_draft_id(&drafts_dir, &subj)?;
            let mailbox_id_meta = source
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    if mb_row.trim().is_empty() {
                        None
                    } else {
                        Some(mb_row)
                    }
                });
            let meta = DraftMeta {
                kind: Some("forward".into()),
                to: Some(to_list),
                subject: Some(subj),
                forward_of: Some(msg_id),
                thread_id: Some(thread_id),
                mailbox_id: mailbox_id_meta,
                ..Default::default()
            };
            write_draft(&drafts_dir, &id, &meta, &body_s)?;
            let d = read_draft_in_data_dir(data_dir, &id).map_err(|e| e.to_string())?;
            print_draft_output(
                Some(&format!("Draft updated (forward): {id}")),
                &d,
                text,
                with_body,
            )?;
        }
        DraftCmd::Edit {
            id,
            subject,
            to,
            cc,
            bcc,
            add_to,
            add_cc,
            add_bcc,
            remove_to,
            remove_cc,
            remove_bcc,
            instruction,
            with_body,
            text,
            json: _,
        } => {
            let instr = drop_leading_trailing_body_flag_tokens(
                instruction
                    .into_iter()
                    .filter(|a| a != "--text" && a != "--with-body" && a != "--json")
                    .collect(),
            )
            .join(" ")
            .trim()
            .to_string();
            if instr.is_empty() {
                return Err(
                    "ripmail draft edit: instruction required (words after the draft id).".into(),
                );
            }
            let (llm, rt) = resolve_llm_for_draft("edit")?;
            let d = read_draft_in_data_dir(data_dir, &id).map_err(|e| e.to_string())?;
            let compose_id = draft_identity_for_compose(cfg, None, d.meta.mailbox_id.as_deref());
            let revised = rt.block_on(rewrite_draft_with_instruction(
                &d,
                &instr,
                &llm,
                compose_id.as_ref(),
            ))?;
            let mut meta = d.meta.clone();
            if let Some(s) = revised.subject {
                meta.subject = Some(s);
            }
            if let Some(s) = subject {
                meta.subject = Some(s);
            }
            let ops = RecipientHeaderOps::from(DraftRecipientCliArgs {
                to,
                cc,
                bcc,
                add_to,
                add_cc,
                add_bcc,
                remove_to,
                remove_cc,
                remove_bcc,
            });
            apply_recipient_header_ops(&mut meta, &ops);
            write_draft(&drafts_dir, &d.id, &meta, &revised.body)?;
            let d2 = read_draft_in_data_dir(data_dir, &id).map_err(|e| e.to_string())?;
            print_draft_output(
                Some(&format!("Draft updated (edit): {id}")),
                &d2,
                text,
                with_body,
            )?;
        }
        DraftCmd::Rewrite {
            id,
            subject,
            to,
            cc,
            bcc,
            add_to,
            add_cc,
            add_bcc,
            remove_to,
            remove_cc,
            remove_bcc,
            keep_body,
            body_file,
            body_words,
            with_body,
            text,
            json: _,
        } => {
            let d = read_draft_in_data_dir(data_dir, &id).map_err(|e| e.to_string())?;
            let has_body_from_file = body_file.is_some();
            let has_body_from_words = !body_words.is_empty();
            if keep_body && (has_body_from_file || has_body_from_words) {
                return Err(
                    "ripmail draft rewrite: cannot use --keep-body with a body from --body-file or trailing text."
                        .into(),
                );
            }
            let header_only_changes = subject.is_some()
                || to.is_some()
                || cc.is_some()
                || bcc.is_some()
                || !add_to.is_empty()
                || !add_cc.is_empty()
                || !add_bcc.is_empty()
                || !remove_to.is_empty()
                || !remove_cc.is_empty()
                || !remove_bcc.is_empty();
            let body = if let Some(ref p) = body_file {
                std::fs::read_to_string(p)?
            } else if has_body_from_words {
                drop_leading_trailing_body_flag_tokens(body_words).join(" ")
            } else if keep_body || header_only_changes {
                d.body.clone()
            } else {
                return Err(
                    "ripmail draft rewrite: body required (trailing text, --body-file, or recipient/subject flags with implicit --keep-body; use --keep-body to set body unchanged explicitly)."
                        .into(),
                );
            };
            let mut meta = d.meta.clone();
            if let Some(s) = subject {
                meta.subject = Some(s);
            }
            let ops = RecipientHeaderOps::from(DraftRecipientCliArgs {
                to,
                cc,
                bcc,
                add_to,
                add_cc,
                add_bcc,
                remove_to,
                remove_cc,
                remove_bcc,
            });
            apply_recipient_header_ops(&mut meta, &ops);
            write_draft(&drafts_dir, &d.id, &meta, body.trim_end())?;
            let d2 = read_draft_in_data_dir(data_dir, &id).map_err(|e| e.to_string())?;
            print_draft_output(
                Some(&format!("Draft updated (rewrite): {id}")),
                &d2,
                text,
                with_body,
            )?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod trailing_body_flag_tests {
    use super::drop_leading_trailing_body_flag_tokens;

    #[test]
    fn drops_one_or_more_leading_body_tokens() {
        assert_eq!(
            drop_leading_trailing_body_flag_tokens(vec!["--body".into(), "hi".into()]),
            vec!["hi"]
        );
        assert_eq!(
            drop_leading_trailing_body_flag_tokens(vec![
                "--body".into(),
                "--body".into(),
                "x".into()
            ]),
            vec!["x"]
        );
        assert_eq!(
            drop_leading_trailing_body_flag_tokens(vec!["keep".into()]),
            vec!["keep"]
        );
    }
}
