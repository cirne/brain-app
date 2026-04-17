//! `ripmail whoami` — configured identity plus heuristics from indexed outbound mail.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;

use crate::config::{
    mailbox_config_by_id, resolve_mailbox_spec, Config, MailboxIdentityJson, ResolvedMailbox,
};

use super::infer_name::infer_name_from_address;
use super::normalize::normalize_address;
use super::who_infer::infer_placeholder_owner_identities;

const CATEGORY_FILTER: &str =
    "(category IS NULL OR category NOT IN ('promotional','social','forum','list','bulk','spam','automated'))";

/// `raw_path` / maildir location suggests the message lives under a **Sent** mailbox (user-composed
/// outbound), not Inbox/Archive. Used to pick "who is this mailbox" when multiple personal From:
/// addresses appear in one Apple Mail index.
///
/// Avoid bare `LIKE '%sent%'` — false positives on e.g. "presentation".
const RAW_PATH_SENT_MAILBOX_SQL: &str = "\
(lower(raw_path) LIKE '%sent messages%' \
 OR lower(raw_path) LIKE '%sent.mbox%' \
 OR lower(raw_path) LIKE '%/sent/%' \
 OR lower(raw_path) LIKE '%.sent/%' \
 OR lower(raw_path) LIKE '%[gmail]/sent%' \
 OR lower(raw_path) LIKE '%sent mail%')";

/// Run `whoami` aggregation (`mailbox_spec`: same as `ripmail who --mailbox`).
pub fn whoami(
    conn: &Connection,
    home: &Path,
    cfg: &Config,
    mailbox_spec: Option<&str>,
) -> rusqlite::Result<WhoamiResult> {
    let mailboxes: Vec<&ResolvedMailbox> =
        match mailbox_spec.map(str::trim).filter(|s| !s.is_empty()) {
            Some(spec) => match resolve_mailbox_spec(cfg.resolved_mailboxes(), spec) {
                Some(mb) if mb.is_mail() => vec![mb],
                _ => Vec::new(),
            },
            None => cfg
                .resolved_mailboxes()
                .iter()
                .filter(|m| m.is_mail())
                .collect(),
        };

    let mut out = Vec::with_capacity(mailboxes.len());
    for mb in mailboxes {
        let row = whoami_one_mailbox(conn, home, cfg, mb)?;
        out.push(row);
    }

    Ok(WhoamiResult { mailboxes: out })
}

fn whoami_one_mailbox(
    conn: &Connection,
    home: &Path,
    cfg: &Config,
    mb: &ResolvedMailbox,
) -> rusqlite::Result<WhoamiMailbox> {
    let json_row = mailbox_config_by_id(home, &mb.id);
    let mailbox_type = json_row.as_ref().map(|r| match r.kind {
        crate::config::SourceKind::Imap => "imap".to_string(),
        crate::config::SourceKind::AppleMail => "applemail".to_string(),
        crate::config::SourceKind::LocalDir => "localDir".to_string(),
    });
    let identity = json_row.and_then(|r| r.identity);

    let mb_ids = Some(vec![mb.id.clone()]);
    let placeholder_extra: Vec<String> =
        infer_placeholder_owner_identities(conn, cfg, mb_ids.as_ref())?;

    let owner_candidates = owner_email_candidates(mb, &placeholder_extra);

    let (primary_addr, inferred_display) =
        primary_identity_from_outbound(conn, &mb.id, &owner_candidates)?;

    let identity_has_name = identity.as_ref().is_some_and(|i| {
        i.preferred_name
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty())
            || i.full_name.as_ref().is_some_and(|s| !s.trim().is_empty())
    });
    let suggested_from_email = if !identity_has_name && inferred_display.is_none() {
        primary_addr
            .as_deref()
            .or(owner_candidates.first().map(|s| s.as_str()))
            .and_then(infer_name_from_address)
    } else {
        None
    };

    let inferred =
        if primary_addr.is_some() || inferred_display.is_some() || suggested_from_email.is_some() {
            Some(WhoamiInferred {
                primary_email: primary_addr,
                display_name_from_mail: inferred_display,
                suggested_name_from_email: suggested_from_email,
            })
        } else {
            None
        };

    Ok(WhoamiMailbox {
        mailbox_id: mb.id.clone(),
        config_address: mb.email.clone(),
        imap_aliases: mb.imap_aliases.clone(),
        include_in_default_search: mb.include_in_default,
        source: mailbox_source(mb),
        mailbox_type,
        identity,
        inferred,
    })
}

