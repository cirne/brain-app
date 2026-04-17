//! Deterministic inbox rule evaluation (`rules.json` v3 — search queries).

use std::collections::HashMap;

use async_trait::async_trait;
use rusqlite::Connection;

use crate::inbox::scan::{
    compute_deterministic_picks, compute_deterministic_picks_resolved, inbox_fallback_pick,
    InboxBatchClassifier, InboxCandidate, InboxNotablePick, RunInboxScanError, RunInboxScanOptions,
};
use crate::rules::RulesFile;

/// Precomputed picks from SQLite + FTS (same predicates as `ripmail search`).
pub struct DeterministicInboxClassifier {
    picks: HashMap<String, InboxNotablePick>,
}

impl DeterministicInboxClassifier {
    pub fn new(
        conn: &Connection,
        rules: &RulesFile,
        options: &RunInboxScanOptions,
    ) -> Result<Self, RunInboxScanError> {
        let picks = compute_deterministic_picks(conn, rules, options)?;
        Ok(Self { picks })
    }

    /// Resolve global + optional `$RIPMAIL_HOME/<id>/rules.json` overlay per mailbox ([OPP-016]).
    pub fn new_for_home(
        conn: &Connection,
        home: &std::path::Path,
        options: &RunInboxScanOptions,
    ) -> Result<Self, RunInboxScanError> {
        let picks = compute_deterministic_picks_resolved(conn, home, options)?;
        Ok(Self { picks })
    }
}

#[async_trait]
impl InboxBatchClassifier for DeterministicInboxClassifier {
    async fn classify_batch(
        &mut self,
        batch: Vec<InboxCandidate>,
    ) -> Result<Vec<InboxNotablePick>, RunInboxScanError> {
        Ok(batch
            .iter()
            .map(|c| {
                self.picks
                    .get(&c.message_id)
                    .cloned()
                    .unwrap_or_else(|| inbox_fallback_pick(c))
            })
            .collect())
    }
}

/// Classify one candidate (tests).
pub fn classify_candidate(
    conn: &Connection,
    rules: &RulesFile,
    options: &RunInboxScanOptions,
    c: &InboxCandidate,
) -> Result<InboxNotablePick, RunInboxScanError> {
    let picks = compute_deterministic_picks(conn, rules, options)?;
    Ok(picks
        .get(&c.message_id)
        .cloned()
        .unwrap_or_else(|| inbox_fallback_pick(c)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;
    use crate::inbox::state::InboxSurfaceMode;
    use crate::rules::{validate_rules_file, RulesFile, UserRule};

    fn candidate(mid: &str, from: &str, body: &str) -> InboxCandidate {
        InboxCandidate {
            message_id: mid.into(),
            source_id: "".into(),
            date: "2026-01-01T00:00:00Z".into(),
            from_address: from.into(),
            from_name: None,
            to_addresses: vec![],
            cc_addresses: vec![],
            subject: "s".into(),
            snippet: body.chars().take(200).collect(),
            body_text: body.into(),
            category: None,
            attachments: vec![],
        }
    }

    fn opts() -> RunInboxScanOptions {
        RunInboxScanOptions {
            source_ids: vec![],
            surface_mode: InboxSurfaceMode::Review,
            cutoff_iso: "1970-01-01T00:00:00.000Z".into(),
            include_all: true,
            replay: true,
            reapply_llm: true,
            include_archived_candidates: false,
            diagnostics: false,
            rules_fingerprint: None,
            owner_address: None,
            owner_aliases: vec![],
            candidate_cap: Some(50),
            notable_cap: None,
            batch_size: None,
        }
    }

    #[test]
    fn earlier_rule_wins_when_both_match() {
        let conn = open_memory().unwrap();
        crate::db::apply_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO messages (message_id, thread_id, folder, uid, labels, from_address, to_addresses, cc_addresses, subject, body_text, date, raw_path)
             VALUES ('<m1>', '<m1>', 'INBOX', 1, '[]', 'a@b.com', '[]', '[]', 'hello', 'hello world', '2026-01-01T00:00:00Z', 'p')",
            [],
        )
        .unwrap();

        let rules = RulesFile {
            version: 4,
            rules: vec![
                UserRule::Search {
                    id: "first".into(),
                    action: "ignore".into(),
                    query: String::new(),
                    from_address: Some("a@b.com".into()),
                    to_address: None,
                    subject: None,
                    category: None,
                    from_or_to_union: false,
                    description: None,
                },
                UserRule::Search {
                    id: "second".into(),
                    action: "notify".into(),
                    query: String::new(),
                    from_address: Some("a@b.com".into()),
                    to_address: None,
                    subject: None,
                    category: None,
                    from_or_to_union: false,
                    description: None,
                },
            ],
            context: vec![],
        };
        validate_rules_file(&rules).unwrap();
        let c = candidate("<m1>", "a@b.com", "hello world");
        let pick = classify_candidate(&conn, &rules, &opts(), &c).unwrap();
        assert_eq!(
            pick.matched_rule_ids.first().map(String::as_str),
            Some("first")
        );
        assert_eq!(pick.action.as_deref(), Some("ignore"));
    }

    #[test]
    fn opp038_style_from_or_to_and_keyword() {
        let conn = open_memory().unwrap();
        crate::db::apply_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO messages (message_id, thread_id, folder, uid, labels, from_address, to_addresses, cc_addresses, subject, body_text, date, raw_path)
             VALUES ('<m2>', '<m2>', 'INBOX', 1, '[]', 'x@y.com', '[\"me@z.com\"]', '[]', 'sub', 'zoom meeting', '2026-01-01T00:00:00Z', 'p')",
            [],
        )
        .unwrap();

        let rules = RulesFile {
            version: 4,
            rules: vec![UserRule::Search {
                id: "self-zoom".into(),
                action: "inform".into(),
                query: "zoom".into(),
                from_address: None,
                to_address: Some("me@z.com".into()),
                subject: None,
                category: None,
                from_or_to_union: false,
                description: None,
            }],
            context: vec![],
        };
        validate_rules_file(&rules).unwrap();
        let c = candidate("<m2>", "x@y.com", "zoom meeting");
        let pick = classify_candidate(&conn, &rules, &opts(), &c).unwrap();
        assert_eq!(
            pick.matched_rule_ids.first().map(String::as_str),
            Some("self-zoom")
        );
    }
}
