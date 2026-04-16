//! Owner-centric contact stats + search rerank (`src/search/owner-contact-stats.ts`, `contact-rank.ts`).

use rusqlite::Connection;

use crate::mail_category::is_default_excluded_category;

use super::noreply::is_noreply;
use super::normalize::normalize_address;
use super::types::SearchResult;

const WEIGHT_SENT: f64 = 2.2;
const WEIGHT_REPLIED: f64 = 1.0;
const WEIGHT_RECEIVED: f64 = 1.4;
const WEIGHT_MENTIONED: f64 = 0.35;
/// Outbound to peer with no `In-Reply-To` / `References` (new composition).
const WEIGHT_SENT_NEW: f64 = 3.2;
/// Reply in a small recipient set (likely real conversation vs megathread).
const WEIGHT_SENT_SMALL_REPLY: f64 = 1.4;
const LOG_CAP: f64 = 48.0;
const LAMBDA: f64 = 2.5;
const EPS: f64 = 1.0;
/// Same as TS `SEARCH_CONTACT_RANK_BOOST_ALPHA`
pub const SEARCH_CONTACT_RANK_BOOST_ALPHA: f64 = 0.12;

#[derive(Debug, Clone, Default)]
pub struct ContactFields {
    pub sent_count: i64,
    pub replied_count: i64,
    pub received_count: i64,
    pub mentioned_count: i64,
    /// Owner → peer where the message is not a reply (new mail).
    pub sent_new_count: i64,
    /// Owner → peer reply with few total To+Cc recipients (small group).
    pub sent_small_reply_count: i64,
}

fn capped_log1p(n: f64) -> f64 {
    (n.max(0.0) + 1.0).ln().min(LOG_CAP)
}

fn received_inbound_multiplier(f: &ContactFields) -> f64 {
    let outbound = (f.sent_count + f.replied_count).max(0) as f64;
    let inbound_log = capped_log1p(f.received_count as f64);
    let numer = outbound + EPS;
    let denom = numer + LAMBDA * inbound_log;
    if denom <= 0.0 {
        0.0
    } else {
        numer / denom
    }
}

pub fn compute_contact_rank(f: &ContactFields) -> f64 {
    let recv_mult = received_inbound_multiplier(f);
    WEIGHT_SENT * capped_log1p(f.sent_count as f64)
        + WEIGHT_REPLIED * capped_log1p(f.replied_count as f64)
        + WEIGHT_RECEIVED * recv_mult * capped_log1p(f.received_count as f64)
        + WEIGHT_MENTIONED * capped_log1p(f.mentioned_count as f64)
}

/// Like [`compute_contact_rank`], but down-weights CC-only “mentions” when there is no direct
/// mail (sent/received/replied), so reply-all blasts do not dominate `ripmail who`.
pub fn compute_contact_rank_who(f: &ContactFields) -> f64 {
    let direct = f.sent_count + f.replied_count + f.received_count > 0;
    let mention_mult = if direct { 1.0 } else { 0.14 };
    let recv_mult = received_inbound_multiplier(f);
    WEIGHT_SENT_NEW * capped_log1p(f.sent_new_count as f64)
        + WEIGHT_SENT_SMALL_REPLY * capped_log1p(f.sent_small_reply_count as f64)
        + WEIGHT_SENT * capped_log1p(f.sent_count as f64)
        + WEIGHT_REPLIED * capped_log1p(f.replied_count as f64)
        + WEIGHT_RECEIVED * recv_mult * capped_log1p(f.received_count as f64)
        + WEIGHT_MENTIONED * mention_mult * capped_log1p(f.mentioned_count as f64)
}

/// `who` list ordering when only sent/received totals are known.
pub fn contact_rank_simple(sent: i64, received: i64) -> f64 {
    compute_contact_rank(&ContactFields {
        sent_count: sent,
        replied_count: 0,
        received_count: received,
        mentioned_count: 0,
        sent_new_count: 0,
        sent_small_reply_count: 0,
    })
}