fn mailbox_source(mb: &ResolvedMailbox) -> &'static str {
    if mb.apple_mail_root.is_some() {
        "applemail"
    } else {
        "imap"
    }
}

/// Build de-duplicated owner address strings (config + placeholder inference).
fn owner_email_candidates(mb: &ResolvedMailbox, placeholder_inferred: &[String]) -> Vec<String> {
    let mut seen_norm = HashSet::new();
    let mut out = Vec::new();
    for e in std::iter::once(mb.email.as_str())
        .chain(mb.imap_aliases.iter().map(|s| s.as_str()))
        .chain(placeholder_inferred.iter().map(|s| s.as_str()))
    {
        let t = e.trim();
        if t.is_empty() || is_noreply_addr(t) {
            continue;
        }
        let n = normalize_address(t);
        if seen_norm.insert(n) {
            out.push(t.to_string());
        }
    }
    out
}

fn is_noreply_addr(t: &str) -> bool {
    super::is_noreply(t)
}

/// Picks a primary `from_address` among owner candidates, then the best `from_name` **for that
/// address only** (never mix names across addresses).
///
/// Primary address: maximize count of messages whose `raw_path` looks like a Sent mailbox (real
/// outbound copies). If all such counts are zero (e.g. pure IMAP paths), fall back to max total
/// message count per address (same category / list filters as `who`).
fn primary_identity_from_outbound(
    conn: &Connection,
    mailbox_id: &str,
    owner_emails: &[String],
) -> rusqlite::Result<(Option<String>, Option<String>)> {
    if owner_emails.is_empty() {
        return Ok((None, None));
    }

    let base_filter = format!("source_id = ? AND list_like = 0 AND {CATEGORY_FILTER}");

    let mut sent_counts: Vec<(String, i64)> = Vec::new();
    for addr in owner_emails {
        let sql = format!(
            "SELECT COUNT(*) FROM messages WHERE {base_filter} \
             AND from_address = ? AND {RAW_PATH_SENT_MAILBOX_SQL}"
        );
        let c: i64 = conn.query_row(&sql, rusqlite::params![mailbox_id, addr.as_str()], |row| {
            row.get(0)
        })?;
        sent_counts.push((addr.clone(), c));
    }

    let max_sent = sent_counts.iter().map(|(_, c)| *c).max().unwrap_or(0);
    let primary = if max_sent > 0 {
        sent_counts
            .into_iter()
            .filter(|(_, c)| *c == max_sent)
            .map(|(a, _)| a)
            .min()
    } else {
        let totals = total_counts_per_address(conn, mailbox_id, owner_emails)?;
        let max_total = totals.iter().map(|(_, c)| *c).max().unwrap_or(0);
        totals
            .into_iter()
            .filter(|(_, c)| *c == max_total)
            .map(|(a, _)| a)
            .min()
    };

    let Some(ref p) = primary else {
        return Ok((None, None));
    };

    let name_sent = best_display_name_for_address(conn, mailbox_id, p, true)?;
    let name_any = if name_sent.is_none() {
        best_display_name_for_address(conn, mailbox_id, p, false)?
    } else {
        None
    };
    let display = name_sent.or(name_any);
    Ok((Some(p.clone()), display))
}

fn total_counts_per_address(
    conn: &Connection,
    mailbox_id: &str,
    owner_emails: &[String],
) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut out = Vec::new();
    for addr in owner_emails {
        let sql = format!(
            "SELECT COUNT(*) FROM messages WHERE source_id = ? AND list_like = 0 \
             AND {CATEGORY_FILTER} AND from_address = ?"
        );
        let c: i64 = conn.query_row(&sql, rusqlite::params![mailbox_id, addr.as_str()], |row| {
            row.get(0)
        })?;
        out.push((addr.clone(), c));
    }
    Ok(out)
}

