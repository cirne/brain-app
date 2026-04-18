//! Infer real owner addresses when Apple Mail was set up with a placeholder (`applemail@local`).
//!
//! `ResolvedMailbox.email` must match indexed `From:` for owner-centric stats; placeholders never
//! do, so `sentCount`/`receivedCount` stay zero and real addresses (e.g. `you@mac.com`) appear as
//! “contacts”. We infer likely identities from high-volume `From:` rows on Apple-family domains.

use rusqlite::Connection;

use crate::config::Config;

use super::is_noreply;
use super::normalize::normalize_address;

/// Wizard / setup placeholder when the user has not set a real address yet.
pub fn is_placeholder_mailbox_email(email: &str) -> bool {
    let e = email.trim().to_ascii_lowercase();
    e == "applemail@local" || (e.contains("applemail") && e.ends_with("@local"))
}

/// Heuristic: exclude obvious Apple private-relay / hashed locals (not normal human addresses).
fn looks_like_human_apple_family_address(addr: &str) -> bool {
    let a = addr.trim();
    if a.is_empty() || is_noreply(a) {
        return false;
    }
    let lower = a.to_ascii_lowercase();
    if lower.contains("privaterelay") {
        return false;
    }
    let Some((local, _)) = lower.split_once('@') else {
        return false;
    };
    if local.len() > 32 && local.contains('_') {
        return false;
    }
    lower.ends_with("@mac.com") || lower.ends_with("@icloud.com") || lower.ends_with("@me.com")
}

/// When any configured mailbox uses [`is_placeholder_mailbox_email`], infer owner identities from
/// indexed messages (same scope as `ripmail who`).
///
/// Candidates are apple-family addresses that appear either as **senders** (`from_address`) OR as
/// **recipients** (`to_addresses`/`cc_addresses` JSON arrays). Using both sides means the inbox
/// owner is discovered early in a fresh sync — they receive mail from day one even if they haven't
/// sent much yet (which was BUG-058's root cause for partial indexes).
pub fn infer_placeholder_owner_identities(
    conn: &Connection,
    cfg: &Config,
    mailbox_ids: Option<&Vec<String>>,
) -> rusqlite::Result<Vec<String>> {
    if !cfg
        .resolved_mailboxes()
        .iter()
        .any(|m| is_placeholder_mailbox_email(&m.email))
    {
        return Ok(Vec::new());
    }

    const MIN_COUNT: i64 = 5;
    const LIMIT: i64 = 8;

    let apple_domain_filter = "(LOWER(addr) LIKE '%@mac.com' \
                                OR LOWER(addr) LIKE '%@icloud.com' \
                                OR LOWER(addr) LIKE '%@me.com')";

    let category_filter = "(category IS NULL OR category NOT IN \
        ('promotional','social','forum','list','bulk','spam','automated'))";

    // Build the source-id WHERE clause and bindings for both queries.
    let (source_filter, id_binds): (String, Vec<rusqlite::types::Value>) = match mailbox_ids {
        Some(ids) if !ids.is_empty() => {
            let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let binds = ids
                .iter()
                .map(|s| rusqlite::types::Value::Text(s.clone()))
                .collect();
            (format!("source_id IN ({ph})"), binds)
        }
        _ => ("1=1".into(), Vec::new()),
    };

    // Senders: apple-family addresses in from_address.
    let sender_sql = format!(
        "SELECT TRIM(from_address) AS addr, COUNT(*) AS c \
         FROM messages \
         WHERE {source_filter} AND TRIM(from_address) != '' \
         AND {category_filter} \
         AND {apple_domain_filter} \
         GROUP BY addr HAVING c >= {MIN_COUNT} \
         ORDER BY c DESC LIMIT {LIMIT}"
    );

    // Recipients: apple-family addresses in to_addresses or cc_addresses JSON arrays.
    let recipient_sql = format!(
        "SELECT lower(ta.value) AS addr, COUNT(*) AS c \
         FROM messages m JOIN json_each(m.to_addresses) ta \
         WHERE {source_filter} AND m.list_like = 0 AND {category_filter} \
         AND (LOWER(ta.value) LIKE '%@mac.com' \
           OR LOWER(ta.value) LIKE '%@icloud.com' \
           OR LOWER(ta.value) LIKE '%@me.com') \
         GROUP BY lower(ta.value) HAVING c >= {MIN_COUNT} \
         ORDER BY c DESC LIMIT {LIMIT} \
         UNION \
         SELECT lower(ca.value) AS addr, COUNT(*) AS c \
         FROM messages m JOIN json_each(m.cc_addresses) ca \
         WHERE {source_filter} AND m.list_like = 0 AND {category_filter} \
         AND (LOWER(ca.value) LIKE '%@mac.com' \
           OR LOWER(ca.value) LIKE '%@icloud.com' \
           OR LOWER(ca.value) LIKE '%@me.com') \
         GROUP BY lower(ca.value) HAVING c >= {MIN_COUNT} \
         ORDER BY c DESC LIMIT {LIMIT}"
    );

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    let mut collect = |sql: &str| -> rusqlite::Result<()> {
        let mut stmt = conn.prepare(sql)?;
        let rows: Vec<String> = stmt
            .query_map(rusqlite::params_from_iter(id_binds.iter()), |row| {
                row.get::<_, String>(0)
            })?
            .filter_map(|r| r.ok())
            .filter(|a| looks_like_human_apple_family_address(a))
            .collect();
        for addr in rows {
            let n = normalize_address(&addr);
            if seen.insert(n) {
                out.push(addr);
            }
        }
        Ok(())
    };

    collect(&sender_sql)?;
    collect(&recipient_sql)?;

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_detection() {
        assert!(is_placeholder_mailbox_email("applemail@local"));
        assert!(is_placeholder_mailbox_email("  Applemail@local  "));
        assert!(!is_placeholder_mailbox_email("lewiscirne@mac.com"));
    }
}
