//! `ripmail who` — dynamic contacts from messages (`src/search/who-dynamic.ts` subset).

use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

use super::contact_rank::{
    compute_contact_rank_who, contact_fields_for_addresses, contact_rank_simple, ContactFields,
};
use super::edit_distance::fuzzy_name_token_match;
use super::infer_name::infer_name_from_address;
use super::nicknames::canonical_first_name;
use super::noreply::is_noreply;
use super::normalize::normalize_address;
use super::phonetics::name_matches_phonetically;
use crate::sync::MailboxEntry;

#[derive(Debug, Clone)]
pub struct WhoOptions {
    pub query: String,
    pub limit: usize,
    pub include_noreply: bool,
    /// When set, only aggregate messages whose `mailbox_id` is in this list.
    pub mailbox_ids: Option<Vec<String>>,
    /// When set (non-empty), use owner-centric interaction counts and `contactRank` (see `contact_rank`).
    /// Include the mailbox primary address and any IMAP aliases so `From:` matches indexed mail.
    pub owner_identities: Option<Vec<String>>,
    /// Normalized addresses to drop from results (user’s own accounts).
    pub omit_identity_norms: HashSet<String>,
}

impl Default for WhoOptions {
    fn default() -> Self {
        Self {
            query: String::new(),
            limit: 50,
            include_noreply: false,
            mailbox_ids: None,
            owner_identities: None,
            omit_identity_norms: HashSet::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhoPerson {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firstname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lastname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Display name from message headers (From / To / Cc), when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Heuristic label from `infer_name_from_address` when header names are absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_display_name: Option<String>,
    /// Stable id: `p` + 64-char hex(SHA256(`ripmail:who:person:v1:` + normalized email)).
    pub person_id: String,
    pub primary_address: String,
    pub addresses: Vec<String>,
    pub sent_count: i64,
    pub replied_count: i64,
    pub received_count: i64,
    pub mentioned_count: i64,
    /// Owner → peer messages that are not replies (new mail).
    pub sent_new_count: i64,
    /// Owner → peer replies in a small To+Cc set.
    pub sent_small_reply_count: i64,
    pub contact_rank: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_contact: Option<String>,
}

#[derive(Debug, Clone)]
struct Agg {
    norm_key: String,
    primary_address: String,
    display_name: Option<String>,
    sent: i64,
    received: i64,
    last_contact: Option<String>,
}

fn parse_addrs(json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(json).unwrap_or_default()
}

fn parse_mailbox_entries(json: &str) -> Vec<MailboxEntry> {
    serde_json::from_str::<Vec<MailboxEntry>>(json).unwrap_or_default()
}

fn first_name_token(display: &str) -> Option<String> {
    let t = display.trim();
    if t.is_empty() {
        return None;
    }
    t.split_whitespace()
        .next()
        .map(|s| s.trim_matches(|c: char| !c.is_alphabetic()).to_lowercase())
}

fn pick_longer_display_name(a: Option<&str>, b: Option<&str>) -> Option<String> {
    match (a, b) {
        (None, None) => None,
        (Some(x), None) => Some(x.trim().to_string()).filter(|s| !s.is_empty()),
        (None, Some(y)) => Some(y.trim().to_string()).filter(|s| !s.is_empty()),
        (Some(x), Some(y)) => {
            let x = x.trim();
            let y = y.trim();
            if x.is_empty() {
                return Some(y.to_string());
            }
            if y.is_empty() {
                return Some(x.to_string());
            }
            if y.len() > x.len() {
                Some(y.to_string())
            } else {
                Some(x.to_string())
            }
        }
    }
}

fn merge_display_name(cur: &mut Option<String>, incoming: Option<&str>) {
    let next = pick_longer_display_name(cur.as_deref(), incoming);
    if next.is_some() {
        *cur = next;
    }
}

fn matches_query(addr_norm: &str, display: Option<&str>, q: &str) -> bool {
    let ql = q.trim().to_lowercase();
    if ql.is_empty() {
        return true;
    }
    if addr_norm.contains(&ql) {
        return true;
    }
    if q.contains('@') && normalize_address(q) == addr_norm {
        return true;
    }
    if let Some(d) = display {
        let dl = d.to_lowercase();
        if dl.contains(&ql) {
            return true;
        }
        if let Some(first) = first_name_token(d) {
            let canon = canonical_first_name(&first);
            if name_matches_phonetically(&canon, &ql) || fuzzy_name_token_match(&canon, &ql) {
                return true;
            }
            if name_matches_phonetically(&first, &ql) || fuzzy_name_token_match(&first, &ql) {
                return true;
            }
        }
    }
    false
}

fn person_id_from_norm(norm: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"ripmail:who:person:v1:");
    hasher.update(norm.as_bytes());
    let d = hasher.finalize();
    format!(
        "p{}",
        d.iter().map(|b| format!("{:02x}", b)).collect::<String>()
    )
}

fn split_display_name(dn: &str) -> (Option<String>, Option<String>, Option<String>) {
    let parts: Vec<&str> = dn.split_whitespace().collect();
    if parts.len() >= 2 {
        (
            Some(parts[0].to_string()),
            Some(parts[parts.len() - 1].to_string()),
            None,
        )
    } else if parts.len() == 1 {
        (None, None, Some(dn.to_string()))
    } else {
        (None, None, None)
    }
}

fn recipient_display_for_index(entries: &[MailboxEntry], i: usize, addr: &str) -> Option<String> {
    let want = normalize_address(addr);
    if let Some(e) = entries.get(i) {
        if e.address.eq_ignore_ascii_case(addr) || normalize_address(&e.address) == want {
            return e.name.clone().filter(|s| !s.trim().is_empty());
        }
    }
    entries
        .iter()
        .find(|e| e.address.eq_ignore_ascii_case(addr) || normalize_address(&e.address) == want)
        .and_then(|e| e.name.clone())
        .filter(|s| !s.trim().is_empty())
}

fn bump_last_contact(lc: &mut Option<String>, d: &str) {
    if lc.as_ref().map(|x| d > x.as_str()).unwrap_or(true) {
        *lc = Some(d.to_string());
    }
}

/// Build contact list from indexed messages.
pub fn who(conn: &Connection, opts: &WhoOptions) -> rusqlite::Result<WhoResult> {
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
        ))
    };

    let rows: Vec<_> = match &opts.mailbox_ids {
        Some(ids) if !ids.is_empty() => {
            let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let sql = format!(
                "SELECT from_address, from_name, to_addresses, cc_addresses, to_recipients, cc_recipients, date FROM messages WHERE mailbox_id IN ({ph})"
            );
            let mut stmt = conn.prepare(&sql)?;
            let v: Vec<_> = stmt
                .query_map(rusqlite::params_from_iter(ids.iter()), map_row)?
                .filter_map(|r| r.ok())
                .collect();
            v
        }
        _ => {
            let mut stmt = conn.prepare(
                "SELECT from_address, from_name, to_addresses, cc_addresses, to_recipients, cc_recipients, date FROM messages",
            )?;
            let v: Vec<_> = stmt
                .query_map([], map_row)?
                .filter_map(|r| r.ok())
                .collect();
            v
        }
    };

    let mut map: std::collections::HashMap<String, Agg> = std::collections::HashMap::new();

    for r in rows {
        let (from_a, from_name, to_j, cc_j, to_rec_j, cc_rec_j, date) = r;
        let from_norm = normalize_address(&from_a);
        {
            let e = map.entry(from_norm.clone()).or_insert_with(|| Agg {
                norm_key: from_norm.clone(),
                primary_address: from_a.clone(),
                display_name: None,
                sent: 0,
                received: 0,
                last_contact: None,
            });
            merge_display_name(&mut e.display_name, from_name.as_deref());
            e.sent += 1;
            bump_last_contact(&mut e.last_contact, &date);
        }

        let to_addrs = parse_addrs(&to_j);
        let cc_addrs = parse_addrs(&cc_j);
        let to_entries = parse_mailbox_entries(&to_rec_j);
        let cc_entries = parse_mailbox_entries(&cc_rec_j);

        for (i, a) in to_addrs.iter().enumerate() {
            let al = normalize_address(a);
            let e = map.entry(al.clone()).or_insert_with(|| Agg {
                norm_key: al.clone(),
                primary_address: a.clone(),
                display_name: None,
                sent: 0,
                received: 0,
                last_contact: None,
            });
            let dn = recipient_display_for_index(&to_entries, i, a);
            merge_display_name(&mut e.display_name, dn.as_deref());
            e.received += 1;
            bump_last_contact(&mut e.last_contact, &date);
        }
        for (i, a) in cc_addrs.iter().enumerate() {
            let al = normalize_address(a);
            let e = map.entry(al.clone()).or_insert_with(|| Agg {
                norm_key: al.clone(),
                primary_address: a.clone(),
                display_name: None,
                sent: 0,
                received: 0,
                last_contact: None,
            });
            let dn = recipient_display_for_index(&cc_entries, i, a);
            merge_display_name(&mut e.display_name, dn.as_deref());
            e.received += 1;
            bump_last_contact(&mut e.last_contact, &date);
        }
    }

    let q = opts.query.trim();
    let norms: std::collections::HashSet<String> = map.keys().cloned().collect();

    let owner_stats: Option<std::collections::HashMap<String, ContactFields>> =
        if let Some(ref ids) = opts.owner_identities {
            let trimmed: Vec<String> = ids
                .iter()
                .filter_map(|s| {
                    let t = s.trim();
                    if t.is_empty() {
                        None
                    } else {
                        Some(t.to_string())
                    }
                })
                .collect();
            if trimmed.is_empty() {
                None
            } else {
                Some(contact_fields_for_addresses(
                    conn,
                    &trimmed,
                    &norms,
                    opts.mailbox_ids.as_deref(),
                )?)
            }
        } else {
            None
        };

    let mut people: Vec<WhoPerson> = Vec::new();

    for (_k, agg) in map {
        if !opts.include_noreply && is_noreply(&agg.primary_address) {
            continue;
        }
        if opts.omit_identity_norms.contains(&agg.norm_key) {
            continue;
        }
        if !matches_query(&agg.norm_key, agg.display_name.as_deref(), q) {
            continue;
        }

        let display_name = agg.display_name.clone();
        let suggested_display_name = if display_name.is_none() {
            infer_name_from_address(&agg.primary_address)
        } else {
            None
        };

        let (firstname, lastname, name) = if let Some(ref dn) = display_name {
            split_display_name(dn)
        } else if let Some(ref s) = suggested_display_name {
            split_display_name(s)
        } else {
            (None, None, None)
        };

        let (
            sent_count,
            replied_count,
            received_count,
            mentioned_count,
            sent_new_count,
            sent_small_reply_count,
            contact_rank,
        ) = if let Some(ref m) = owner_stats {
            let f = m.get(&agg.norm_key).cloned().unwrap_or_default();
            let r = compute_contact_rank_who(&f);
            (
                f.sent_count,
                f.replied_count,
                f.received_count,
                f.mentioned_count,
                f.sent_new_count,
                f.sent_small_reply_count,
                r,
            )
        } else {
            (
                agg.sent,
                0,
                agg.received,
                0,
                0,
                0,
                contact_rank_simple(agg.sent, agg.received),
            )
        };

        people.push(WhoPerson {
            firstname,
            lastname,
            name,
            display_name,
            suggested_display_name,
            person_id: person_id_from_norm(&agg.norm_key),
            primary_address: agg.primary_address.clone(),
            addresses: vec![agg.primary_address],
            sent_count,
            replied_count,
            received_count,
            mentioned_count,
            sent_new_count,
            sent_small_reply_count,
            contact_rank,
            last_contact: agg.last_contact,
        });
    }

    people.sort_by(|a, b| {
        b.contact_rank
            .partial_cmp(&a.contact_rank)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b.last_contact
                    .cmp(&a.last_contact)
                    .then_with(|| a.primary_address.cmp(&b.primary_address))
            })
    });

    let lim = opts.limit.max(1);
    people.truncate(lim);

    Ok(WhoResult {
        query: opts.query.clone(),
        people,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhoResult {
    pub query: String,
    pub people: Vec<WhoPerson>,
}