fn parse_json_addresses(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

fn owner_sees_message(
    owner_norms: &std::collections::HashSet<String>,
    to_raw: &[String],
    cc_raw: &[String],
) -> bool {
    to_raw
        .iter()
        .any(|a| owner_norms.contains(&normalize_address(a)))
        || cc_raw
            .iter()
            .any(|a| owner_norms.contains(&normalize_address(a)))
}

#[derive(Clone)]
struct MsgRow {
    thread_id: String,
    from_address: String,
    to_addresses: String,
    cc_addresses: String,
    category: Option<String>,
    is_reply: bool,
    recipient_count: i32,
    list_like: bool,
}

fn load_messages_for_owner_stats(
    conn: &Connection,
    owner_norms: &std::collections::HashSet<String>,
    candidates: &std::collections::HashSet<String>,
    mailbox_ids: Option<&[String]>,
) -> rusqlite::Result<Vec<MsgRow>> {
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(MsgRow {
            thread_id: row.get(0)?,
            from_address: row.get(2)?,
            to_addresses: row.get(3)?,
            cc_addresses: row.get(4)?,
            category: row.get(5)?,
            is_reply: row.get::<_, i64>(6)? != 0,
            recipient_count: row.get::<_, i64>(7)? as i32,
            list_like: row.get::<_, i64>(8)? != 0,
        })
    };

    let rows: Vec<MsgRow> = match mailbox_ids {
        Some(ids) if !ids.is_empty() => {
            let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let sql = format!(
                "SELECT thread_id, date, from_address, to_addresses, cc_addresses, category, is_reply, recipient_count, list_like FROM messages WHERE mailbox_id IN ({ph}) ORDER BY date ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let v: Vec<MsgRow> = stmt
                .query_map(rusqlite::params_from_iter(ids.iter()), map_row)?
                .filter_map(|r| r.ok())
                .collect();
            v
        }
        _ => {
            let mut stmt = conn.prepare(
                "SELECT thread_id, date, from_address, to_addresses, cc_addresses, category, is_reply, recipient_count, list_like FROM messages ORDER BY date ASC",
            )?;
            let v: Vec<MsgRow> = stmt
                .query_map([], map_row)?
                .filter_map(|r| r.ok())
                .collect();
            v
        }
    };

    let mut want = std::collections::HashSet::new();
    want.extend(owner_norms.iter().cloned());
    want.extend(candidates.iter().cloned());

    Ok(rows
        .into_iter()
        .filter(|m| {
            let from_n = normalize_address(&m.from_address);
            if want.contains(&from_n) {
                return true;
            }
            let to = parse_json_addresses(&m.to_addresses);
            let cc = parse_json_addresses(&m.cc_addresses);
            for a in &to {
                if want.contains(&normalize_address(a)) {
                    return true;
                }
            }
            for a in &cc {
                if want.contains(&normalize_address(a)) {
                    return true;
                }
            }
            false
        })
        .collect())
}

/// Owner-centric interaction counts per normalized address (for `ripmail who` with a configured owner).
pub fn contact_fields_for_addresses(
    conn: &Connection,
    owner_identities: &[String],
    candidate_norms: &std::collections::HashSet<String>,
    mailbox_ids: Option<&[String]>,
) -> rusqlite::Result<std::collections::HashMap<String, ContactFields>> {
    compute_owner_centric_stats(conn, owner_identities, candidate_norms, mailbox_ids)
}

fn compute_owner_centric_stats(
    conn: &Connection,
    owner_identities: &[String],
    candidate_norms: &std::collections::HashSet<String>,
    mailbox_ids: Option<&[String]>,
) -> rusqlite::Result<std::collections::HashMap<String, ContactFields>> {
    let owner_norms: std::collections::HashSet<String> = owner_identities
        .iter()
        .map(|s| normalize_address(s.trim()))
        .filter(|n| !n.is_empty())
        .collect();
    let mut candidates = std::collections::HashSet::new();
    for a in candidate_norms {
        let n = normalize_address(a);
        if !owner_norms.contains(&n) {
            candidates.insert(n);
        }
    }

    let mut stats: std::collections::HashMap<String, ContactFields> =
        std::collections::HashMap::new();
    for c in &candidates {
        stats.insert(c.clone(), ContactFields::default());
    }

    if candidates.is_empty() || owner_norms.is_empty() {
        return Ok(stats);
    }

    let messages = load_messages_for_owner_stats(conn, &owner_norms, &candidates, mailbox_ids)?;
    let mut seen_owner_to_peer_in_thread = std::collections::HashSet::<String>::new();

    for m in messages {
        let from_n = normalize_address(&m.from_address);
        let to_raw = parse_json_addresses(&m.to_addresses);
        let cc_raw = parse_json_addresses(&m.cc_addresses);
        let to_norm: Vec<String> = to_raw.iter().map(|x| normalize_address(x)).collect();
        let cc_norm: Vec<String> = cc_raw.iter().map(|x| normalize_address(x)).collect();

        if candidates.contains(&from_n)
            && owner_sees_message(&owner_norms, &to_raw, &cc_raw)
            && !is_noreply(&m.from_address)
            && !m.list_like
        {
            if let Some(s) = stats.get_mut(&from_n) {
                s.received_count += 1;
            }
        }

        if !m.list_like && !is_default_excluded_category(m.category.as_deref()) {
            for peer in &cc_norm {
                if owner_norms.contains(peer) {
                    continue;
                }
                if !candidates.contains(peer) {
                    continue;
                }
                if from_n == *peer {
                    continue;
                }
                if is_noreply(peer) {
                    continue;
                }
                if let Some(s) = stats.get_mut(peer) {
                    s.mentioned_count += 1;
                }
            }
        }

        if owner_norms.contains(&from_n) {
            let mut recipients = std::collections::HashSet::new();
            for p in &to_norm {
                if !owner_norms.contains(p) {
                    recipients.insert(p.clone());
                }
            }
            for p in &cc_norm {
                if !owner_norms.contains(p) {
                    recipients.insert(p.clone());
                }
            }
            for peer in recipients {
                if !candidates.contains(&peer) {
                    continue;
                }
                if is_noreply(&peer) {
                    continue;
                }
                let key = format!("{}\0{}", m.thread_id, peer);
                if let Some(s) = stats.get_mut(&peer) {
                    if !m.is_reply {
                        s.sent_new_count += 1;
                    } else if m.recipient_count <= 4 {
                        s.sent_small_reply_count += 1;
                    }
                    if !seen_owner_to_peer_in_thread.contains(&key) {
                        seen_owner_to_peer_in_thread.insert(key);
                        s.sent_count += 1;
                    } else {
                        s.replied_count += 1;
                    }
                }
            }
        }
    }

    Ok(stats)
}

pub fn contact_rank_map_for_addresses(
    conn: &Connection,
    owner_identities: &[String],
    addresses: &[String],
) -> rusqlite::Result<std::collections::HashMap<String, f64>> {
    let mut norms = std::collections::HashSet::new();
    for a in addresses {
        norms.insert(normalize_address(a));
    }
    let stats = compute_owner_centric_stats(conn, owner_identities, &norms, None)?;
    let mut out = std::collections::HashMap::new();
    for (addr, f) in stats {
        out.insert(addr, compute_contact_rank(&f));
    }
    Ok(out)
}

/// Sort rows by sender contact rank (desc), then date (desc). No-op if `owner_identities` is
/// missing or empty.
pub fn sort_rows_by_sender_contact_rank<T: Clone>(
    conn: &Connection,
    owner_identities: Option<&[String]>,
    rows: Vec<T>,
    from_address: impl Fn(&T) -> &str,
    date: impl Fn(&T) -> &str,
) -> rusqlite::Result<Vec<T>> {
    let Some(ids) = owner_identities else {
        return Ok(rows);
    };
    if ids.is_empty() || rows.is_empty() {
        return Ok(rows);
    }
    let norms: std::collections::HashSet<String> = rows
        .iter()
        .map(|r| normalize_address(from_address(r)))
        .collect();
    let norms_vec: Vec<String> = norms.into_iter().collect();
    let rank_map = contact_rank_map_for_addresses(conn, ids, &norms_vec)?;
    let mut out: Vec<(T, f64, String)> = rows
        .into_iter()
        .map(|r| {
            let fa = normalize_address(from_address(&r));
            let rank = *rank_map.get(&fa).unwrap_or(&0.0);
            let d = date(&r).to_string();
            (r, rank, d)
        })
        .collect();
    out.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.2.cmp(&a.2))
    });
    Ok(out.into_iter().map(|(r, _, _)| r).collect())
}

