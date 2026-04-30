//! `ripmail whoami` — configured identity plus heuristics from indexed mail.

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
        crate::config::SourceKind::GoogleCalendar => "googleCalendar".to_string(),
        crate::config::SourceKind::AppleCalendar => "appleCalendar".to_string(),
        crate::config::SourceKind::IcsSubscription => "icsSubscription".to_string(),
        crate::config::SourceKind::IcsFile => "icsFile".to_string(),
        crate::config::SourceKind::GoogleDrive => "googleDrive".to_string(),
    });
    let identity = json_row.and_then(|r| r.identity);

    let mb_ids = Some(vec![mb.id.clone()]);
    let placeholder_extra: Vec<String> =
        infer_placeholder_owner_identities(conn, cfg, mb_ids.as_ref())?;

    let owner_candidates = owner_email_candidates(mb, &placeholder_extra);

    let (primary_addr, inferred_display) =
        primary_identity_from_received(conn, &mb.id, &owner_candidates)?;

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

/// Pick the primary owner address and their display name from indexed mail.
///
/// Strategy: the inbox owner is whoever appears **most often as a recipient** (To or Cc) across
/// all messages in the mailbox. This is mailbox-type-agnostic — it works equally for IMAP,
/// Apple Mail, and local-dir sources — and is robust against shared-Mail.app setups where one
/// macOS user has multiple family members' accounts loaded: Lewis gets the most To/Cc hits in
/// Lewis's inbox regardless of who sends more outbound mail.
///
/// Display name is then taken as the most frequent `from_name` when that address sends mail
/// (self-identifying header), falling back to any from_name match in the whole mailbox.
fn primary_identity_from_received(
    conn: &Connection,
    mailbox_id: &str,
    owner_emails: &[String],
) -> rusqlite::Result<(Option<String>, Option<String>)> {
    if owner_emails.is_empty() {
        return Ok((None, None));
    }

    // Count how many messages in this mailbox have each candidate address in To or Cc.
    // json_each() unnests the stored JSON arrays, so partial-address false-positives are
    // impossible (unlike LIKE '%addr%').
    let mut recv_counts: Vec<(String, i64)> = Vec::new();
    for addr in owner_emails {
        let sql = format!(
            "SELECT COUNT(*) FROM messages \
             WHERE source_id = ? AND list_like = 0 AND {CATEGORY_FILTER} \
             AND (EXISTS (SELECT 1 FROM json_each(to_addresses) WHERE lower(value) = lower(?)) \
               OR EXISTS (SELECT 1 FROM json_each(cc_addresses) WHERE lower(value) = lower(?)))"
        );
        let c: i64 = conn.query_row(
            &sql,
            rusqlite::params![mailbox_id, addr.as_str(), addr.as_str()],
            |row| row.get(0),
        )?;
        recv_counts.push((addr.clone(), c));
    }

    let max_recv = recv_counts.iter().map(|(_, c)| *c).max().unwrap_or(0);
    let primary = recv_counts
        .into_iter()
        .filter(|(_, c)| *c == max_recv)
        .map(|(a, _)| a)
        .min(); // alphabetical tiebreak for determinism

    let Some(ref p) = primary else {
        return Ok((None, None));
    };

    // Display name: most frequent from_name when this address appears in From: (self-identified).
    let display = best_display_name_for_address(conn, mailbox_id, p)?;
    Ok((Some(p.clone()), display))
}

