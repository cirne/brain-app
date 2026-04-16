//! Best-effort IMAP archive when `mailboxManagement` is enabled.
//!
//! **Gmail fast path (OPP-049):** When `messages.labels` (from sync `X-GM-LABELS`) shows `\Inbox` and
//! the row is in `[Gmail]/All Mail`, we `SELECT` that folder and issue
//! `UID STORE <uid> -X-GM-LABELS (\Inbox)` — no `UID SEARCH`. Google documents `+X-GM-LABELS` for
//! adding labels; removal uses `-X-GM-LABELS` in the same attribute position ([IMAP extensions](https://developers.google.com/workspace/gmail/imap/imap-extensions)).
//! **Latency:** Gmail often spends many seconds on `SELECT [Gmail]/All Mail` on large accounts; the
//! `UID STORE` itself is usually quick — see stderr timing lines after each step.
//!
//! **Gmail fallback:** `SELECT INBOX`, **`UID SEARCH X-GM-RAW "rfc822msgid:…"`** (or quoted
//! `HEADER Message-ID`), then **`UID MOVE`** to `[Gmail]/All Mail`. Used when labels are empty,
//! indexed labels do not show Inbox (or fast path not applicable), non-All-Mail folder, or fast
//! `UID STORE` fails.
//!
//! Generic IMAP: MOVE from the indexed folder to `Archive` or `[Gmail]/Archive`.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use chrono::Utc;
use imap::Session;
use rusqlite::Connection;

use crate::config::{resolve_mailbox_spec, Config, MailboxImapAuthKind};
use crate::ids::resolve_message_id;
use crate::sync::transport::connect_imap_for_resolved_mailbox;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderArchiveOutcome {
    #[serde(rename = "attempted")]
    pub attempted: bool,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: Option<String>,
}

