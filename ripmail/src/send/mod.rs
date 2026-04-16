//! Outbound mail — drafts, SMTP resolve, threading (`src/send` subset).

pub mod draft_body;
pub mod draft_list_json;
pub mod draft_llm;
pub mod draft_store;
pub mod forward_excerpt;
pub mod recipients;
pub mod smtp_resolve;
pub mod smtp_send;
pub mod threading;

pub use draft_body::{draft_markdown_to_plain_text, strip_leading_cli_body_flag};
pub use draft_list_json::build_draft_list_json_payload;
pub use draft_llm::{
    compose_forward_preamble_from_instruction, compose_new_draft_from_instruction,
    compose_reply_draft_from_instruction, rewrite_draft_with_instruction, RewriteDraftResult,
};
pub use draft_store::{
    apply_recipient_header_ops, archive_draft_to_sent, create_draft_id, draft_body_preview,
    draft_file_to_json, draft_list_slim_hint, format_draft_not_found_message,
    format_draft_view_text, list_draft_rows, list_drafts, normalize_draft_filename, read_draft,
    read_draft_in_data_dir, subject_to_slug, write_draft, DraftFile, DraftListFull, DraftListRow,
    DraftListSlim, DraftMeta, DraftRecipientCliArgs, RecipientHeaderOps,
};
pub use forward_excerpt::{
    compose_forward_draft_body, load_forward_source_excerpt, ForwardSourceExcerpt,
};
pub use recipients::{
    addresses_match, assert_send_recipients_allowed, filter_recipients_send_test,
    normalize_email_for_compare, split_address_list, SendTestMode, DEV_SEND_ALLOWLIST,
};
pub use smtp_resolve::resolve_smtp_for_imap_host;
pub use smtp_send::{
    send_simple_message, verify_smtp_credentials, verify_smtp_for_config, SendResult,
    SendSimpleFields,
};
pub use threading::extract_threading_headers;

use crate::config::{config_for_outbound_send, Config, MailboxImapAuthKind};
use crate::db;
use crate::ids::resolve_message_id;
use crate::mail_read::resolve_raw_path;
use crate::oauth::{google_oauth_credentials_present, google_oauth_token_path};
use crate::sync::parse_raw_message;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct SendPlan {
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    pub dry_run: bool,
}

/// Back-compat: validates plan; real send uses [`send_simple_message`].
pub fn plan_send(plan: &SendPlan) -> Result<(), String> {
    if plan.dry_run {
        return Ok(());
    }
    if plan.to.is_empty() {
        return Err("no recipients".into());
    }
    Err("use send_simple_message with Config (SMTP is implemented)".into())
}

/// True when the mailbox has credentials suitable for SMTP send (app password or Google OAuth token store).
#[must_use]
pub fn smtp_credentials_ready(cfg: &Config) -> bool {
    match cfg.imap_auth {
        MailboxImapAuthKind::AppPassword => {
            !cfg.imap_user.trim().is_empty() && !cfg.imap_password.is_empty()
        }
        MailboxImapAuthKind::GoogleOAuth => {
            !cfg.imap_user.trim().is_empty()
                && google_oauth_credentials_present(&cfg.ripmail_home, &cfg.mailbox_id)
        }
    }
}

/// Explains why [`smtp_credentials_ready`] is false (stderr / `Err` text for agents).
#[must_use]
pub fn smtp_credentials_unavailable_reason(cfg: &Config) -> String {
    match cfg.imap_auth {
        MailboxImapAuthKind::AppPassword => {
            if cfg.imap_user.trim().is_empty() {
                return "No IMAP user/email for this mailbox. Check config.json.".to_string();
            }
            if cfg.imap_password.is_empty() {
                return "No IMAP password loaded for the default mailbox. \
Ensure `~/.ripmail/<mailbox_id>/.env` contains `RIPMAIL_IMAP_PASSWORD`, or run `ripmail wizard`. \
From a git clone, the repo `.env` next to `Cargo.toml` overlays non-empty keys onto `~/.ripmail/.env` (see AGENTS.md)."
                    .to_string();
            }
            "SMTP credentials check failed unexpectedly.".to_string()
        }
        MailboxImapAuthKind::GoogleOAuth => {
            if cfg.imap_user.trim().is_empty() {
                return "No email for this mailbox (OAuth). Check config.json.".to_string();
            }
            if !google_oauth_credentials_present(&cfg.ripmail_home, &cfg.mailbox_id) {
                let path = google_oauth_token_path(&cfg.ripmail_home, &cfg.mailbox_id);
                return format!(
                    "Google OAuth tokens not found for mailbox {}. Expected {} (or RIPMAIL_GOOGLE_REFRESH_TOKEN in that mailbox's `.env`).",
                    cfg.mailbox_id,
                    path.display()
                );
            }
            "SMTP credentials check failed unexpectedly.".to_string()
        }
    }
}