/// Mode of `from_name` for one `from_address`, optionally restricted to Sent-mailbox paths.
fn best_display_name_for_address(
    conn: &Connection,
    mailbox_id: &str,
    from_address: &str,
    sent_path_only: bool,
) -> rusqlite::Result<Option<String>> {
    let sent_clause = if sent_path_only {
        format!(" AND {RAW_PATH_SENT_MAILBOX_SQL}")
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT trim(from_name), COUNT(*) AS c FROM messages \
         WHERE source_id = ? \
         AND from_address = ? \
         AND trim(from_name) != '' \
         AND list_like = 0 \
         AND {CATEGORY_FILTER} \
         {sent_clause} \
         GROUP BY trim(from_name) \
         ORDER BY c DESC \
         LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params![mailbox_id, from_address])?;
    if let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        let t = name.trim();
        if !t.is_empty() {
            return Ok(Some(t.to_string()));
        }
    }
    Ok(None)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhoamiResult {
    pub mailboxes: Vec<WhoamiMailbox>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhoamiMailbox {
    pub mailbox_id: String,
    /// Value from `config.json` (`mailboxes[].email`). May be a wizard placeholder (e.g. `applemail@local`).
    pub config_address: String,
    /// Optional IMAP aliases from `config.json` (`mailboxes[].imap.aliases`) when set.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub imap_aliases: Vec<String>,
    /// When multiple mailboxes exist, whether default search includes this one.
    pub include_in_default_search: bool,
    /// `"imap"` (remote) or `"applemail"` (local library index).
    pub source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mailbox_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<MailboxIdentityJson>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inferred: Option<WhoamiInferred>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhoamiInferred {
    /// Best guess primary address when multiple owner identities appear (e.g. placeholder + inference).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_email: Option<String>,
    /// Best-effort display name from `From:` for [`Self::primary_email`] (noise categories excluded).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name_from_mail: Option<String>,
    /// When headers have no display name, heuristic from the local part of the primary address.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_name_from_email: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        derive_mailbox_id_from_email, resolve_smtp_settings, MailboxImapAuthKind, ResolvedMailbox,
        SourceKind,
    };
    use crate::db::{apply_schema, open_memory};
    use crate::persist_message;
    use crate::search::who_infer::is_placeholder_mailbox_email;
    use crate::sync::parse_message::ParsedMessage;
    use std::path::Path;

    fn mb_fixture(id: &str, email: &str) -> ResolvedMailbox {
        ResolvedMailbox {
            id: id.into(),
            kind: SourceKind::Imap,
            email: email.into(),
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            imap_user: email.into(),
            imap_aliases: vec![],
            imap_password: String::new(),
            imap_auth: MailboxImapAuthKind::AppPassword,
            include_in_default: true,
            maildir_path: Path::new("/tmp/m").into(),
            apple_mail_root: None,
            local_dir: None,
        }
    }

    #[test]
    fn whoami_infers_display_name_from_sent_from_header() {
        let conn = open_memory().unwrap();
        apply_schema(&conn).unwrap();
        let mb_id = "mb1";
        let p = ParsedMessage {
            message_id: "mid@1".into(),
            from_address: "me@example.com".into(),
            from_name: Some("Morgan Example".into()),
            to_addresses: vec!["x@y.com".into()],
            cc_addresses: vec![],
            to_recipients: vec![],
            cc_recipients: vec![],
            subject: "hi".into(),
            date: "2025-06-01T12:00:00Z".into(),
            body_text: "b".into(),
            body_html: None,
            attachments: vec![],
            category: None,
            ..Default::default()
        };
        persist_message(&conn, &p, "INBOX", mb_id, 1, "[]", "a.eml").unwrap();

        let cfg = Config {
            ripmail_home: Path::new("/tmp").into(),
            data_dir: Path::new("/tmp").into(),
            db_path: Path::new("/tmp/db").into(),
            maildir_path: Path::new("/tmp/m").into(),
            message_path_root: Path::new("/tmp").into(),
            source_id: mb_id.into(),
            resolved_sources: vec![mb_fixture(mb_id, "me@example.com")],
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            imap_user: "me@example.com".into(),
            imap_aliases: vec![],
            imap_password: String::new(),
            imap_auth: MailboxImapAuthKind::AppPassword,
            smtp: resolve_smtp_settings("imap.gmail.com", None).unwrap(),
            sync_default_since: "1y".into(),
            sync_mailbox: String::new(),
            sync_exclude_labels: vec![],
            attachments_cache_extracted_text: false,
            inbox_default_window: "24h".into(),
            inbox_bootstrap_archive_older_than: "1d".into(),
            mailbox_management_enabled: false,
            mailbox_management_allow_archive: false,
        };

        let home = Path::new("/nonexistent");
        let r = whoami(&conn, home, &cfg, None).unwrap();
        assert_eq!(r.mailboxes.len(), 1);
        let inf = r.mailboxes[0].inferred.as_ref().expect("inferred");
        assert_eq!(inf.primary_email.as_deref(), Some("me@example.com"));
        assert_eq!(
            inf.display_name_from_mail.as_deref(),
            Some("Morgan Example")
        );
    }

    #[test]
    fn whoami_primary_uses_sent_mailbox_path_not_inbox_volume() {
        let conn = open_memory().unwrap();
        apply_schema(&conn).unwrap();
        let mb_id = "mb_sent_pick";

        fn msg(mid: &str, from: &str, name: &str) -> ParsedMessage {
            ParsedMessage {
                message_id: mid.into(),
                from_address: from.into(),
                from_name: Some(name.into()),
                to_addresses: vec!["x@y.com".into()],
                cc_addresses: vec![],
                to_recipients: vec![],
                cc_recipients: vec![],
                subject: "s".into(),
                date: "2025-06-01T12:00:00Z".into(),
                body_text: "b".into(),
                body_html: None,
                attachments: vec![],
                category: None,
                ..Default::default()
            }
        }

        // High volume "from" in non-Sent paths.
        for i in 0..40 {
            let raw = format!("/Users/x/Library/Mail/V10/acc/INBOX.mbox/stem/Data/{i}.emlx");
            let p = msg(&format!("inbox-{i}@t"), "heavy@example.com", "Other Person");
            persist_message(&conn, &p, "INBOX", mb_id, i, "[]", &raw).unwrap();
        }
        // Fewer rows, but stored under Sent — should win primary.
        for i in 0..3 {
            let raw =
                format!("/Users/x/Library/Mail/V10/acc/Sent Messages.mbox/stem/Data/{i}.emlx");
            let p = msg(&format!("sent-{i}@t"), "light@example.com", "Light User");
            persist_message(&conn, &p, "INBOX", mb_id, 100 + i, "[]", &raw).unwrap();
        }

        let mut mb = mb_fixture(mb_id, "heavy@example.com");
        mb.imap_aliases = vec!["light@example.com".into()];

        let cfg = Config {
            ripmail_home: Path::new("/tmp").into(),
            data_dir: Path::new("/tmp").into(),
            db_path: Path::new("/tmp/db").into(),
            maildir_path: Path::new("/tmp/m").into(),
            message_path_root: Path::new("/tmp").into(),
            source_id: mb_id.into(),
            resolved_sources: vec![mb],
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            imap_user: "heavy@example.com".into(),
            imap_aliases: vec!["light@example.com".into()],
            imap_password: String::new(),
            imap_auth: MailboxImapAuthKind::AppPassword,
            smtp: resolve_smtp_settings("imap.gmail.com", None).unwrap(),
            sync_default_since: "1y".into(),
            sync_mailbox: String::new(),
            sync_exclude_labels: vec![],
            attachments_cache_extracted_text: false,
            inbox_default_window: "24h".into(),
            inbox_bootstrap_archive_older_than: "1d".into(),
            mailbox_management_enabled: false,
            mailbox_management_allow_archive: false,
        };

        let home = Path::new("/nonexistent");
        let r = whoami(&conn, home, &cfg, None).unwrap();
        let inf = r.mailboxes[0].inferred.as_ref().expect("inferred");
        assert_eq!(inf.primary_email.as_deref(), Some("light@example.com"));
        assert_eq!(inf.display_name_from_mail.as_deref(), Some("Light User"));
    }

    #[test]
    fn placeholder_mailbox_email_detection() {
        assert!(is_placeholder_mailbox_email("applemail@local"));
        let id = derive_mailbox_id_from_email("applemail@local");
        assert!(!id.is_empty());
    }
}
