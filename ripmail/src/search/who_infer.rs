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

    let category_filter = "(category IS NULL OR category NOT IN ('promotional','social','forum','list','bulk','spam','automated'))";

    let rows: Vec<(String, i64)> = match mailbox_ids {
        Some(ids) if !ids.is_empty() => {
            let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let sql = format!(
                "SELECT from_address, COUNT(*) AS c FROM messages \
                 WHERE source_id IN ({ph}) \
                 AND TRIM(from_address) != '' \
                 AND {category_filter} \
                 AND (LOWER(from_address) LIKE '%@mac.com' \
                   OR LOWER(from_address) LIKE '%@icloud.com' \
                   OR LOWER(from_address) LIKE '%@me.com') \
                 GROUP BY from_address \
                 HAVING COUNT(*) >= ? \
                 ORDER BY c DESC \
                 LIMIT {LIMIT}"
            );
            let mut stmt = conn.prepare(&sql)?;
            let mut bind: Vec<rusqlite::types::Value> = ids
                .iter()
                .map(|s| rusqlite::types::Value::Text(s.clone()))
                .collect();
            bind.push(rusqlite::types::Value::Integer(MIN_COUNT));
            let rows: Vec<(String, i64)> = stmt
                .query_map(rusqlite::params_from_iter(bind.iter()), |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?
                .filter_map(|r| r.ok())
                .collect();
            rows
        }
        _ => {
            let sql = format!(
                "SELECT from_address, COUNT(*) AS c FROM messages \
                 WHERE TRIM(from_address) != '' \
                 AND {category_filter} \
                 AND (LOWER(from_address) LIKE '%@mac.com' \
                   OR LOWER(from_address) LIKE '%@icloud.com' \
                   OR LOWER(from_address) LIKE '%@me.com') \
                 GROUP BY from_address \
                 HAVING COUNT(*) >= ? \
                 ORDER BY c DESC \
                 LIMIT {LIMIT}"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows: Vec<(String, i64)> = stmt
                .query_map([MIN_COUNT], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect();
            rows
        }
    };

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (addr, _c) in rows {
        if !looks_like_human_apple_family_address(&addr) {
            continue;
        }
        let n = normalize_address(&addr);
        if seen.insert(n) {
            out.push(addr);
        }
    }
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