#[derive(Debug, Clone)]
pub struct RankedSearchRow {
    pub result: SearchResult,
    pub combined_rank: f64,
}

/// Participant contact-rank boost (OPP-012). Strips `combined_rank` from output rows.
pub fn apply_contact_rank_rerank(
    conn: &Connection,
    owner_address: Option<&str>,
    owner_aliases: &[String],
    rows: Vec<RankedSearchRow>,
) -> rusqlite::Result<Vec<SearchResult>> {
    let mut owner_identities: Vec<String> = Vec::new();
    if let Some(p) = owner_address.map(str::trim).filter(|s| !s.is_empty()) {
        owner_identities.push(p.to_string());
    }
    for a in owner_aliases {
        let t = a.trim();
        if !t.is_empty() {
            owner_identities.push(t.to_string());
        }
    }
    if owner_identities.is_empty() {
        return Ok(rows.into_iter().map(|r| r.result).collect());
    }

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let owner_norms: std::collections::HashSet<String> = owner_identities
        .iter()
        .map(|s| normalize_address(s))
        .collect();
    let ids: Vec<String> = rows
        .iter()
        .map(|r| r.result.message_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT message_id, from_address, to_addresses, cc_addresses FROM messages WHERE message_id IN ({placeholders})"
    );

    let mut stmt = conn.prepare(&sql)?;
    let meta_rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    let mut by_id = std::collections::HashMap::new();
    for r in meta_rows.flatten() {
        by_id.insert(r.0, (r.1, r.2, r.3));
    }

    let mut all_addresses = std::collections::HashSet::new();
    for (from_a, to_j, cc_j) in by_id.values() {
        all_addresses.insert(normalize_address(from_a));
        for a in parse_json_addresses(to_j) {
            all_addresses.insert(normalize_address(&a));
        }
        for a in parse_json_addresses(cc_j) {
            all_addresses.insert(normalize_address(&a));
        }
    }
    for n in &owner_norms {
        all_addresses.remove(n);
    }

    let addr_vec: Vec<String> = all_addresses.into_iter().collect();
    let rank_map = contact_rank_map_for_addresses(conn, &owner_identities, &addr_vec)?;

    let mut scored: Vec<(RankedSearchRow, f64)> = rows
        .into_iter()
        .map(|r| {
            let mut max_rank = 0.0_f64;
            if let Some((from_a, to_j, cc_j)) = by_id.get(&r.result.message_id) {
                let mut parts = std::collections::HashSet::new();
                parts.insert(normalize_address(from_a));
                for a in parse_json_addresses(to_j) {
                    parts.insert(normalize_address(&a));
                }
                for a in parse_json_addresses(cc_j) {
                    parts.insert(normalize_address(&a));
                }
                parts.retain(|p| !owner_norms.contains(p));
                for p in parts {
                    max_rank = max_rank.max(*rank_map.get(&p).unwrap_or(&0.0));
                }
            }
            let final_rank = r.combined_rank - SEARCH_CONTACT_RANK_BOOST_ALPHA * max_rank;
            (r, final_rank)
        })
        .collect();

    scored.sort_by(|a, b| {
        a.1.partial_cmp(&b.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.0.result.date.cmp(&a.0.result.date))
    });

    Ok(scored.into_iter().map(|(r, _)| r.result).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contact_rank_more_sent_orders_higher() {
        let a = contact_rank_simple(10, 0);
        let b = contact_rank_simple(5, 0);
        assert!(a > b);
    }

    #[test]
    fn contact_rank_non_negative() {
        assert!(contact_rank_simple(0, 0) >= 0.0);
        assert!(contact_rank_simple(3, 100) >= 0.0);
    }

    #[test]
    fn contact_rank_who_demotes_mention_only() {
        let mention_only = ContactFields {
            sent_count: 0,
            replied_count: 0,
            received_count: 0,
            mentioned_count: 1000,
            sent_new_count: 0,
            sent_small_reply_count: 0,
        };
        let with_direct = ContactFields {
            sent_count: 1,
            replied_count: 0,
            received_count: 0,
            mentioned_count: 50,
            sent_new_count: 0,
            sent_small_reply_count: 0,
        };
        assert!(compute_contact_rank_who(&with_direct) > compute_contact_rank_who(&mention_only));
    }
}