/// Resolve SMTP/IMAP identity for sending a draft. Reply/forward use the mailbox that received the
/// source message (from draft frontmatter or the index). New drafts use optional `mailboxId` in
/// frontmatter (set by `ripmail draft new --mailbox`); omit for the default (first) mailbox.
pub fn resolve_send_config_for_draft(cfg: &Config, meta: &DraftMeta) -> Result<Config, String> {
    let kind = meta.kind.as_deref();
    let is_ref = kind == Some("reply") || kind == Some("forward");

    if is_ref {
        let natural = natural_mailbox_id_for_draft(cfg, meta)?;
        if let Some(nid) = natural.filter(|s| !s.is_empty()) {
            config_for_outbound_send(cfg, Some(&nid))
        } else {
            config_for_outbound_send(cfg, None)
        }
    } else {
        config_for_outbound_send(cfg, meta.mailbox_id.as_deref())
    }
}

fn mailbox_id_for_message_id(conn: &Connection, user_spec: &str) -> Result<Option<String>, String> {
    let Some(mid) = resolve_message_id(conn, user_spec).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let row: Option<String> = conn
        .query_row(
            "SELECT mailbox_id FROM messages WHERE message_id = ?1",
            [&mid],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    }))
}

fn natural_mailbox_id_for_draft(cfg: &Config, meta: &DraftMeta) -> Result<Option<String>, String> {
    if let Some(ref id) = meta.mailbox_id {
        let t = id.trim();
        if !t.is_empty() {
            return Ok(Some(t.to_string()));
        }
    }
    let needs_lookup = (meta.kind.as_deref() == Some("reply") && meta.source_message_id.is_some())
        || (meta.kind.as_deref() == Some("forward") && meta.forward_of.is_some());
    if !needs_lookup {
        return Ok(None);
    }
    // Avoid creating an empty index DB just to resolve mailbox (forward/new may run without sync).
    if !cfg.db_path().exists() {
        return Ok(None);
    }
    let conn = db::open_file(cfg.db_path()).map_err(|e| e.to_string())?;
    if meta.kind.as_deref() == Some("reply") {
        if let Some(ref sid) = meta.source_message_id {
            return mailbox_id_for_message_id(&conn, sid);
        }
    }
    if meta.kind.as_deref() == Some("forward") {
        if let Some(ref fid) = meta.forward_of {
            return mailbox_id_for_message_id(&conn, fid);
        }
    }
    Ok(None)
}