/// Most frequent non-empty `from_name` for the given `from_address` in this mailbox.
fn best_display_name_for_address(
    conn: &Connection,
    mailbox_id: &str,
    from_address: &str,
) -> rusqlite::Result<Option<String>> {
    let sql = format!(
        "SELECT trim(from_name), COUNT(*) AS c FROM messages \
         WHERE source_id = ? \
         AND from_address = ? \
         AND trim(from_name) != '' \
         AND list_like = 0 \
         AND {CATEGORY_FILTER} \
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
            file_source: None,
            calendar: None,
            google_drive: None,
        }
    }

    fn make_cfg(mb_id: &str, mb: ResolvedMailbox) -> Config {
        let email = mb.email.clone();
        Config {
            ripmail_home: Path::new("/tmp").into(),
            data_dir: Path::new("/tmp").into(),
            db_path: Path::new("/tmp/db").into(),
            maildir_path: Path::new("/tmp/m").into(),
            message_path_root: Path::new("/tmp").into(),
            source_id: mb_id.into(),
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            imap_user: email,
            imap_aliases: mb.imap_aliases.clone(),
            imap_password: String::new(),
            imap_auth: MailboxImapAuthKind::AppPassword,
            smtp: resolve_smtp_settings("imap.gmail.com", None).unwrap(),
            resolved_sources: vec![mb],
            sync_default_since: "1y".into(),
            sync_mailbox: String::new(),
            sync_exclude_labels: vec![],
            attachments_cache_extracted_text: false,
            inbox_default_window: "24h".into(),
            inbox_bootstrap_archive_older_than: "1d".into(),
            mailbox_management_enabled: false,
            mailbox_management_allow_archive: false,
        }
    }

    fn recv_msg(mid: &str, from: &str, from_name: &str, to: &[&str]) -> ParsedMessage {
        ParsedMessage {
            message_id: mid.into(),
            from_address: from.into(),
            from_name: Some(from_name.into()),
            to_addresses: to.iter().map(|s| s.to_string()).collect(),
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

    #[test]
    fn whoami_infers_display_name_from_from_header() {
        let conn = open_memory().unwrap();
        apply_schema(&conn).unwrap();
        let mb_id = "mb1";

        // A message where the owner sends (so their from_name is recorded).
        let mut p = ParsedMessage {
            message_id: "mid@1".into(),
            from_address: "me@example.com".into(),
            from_name: Some("Morgan Example".into()),
            to_addresses: vec!["friend@example.com".into()],
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
        persist_message(&conn, &mut p, "INBOX", mb_id, 1, "[]", "a.eml").unwrap();

        // Several received messages addressed to the owner — establishes them as primary.
        for i in 0..5 {
            let mut p = recv_msg(
                &format!("r{i}@t"),
                "sender@other.com",
                "Sender",
                &["me@example.com"],
            );
            persist_message(&conn, &mut p, "INBOX", mb_id, 10 + i, "[]", "r.eml").unwrap();
        }

        let r = whoami(
            &conn,
            Path::new("/nonexistent"),
            &make_cfg(mb_id, mb_fixture(mb_id, "me@example.com")),
            None,
        )
        .unwrap();
        assert_eq!(r.mailboxes.len(), 1);
        let inf = r.mailboxes[0].inferred.as_ref().expect("inferred");
        assert_eq!(inf.primary_email.as_deref(), Some("me@example.com"));
        assert_eq!(
            inf.display_name_from_mail.as_deref(),
            Some("Morgan Example")
        );
    }

    #[test]
    fn whoami_primary_is_most_received_not_most_sent() {
        let conn = open_memory().unwrap();
        apply_schema(&conn).unwrap();
        let mb_id = "mb_recv";

        // "heavy" sends 40 messages from this mailbox but receives none addressed to them.
        for i in 0..40 {
            let mut p = recv_msg(
                &format!("s{i}@t"),
                "heavy@example.com",
                "Heavy Sender",
                &["x@y.com"],
            );
            persist_message(&conn, &mut p, "INBOX", mb_id, i, "[]", "s.eml").unwrap();
        }
        // "light" only sends 3, but receives 10 messages addressed directly to them.
        for i in 0..3 {
            let mut p = recv_msg(
                &format!("ls{i}@t"),
                "light@example.com",
                "Light User",
                &["x@y.com"],
            );
            persist_message(&conn, &mut p, "INBOX", mb_id, 100 + i, "[]", "ls.eml").unwrap();
        }
        for i in 0..10 {
            let mut p = recv_msg(
                &format!("lr{i}@t"),
                "someone@other.com",
                "Someone",
                &["light@example.com"],
            );
            persist_message(&conn, &mut p, "INBOX", mb_id, 200 + i, "[]", "lr.eml").unwrap();
        }

        let mut mb = mb_fixture(mb_id, "heavy@example.com");
        mb.imap_aliases = vec!["light@example.com".into()];

        let r = whoami(&conn, Path::new("/nonexistent"), &make_cfg(mb_id, mb), None).unwrap();
        let inf = r.mailboxes[0].inferred.as_ref().expect("inferred");
        // light@example.com receives more mail → they own the inbox.
        assert_eq!(inf.primary_email.as_deref(), Some("light@example.com"));
        assert_eq!(inf.display_name_from_mail.as_deref(), Some("Light User"));
    }

    #[test]
    fn placeholder_mailbox_email_detection() {
        assert!(is_placeholder_mailbox_email("applemail@local"));
        let id = derive_mailbox_id_from_email("applemail@local");
        assert!(!id.is_empty());
    }

    /// BUG-058 fix: even though Kirsten sends 50 messages from within Lewis's Mail.app,
    /// Lewis receives far more mail addressed to lewis@mac.com → whoami correctly picks Lewis.
    #[test]
    fn whoami_bug058_receiver_frequency_picks_correct_owner() {
        let conn = open_memory().unwrap();
        apply_schema(&conn).unwrap();
        let mb_id = "applemail_local";

        // Kirsten sends 50 messages (from within Lewis's shared Mail.app).
        for i in 0..50 {
            let mut p = recv_msg(
                &format!("k{i}@t"),
                "kirsten@mac.com",
                "Kirsten Vliet",
                &["someone@other.com"],
            );
            persist_message(&conn, &mut p, "INBOX", mb_id, i, "[]", "k.emlx").unwrap();
        }
        // Lewis sends only 13, but his inbox receives 200 messages addressed to him.
        for i in 0..13 {
            let mut p = recv_msg(
                &format!("ls{i}@t"),
                "lewis@mac.com",
                "Lewis",
                &["someone@other.com"],
            );
            persist_message(&conn, &mut p, "INBOX", mb_id, 100 + i, "[]", "ls.emlx").unwrap();
        }
        for i in 0..200 {
            let mut p = recv_msg(
                &format!("lr{i}@t"),
                "sender@other.com",
                "Sender",
                &["lewis@mac.com"],
            );
            persist_message(&conn, &mut p, "INBOX", mb_id, 200 + i, "[]", "lr.emlx").unwrap();
        }

        let mut mb = mb_fixture(mb_id, "lewis@mac.com");
        mb.imap_aliases = vec!["kirsten@mac.com".into()];

        let r = whoami(&conn, Path::new("/nonexistent"), &make_cfg(mb_id, mb), None).unwrap();
        let inf = r.mailboxes[0].inferred.as_ref().expect("inferred");
        assert_eq!(inf.primary_email.as_deref(), Some("lewis@mac.com"));
        assert_eq!(inf.display_name_from_mail.as_deref(), Some("Lewis"));
    }
}
