//! Read raw `.eml` from disk (`ripmail read`).

use crate::ids::{resolve_message_id_and_raw_path, resolve_message_id_thread_and_raw_path};
use crate::sync::parse_message::{MailboxEntry, ReadForCli};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// JSON line for `ripmail read --json` (includes DB `thread_id`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMessageJson<'a> {
    #[serde(serialize_with = "crate::ids::serialize_borrowed_str_id_for_json")]
    pub message_id: &'a str,
    #[serde(serialize_with = "crate::ids::serialize_borrowed_str_id_for_json")]
    pub thread_id: &'a str,
    pub from: &'a MailboxEntry,
    pub subject: &'a str,
    pub date: &'a str,
    pub to: &'a [MailboxEntry],
    pub cc: &'a [MailboxEntry],
    pub bcc: &'a [MailboxEntry],
    pub reply_to: &'a [MailboxEntry],
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::ids::serialize_option_str_id_for_json"
    )]
    pub in_reply_to: Option<&'a str>,
    #[serde(
        skip_serializing_if = "<[_]>::is_empty",
        serialize_with = "crate::ids::serialize_borrowed_slice_str_ids_for_json"
    )]
    pub references: &'a [String],
    pub recipients_disclosed: bool,
    pub body: &'a str,
}

impl<'a> ReadMessageJson<'a> {
    pub fn from_parsed(r: &'a ReadForCli, thread_id: &'a str) -> Self {
        ReadMessageJson {
            message_id: &r.message_id,
            thread_id,
            from: &r.from,
            subject: &r.subject,
            date: &r.date,
            to: &r.to,
            cc: &r.cc,
            bcc: &r.bcc,
            reply_to: &r.reply_to,
            in_reply_to: r.in_reply_to.as_deref(),
            references: &r.references,
            recipients_disclosed: r.recipients_disclosed,
            body: &r.body_text,
        }
    }
}

fn format_mailbox(m: &MailboxEntry) -> String {
    match &m.name {
        Some(n) if !n.is_empty() => format!("{n} <{}>", m.address),
        _ => m.address.clone(),
    }
}

fn format_mailboxes_line(label: &str, entries: &[MailboxEntry]) -> Option<String> {
    if entries.is_empty() {
        return None;
    }
    let s = entries
        .iter()
        .map(format_mailbox)
        .collect::<Vec<_>>()
        .join(", ");
    Some(format!("{label}: {s}"))
}

/// Human-readable headers plus body (default `ripmail read` text mode).
pub fn format_read_message_text(r: &ReadForCli) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("From: {}", format_mailbox(&r.from)));
    if r.recipients_disclosed {
        if let Some(l) = format_mailboxes_line("To", &r.to) {
            lines.push(l);
        }
        if let Some(l) = format_mailboxes_line("Cc", &r.cc) {
            lines.push(l);
        }
        if let Some(l) = format_mailboxes_line("Bcc", &r.bcc) {
            lines.push(l);
        }
    } else {
        lines.push("To: (undisclosed — no To/Cc/Bcc in message headers)".to_string());
    }
    if let Some(l) = format_mailboxes_line("Reply-To", &r.reply_to) {
        lines.push(l);
    }
    lines.push(format!("Date: {}", r.date));
    lines.push(format!("Subject: {}", r.subject));
    lines.push(format!("Message-ID: {}", r.message_id));
    if let Some(ref irt) = r.in_reply_to {
        lines.push(format!("In-Reply-To: {irt}"));
    }
    if !r.references.is_empty() {
        lines.push(format!("References: {}", r.references.join(" ")));
    }
    lines.push(String::new());
    lines.push(r.body_text.clone());
    lines.join("\n")
}

/// Resolve a `messages.raw_path` (relative to `data_dir` / [`crate::config::Config::message_path_root`])
/// to an absolute path. When `mailbox_id` is set and the direct path is missing, tries
/// `{data_dir}/{mailbox_id}/{raw_path}` so multi-inbox mail under per-account dirs is found even if
/// `raw_path` was stored without a mailbox prefix (`maildir/...` only).
pub fn resolve_raw_path(raw_path: &str, data_dir: &Path, mailbox_id: Option<&str>) -> PathBuf {
    let p = Path::new(raw_path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        let direct = data_dir.join(raw_path);
        if direct.exists() {
            return direct;
        }
        if let Some(mb) = mailbox_id.map(str::trim).filter(|s| !s.is_empty()) {
            let prefixed = data_dir.join(mb).join(raw_path);
            if prefixed.exists() || raw_path.starts_with("maildir/") {
                return prefixed;
            }
        }
        let compat = data_dir.join("maildir").join(raw_path);
        if compat.exists() {
            return compat;
        }
        direct
    }
}

pub fn read_message_bytes(
    conn: &Connection,
    message_id: &str,
    data_dir: &Path,
) -> rusqlite::Result<std::io::Result<Vec<u8>>> {
    let Some((_mid, raw, mb)) = resolve_message_id_and_raw_path(conn, message_id)? else {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    };
    let path = resolve_raw_path(&raw, data_dir, mb.as_deref());
    Ok(read_raw_mail_bytes(&path))
}

/// Like [`read_message_bytes`], but returns canonical `message_id` and `thread_id` from the row.
pub fn read_message_bytes_with_thread(
    conn: &Connection,
    message_id: &str,
    data_dir: &Path,
) -> rusqlite::Result<std::io::Result<(Vec<u8>, String, String)>> {
    let Some((mid, thread_id, raw, mb)) = resolve_message_id_thread_and_raw_path(conn, message_id)?
    else {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    };
    let path = resolve_raw_path(&raw, data_dir, mb.as_deref());
    Ok(read_raw_mail_bytes(&path).map(|b| (b, mid, thread_id)))
}

/// Read `.eml` bytes or Apple `.emlx` (inner MIME) from disk.
fn read_raw_mail_bytes(path: &Path) -> std::io::Result<Vec<u8>> {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("emlx"))
        .unwrap_or(false)
    {
        crate::applemail::read_mail_file_bytes(path)
    } else {
        std::fs::read(path)
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_raw_path;
    use std::fs;

    #[test]
    fn resolve_raw_path_prefixed_maildir_when_mailbox_set() {
        let dir = tempfile::tempdir().unwrap();
        let mb = "acct1";
        let rel = "maildir/cur/x.eml";
        let full = dir.path().join(mb).join(rel);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(&full, b"hi").unwrap();
        let p = resolve_raw_path(rel, dir.path(), Some(mb));
        assert_eq!(p, full);
    }

    #[test]
    fn resolve_raw_path_direct_wins_when_exists() {
        let dir = tempfile::tempdir().unwrap();
        let rel = "maildir/cur/y.eml";
        let direct = dir.path().join(rel);
        fs::create_dir_all(direct.parent().unwrap()).unwrap();
        fs::write(&direct, b"a").unwrap();
        let p = resolve_raw_path(rel, dir.path(), Some("other"));
        assert_eq!(p, direct);
    }

    #[test]
    fn resolve_raw_path_legacy_compat_under_data_maildir() {
        let dir = tempfile::tempdir().unwrap();
        let rel = "cur/z.eml";
        let compat = dir.path().join("maildir").join(rel);
        fs::create_dir_all(compat.parent().unwrap()).unwrap();
        fs::write(&compat, b"b").unwrap();
        let p = resolve_raw_path(rel, dir.path(), None);
        assert_eq!(p, compat);
    }
}