/// Send a draft by id from `{data_dir}/drafts/{id}.md` (`.md` optional in id).
///
/// Opens the SQLite index only when the draft is a **reply** and needs In-Reply-To / References
/// from the source message. **Forward** and **new** drafts do not touch the DB, so `ripmail send
/// <id>` stays responsive when another process holds the DB (e.g. background sync).
pub fn send_draft_by_id(
    cfg: &Config,
    data_dir: &Path,
    draft_id: &str,
    dry_run: bool,
) -> Result<SendResult, String> {
    let draft = read_draft_in_data_dir(data_dir, draft_id).map_err(|e| e.to_string())?;
    let send_cfg = resolve_send_config_for_draft(cfg, &draft.meta)?;
    if !smtp_credentials_ready(&send_cfg) {
        return Err(smtp_credentials_unavailable_reason(&send_cfg));
    }

    let to = draft
        .meta
        .to
        .as_ref()
        .filter(|v| !v.is_empty())
        .cloned()
        .ok_or_else(|| "Draft has no recipients (to:)".to_string())?;

    let cc = draft.meta.cc.as_ref().filter(|v| !v.is_empty()).cloned();
    let bcc = draft.meta.bcc.as_ref().filter(|v| !v.is_empty()).cloned();

    let mut in_reply_to = draft.meta.in_reply_to.clone();
    let mut references = draft.meta.references.clone();

    if draft.meta.kind.as_deref() == Some("reply")
        && draft
            .meta
            .source_message_id
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty())
    {
        let sid = draft.meta.source_message_id.as_ref().unwrap().trim();
        let conn = db::open_file(send_cfg.db_path()).map_err(|e| e.to_string())?;
        match load_threading_from_source_message(&conn, send_cfg.message_path_root(), sid) {
            Ok((irt, refs)) => {
                in_reply_to = Some(irt);
                references = Some(refs);
            }
            Err(e) => {
                let has_fm = in_reply_to
                    .as_ref()
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
                if !has_fm {
                    return Err(e);
                }
            }
        }
    }

    let text = draft_markdown_to_plain_text(&draft.body);
    let subject = draft
        .meta
        .subject
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "(no subject)".into());

    let fields = SendSimpleFields {
        to,
        cc,
        bcc,
        subject,
        text,
        in_reply_to,
        references,
    };

    let mut result = send_simple_message(&send_cfg, &fields, dry_run)?;
    if !dry_run && result.ok {
        let _ = archive_draft_to_sent(data_dir, &draft.id);
    }
    if result.ok {
        let referred = draft
            .meta
            .source_message_id
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                draft
                    .meta
                    .forward_of
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
            });
        if let Some(sid) = referred {
            result.hints = vec![referred_message_archive_hint(sid)];
        }
    }
    Ok(result)
}

/// Hint for JSON/text after sending a draft that references a source message (reply or forward).
fn referred_message_archive_hint(source_message_id: &str) -> String {
    let bare = crate::ids::message_id_for_json_output(source_message_id.trim());
    format!(
        "If the user is done with the original message, archive it locally: `ripmail archive {bare}`"
    )
}

fn ensure_brackets(id: &str) -> String {
    let t = id.trim();
    if t.is_empty() {
        return String::new();
    }
    if t.starts_with('<') && t.ends_with('>') {
        t.to_string()
    } else {
        format!("<{t}>")
    }
}

pub use crate::ids::normalize_message_id;

/// Load In-Reply-To / References from the source message raw `.eml` (reply threading).
pub fn load_threading_from_source_message(
    conn: &Connection,
    data_dir: &Path,
    source_message_id: &str,
) -> Result<(String, String), String> {
    let Some((_mid, raw_path, mailbox_id)) =
        crate::ids::resolve_message_id_and_raw_path(conn, source_message_id)
            .map_err(|e| e.to_string())?
    else {
        return Err(format!(
            "Cannot build reply threading: source message {source_message_id} is not in the local index. Run ripmail sync or ripmail refresh, then try again."
        ));
    };
    let path = resolve_raw_path(&raw_path, data_dir, mailbox_id.as_deref());
    let buf = std::fs::read(&path).map_err(|e| {
        format!(
            "Cannot build reply threading: could not read source message at {} ({e})",
            path.display()
        )
    })?;
    threading_headers_for_reply(&buf)
}

fn threading_headers_for_reply(raw: &[u8]) -> Result<(String, String), String> {
    let parsed = parse_raw_message(raw);
    let orig = ensure_brackets(parsed.message_id.trim());
    if orig.len() <= 2 {
        return Err("Cannot build reply threading: source message has no Message-ID.".into());
    }
    let (_, ref_ids) = extract_threading_headers(raw);
    let mut refs_parts: Vec<String> = ref_ids.into_iter().map(|s| ensure_brackets(&s)).collect();
    if !refs_parts.iter().any(|x| x == &orig) {
        refs_parts.push(orig.clone());
    }
    let references = refs_parts.join(" ");
    Ok((orig.clone(), references))
}

#[cfg(test)]
mod referred_hint_tests {
    use super::referred_message_archive_hint;

    #[test]
    fn referred_message_archive_hint_strips_brackets() {
        let h = referred_message_archive_hint("<abc@x>");
        assert!(h.contains("ripmail archive abc@x"));
        assert!(h.contains("If the user is done with the original message"));
    }
}