/// If mailbox management allows archive, connect and move the message on the server.
/// Gmail: fast path via stored `labels` when possible; else INBOX search + MOVE.
/// Other hosts: MOVE from the indexed folder to `Archive` or `[Gmail]/Archive`.
pub fn provider_archive_message(
    cfg: &Config,
    conn: &Connection,
    message_id: &str,
    unarchive: bool,
) -> ProviderArchiveOutcome {
    if !cfg.mailbox_management_enabled || !cfg.mailbox_management_allow_archive {
        return ProviderArchiveOutcome {
            attempted: false,
            ok: false,
            error: None,
        };
    }

    if unarchive {
        return ProviderArchiveOutcome {
            attempted: false,
            ok: false,
            error: Some("Provider unarchive is not implemented".into()),
        };
    }

    let canonical_id = match resolve_message_id(conn, message_id) {
        Ok(Some(id)) => id,
        Ok(None) => {
            return ProviderArchiveOutcome {
                attempted: true,
                ok: false,
                error: Some("Message not found in index".into()),
            };
        }
        Err(e) => {
            return ProviderArchiveOutcome {
                attempted: true,
                ok: false,
                error: Some(e.to_string()),
            };
        }
    };

    let row: Option<(String, String, i64, String)> = conn
        .query_row(
            "SELECT mailbox_id, folder, uid, labels FROM messages WHERE message_id = ?1",
            [&canonical_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();
    let Some((mailbox_id_row, folder, uid, labels_json)) = row else {
        return ProviderArchiveOutcome {
            attempted: true,
            ok: false,
            error: Some("Message not found in index".into()),
        };
    };

    let mb = if mailbox_id_row.trim().is_empty() {
        cfg.resolved_mailboxes.first()
    } else {
        resolve_mailbox_spec(&cfg.resolved_mailboxes, &mailbox_id_row)
    };
    let Some(mb) = mb else {
        return ProviderArchiveOutcome {
            attempted: true,
            ok: false,
            error: Some("Unknown mailbox for message".into()),
        };
    };

    if mb.imap_user.trim().is_empty() {
        return ProviderArchiveOutcome {
            attempted: true,
            ok: false,
            error: Some("Missing IMAP user".into()),
        };
    }
    if mb.imap_auth == MailboxImapAuthKind::AppPassword && mb.imap_password.trim().is_empty() {
        return ProviderArchiveOutcome {
            attempted: true,
            ok: false,
            error: Some("Missing IMAP password".into()),
        };
    }
    if mb.imap_auth == MailboxImapAuthKind::GoogleOAuth
        && !crate::oauth::google_oauth_credentials_present(&cfg.ripmail_home, &mb.id)
    {
        return ProviderArchiveOutcome {
            attempted: true,
            ok: false,
            error: Some("Missing Google OAuth token".into()),
        };
    }

    let env_file = crate::config::read_ripmail_env_file(&cfg.ripmail_home);
    let process_env: HashMap<String, String> = std::env::vars().collect();

    eprintln!("[{}] Connecting to IMAP...", imap_archive_stderr_ts());
    let mut session =
        match connect_imap_for_resolved_mailbox(&cfg.ripmail_home, mb, &env_file, &process_env) {
            Ok(s) => s,
            Err(e) => {
                eprintln!(
                    "[{}] IMAP connection failed: {}",
                    imap_archive_stderr_ts(),
                    e
                );
                return ProviderArchiveOutcome {
                    attempted: true,
                    ok: false,
                    error: Some(e.to_string()),
                };
            }
        };
    eprintln!("[{}] Connected.", imap_archive_stderr_ts());

    let is_gmail = mb.imap_host.to_lowercase().contains("gmail");

    let result = if is_gmail {
        gmail_provider_archive(&mut session, &canonical_id, &folder, uid, &labels_json)
    } else {
        eprintln!(
            "[{}] Provider archive path: generic IMAP (not Gmail) — MOVE from folder {:?} uid={}.",
            imap_archive_stderr_ts(),
            folder.trim(),
            uid
        );
        generic_archive(&mut session, &folder, uid as u32)
    };

    let outcome = match &result {
        Ok(()) => {
            eprintln!("[{}] IMAP archive finished.", imap_archive_stderr_ts());
            ProviderArchiveOutcome {
                attempted: true,
                ok: true,
                error: None,
            }
        }
        Err(e) => {
            eprintln!(
                "[{}] IMAP archive finished with error: {}",
                imap_archive_stderr_ts(),
                e
            );
            ProviderArchiveOutcome {
                attempted: true,
                ok: false,
                error: Some(e.clone()),
            }
        }
    };

    // Drop the TCP session without IMAP LOGOUT. Some servers (including Gmail) can respond
    // slowly to LOGOUT; closing the socket is enough for a one-shot CLI.
    drop(session);

    outcome
}

fn imap_archive_stderr_ts() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S%.3f UTC").to_string()
}

/// Gmail All Mail folder names (sync default for `imap.gmail.com`).
const GMAIL_ALL_MAIL: &str = "[Gmail]/All Mail";
const GMAIL_ALL_MAIL_GOOGLEMAIL: &str = "[GoogleMail]/All Mail";

fn folder_is_gmail_all_mail(folder: &str) -> bool {
    let f = folder.trim();
    f.eq_ignore_ascii_case(GMAIL_ALL_MAIL) || f.eq_ignore_ascii_case(GMAIL_ALL_MAIL_GOOGLEMAIL)
}

fn gmail_label_is_inbox(label: &str) -> bool {
    let mut t = label.trim();
    // Gmail uses `\Inbox`; JSON round-trips or edge cases may leave extra leading `\` characters.
    while let Some(rest) = t.strip_prefix('\\') {
        t = rest;
    }
    t.eq_ignore_ascii_case("inbox")
}

fn gmail_labels_include_inbox(labels: &[String]) -> bool {
    labels.iter().any(|l| gmail_label_is_inbox(l))
}

fn parse_message_labels_json_with_ok(raw: &str) -> (Vec<String>, bool) {
    match serde_json::from_str::<Vec<String>>(raw) {
        Ok(v) => (v, true),
        Err(_) => (Vec::new(), false),
    }
}

/// Short list of Gmail labels for stderr (avoid huge lines).
fn gmail_labels_preview(labels: &[String]) -> String {
    if labels.is_empty() {
        "(none)".to_string()
    } else {
        let s = labels.join(", ");
        const MAX: usize = 160;
        if s.len() > MAX {
            format!("{}…", &s[..MAX])
        } else {
            s
        }
    }
}

/// Gmail `provider_archive_message` body: fast path from stored `labels`, else search + MOVE.
fn gmail_provider_archive(
    session: &mut Session<imap::Connection>,
    message_id: &str,
    folder: &str,
    uid: i64,
    labels_json: &str,
) -> Result<(), String> {
    let (labels, labels_parse_ok) = parse_message_labels_json_with_ok(labels_json);
    let want_fast = folder_is_gmail_all_mail(folder) && !labels.is_empty();
    let has_inbox = gmail_labels_include_inbox(&labels);

    eprintln!(
        "[{}] Gmail archive: folder={:?} uid={} labels_from_index={} ({} labels, parse_ok={}, includes_Inbox={})",
        imap_archive_stderr_ts(),
        folder.trim(),
        uid,
        gmail_labels_preview(&labels),
        labels.len(),
        labels_parse_ok,
        has_inbox,
    );

    if want_fast && has_inbox {
        eprintln!(
            "[{}] Gmail archive path: fast — UID STORE remove Inbox label (X-GM-LABELS) on All Mail uid.",
            imap_archive_stderr_ts()
        );
        match gmail_try_remove_inbox_label_uid_store(session, folder, uid as u32) {
            Ok(()) => {
                eprintln!(
                    "[{}] Gmail archive: fast path succeeded (Inbox label removed via STORE).",
                    imap_archive_stderr_ts()
                );
                return Ok(());
            }
            Err(e) => {
                eprintln!(
                    "[{}] Gmail archive: fast path failed ({e}); falling back to INBOX search + MOVE.",
                    imap_archive_stderr_ts()
                );
            }
        }
    }
    eprintln!(
        "[{}] Gmail archive path: fallback — INBOX UID SEARCH (X-GM-RAW / HEADER) then UID MOVE (empty/unknown labels, indexed labels without Inbox, non-All-Mail folder, or fast STORE failed).",
        imap_archive_stderr_ts()
    );
    gmail_archive_search_and_move(session, message_id)
}

/// `SELECT` All Mail + `UID STORE … -X-GM-LABELS (\Inbox)` (Gmail extension).
fn gmail_try_remove_inbox_label_uid_store(
    session: &mut Session<imap::Connection>,
    folder: &str,
    uid: u32,
) -> Result<(), String> {
    let t_select = Instant::now();
    session.select(folder).map_err(|e| e.to_string())?;
    eprintln!(
        "[{}] Gmail archive: SELECT {:?} took {}ms",
        imap_archive_stderr_ts(),
        folder.trim(),
        t_select.elapsed().as_millis()
    );

    let t_store = Instant::now();
    session
        .uid_store(uid.to_string(), "-X-GM-LABELS (\\Inbox)")
        .map_err(|e| e.to_string())?;
    eprintln!(
        "[{}] Gmail archive: UID STORE -X-GM-LABELS (Inbox) uid={} took {}ms",
        imap_archive_stderr_ts(),
        uid,
        t_store.elapsed().as_millis()
    );
    Ok(())
}

/// Gmail archive: SELECT INBOX, find message by Message-ID, MOVE to `[Gmail]/All Mail`.
/// This removes the Inbox label without deleting the message (it stays in All Mail).
/// If the message is not found in INBOX it is already archived — treat as success.
fn gmail_archive_search_and_move(
    session: &mut Session<imap::Connection>,
    message_id: &str,
) -> Result<(), String> {
    session.select("INBOX").map_err(|e| e.to_string())?;

    let bare_id = message_id.trim_matches(|c| c == '<' || c == '>');
    let bracketed = format!("<{bare_id}>");

    let uids = gmail_search_inbox_uid(session, bare_id, &bracketed)?;

    let Some(&inbox_uid) = uids.iter().next() else {
        eprintln!(
            "[{}] Gmail archive fallback: no INBOX match for Message-ID (already not in Inbox on server).",
            imap_archive_stderr_ts()
        );
        return Ok(());
    };

    eprintln!(
        "[{}] Gmail archive fallback: found INBOX uid={} — UID MOVE to [Gmail]/All Mail.",
        imap_archive_stderr_ts(),
        inbox_uid
    );
    session
        .uid_mv(inbox_uid.to_string(), "[Gmail]/All Mail")
        .map_err(|e| e.to_string())?;
    eprintln!(
        "[{}] Gmail archive fallback: UID MOVE completed.",
        imap_archive_stderr_ts()
    );
    Ok(())
}

/// IMAP `quoted` string (RFC 3501) for search command arguments.
fn imap_quoted(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Find the message UID in INBOX. Prefer Gmail `X-GM-RAW` (indexed); fallback to `HEADER
/// Message-ID` with quoted values (unquoted HEADER is slow / ambiguous on large mailboxes).
fn gmail_search_inbox_uid(
    session: &mut Session<imap::Connection>,
    bare_id: &str,
    bracketed: &str,
) -> Result<HashSet<u32>, String> {
    // 1) Gmail extension — uses the same search index as the web UI (fast).
    let raw = format!("rfc822msgid:{bare_id}");
    let q = format!("X-GM-RAW {}", imap_quoted(&raw));
    match session.uid_search(&q) {
        Ok(uids) if !uids.is_empty() => return Ok(uids),
        Ok(_) => {}
        Err(_) => {
            // Unsupported or parse error — try HEADER fallbacks below.
        }
    }

    // 2) RFC HEADER search — must quote the Message-ID value; `@` is not a valid atom char.
    for candidate in [bare_id, bracketed] {
        let q = format!("HEADER Message-ID {}", imap_quoted(candidate));
        match session.uid_search(&q) {
            Ok(uids) if !uids.is_empty() => return Ok(uids),
            Ok(_) => {}
            Err(e) => return Err(e.to_string()),
        }
    }

    Ok(HashSet::new())
}

/// Generic IMAP archive: MOVE from the stored source folder to a known archive folder.
fn generic_archive(
    session: &mut Session<imap::Connection>,
    source_folder: &str,
    uid: u32,
) -> Result<(), String> {
    let dest_candidates = ["Archive", "[Gmail]/Archive"];
    let mut last_err = String::new();
    for dest in dest_candidates {
        match try_uid_move(session, source_folder, uid, dest) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = e,
        }
    }
    Err(format!(
        "Could not move message to a known archive folder (tried Archive, [Gmail]/Archive): {last_err}"
    ))
}

fn try_uid_move(
    session: &mut Session<imap::Connection>,
    source_mailbox: &str,
    uid: u32,
    dest_mailbox: &str,
) -> Result<(), String> {
    session.select(source_mailbox).map_err(|e| e.to_string())?;
    let uid_s = uid.to_string();
    session
        .uid_mv(&uid_s, dest_mailbox)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        folder_is_gmail_all_mail, gmail_labels_include_inbox, imap_quoted,
        parse_message_labels_json_with_ok,
    };

    #[test]
    fn imap_quoted_plain_message_id() {
        assert_eq!(
            imap_quoted("5B60F5E4@example.org"),
            "\"5B60F5E4@example.org\""
        );
    }

    #[test]
    fn folder_is_gmail_all_mail_accepts_common_names() {
        assert!(folder_is_gmail_all_mail("[Gmail]/All Mail"));
        assert!(folder_is_gmail_all_mail("  [Gmail]/All Mail "));
        assert!(folder_is_gmail_all_mail("[GoogleMail]/All Mail"));
        assert!(!folder_is_gmail_all_mail("INBOX"));
    }

    #[test]
    fn gmail_labels_include_inbox_matches_fetch_forms() {
        assert!(gmail_labels_include_inbox(&[
            "\\Inbox".into(),
            "\\Sent".into()
        ]));
        assert!(gmail_labels_include_inbox(&["Inbox".into()]));
        // Double leading backslash (mis-encoded or legacy row) must still detect Inbox.
        assert!(gmail_labels_include_inbox(&[
            "\\\\Inbox".into(),
            "\\Important".into()
        ]));
        assert!(!gmail_labels_include_inbox(&[
            "\\Sent".into(),
            "Important".into()
        ]));
    }

    #[test]
    fn parse_message_labels_json_empty_on_bad() {
        let (v, ok) = parse_message_labels_json_with_ok("[]");
        assert!(v.is_empty());
        assert!(ok);
        let (v, ok) = parse_message_labels_json_with_ok("not json");
        assert!(v.is_empty());
        assert!(!ok);
        let (v, ok) = parse_message_labels_json_with_ok(r#"["\\Inbox","foo"]"#);
        assert_eq!(v.len(), 2);
        assert!(ok);
    }
}
