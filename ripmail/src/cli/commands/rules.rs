use crate::cli::args::RulesCmd;
use crate::cli::util::{load_cfg, ripmail_home_path};
use crate::cli::CliResult;
use ripmail::{
    add_search_rule, db, edit_rule, inbox_rules_fingerprint_for_scope,
    load_effective_rules_for_mailbox, load_rules_file, load_rules_file_from_path,
    mailbox_rules_path, move_rule, parse_inbox_window_to_iso_cutoff, preview_rule_impact,
    propose_rule_from_feedback, remove_rule, reset_rules_to_bundled_defaults, resolve_mailbox_spec,
    rules_path, validate_rules_file, validate_rules_file_with_db_sample,
    DeterministicInboxClassifier, InboxSurfaceMode, RefreshPreviewRow, RuleImpactPreview,
    RulesError, RulesFile, RunInboxScanOptions, SupersessionByRule,
};

fn resolve_mailbox_id(mailbox: Option<&str>) -> Result<Option<String>, Box<dyn std::error::Error>> {
    let Some(spec) = mailbox.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let cfg = load_cfg();
    let mb = resolve_mailbox_spec(cfg.resolved_mailboxes(), spec)
        .ok_or_else(|| format!("Unknown mailbox {spec}"))?;
    Ok(Some(mb.id.clone()))
}

/// Representative rows for agents: mix of “this rule wins” vs “superseded by higher precedence”.
const RULE_PREVIEW_MAX_SAMPLES: usize = 8;
const RULE_PREVIEW_SUBJECT_MAX_CHARS: usize = 120;
const RULE_PREVIEW_SNIPPET_MAX_CHARS: usize = 220;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RulePreviewSampleRow {
    #[serde(
        rename = "messageId",
        serialize_with = "ripmail::ids::serialize_string_id_for_json"
    )]
    message_id: String,
    date: String,
    #[serde(rename = "fromAddress")]
    from_address: String,
    #[serde(rename = "fromName", skip_serializing_if = "Option::is_none")]
    from_name: Option<String>,
    subject: String,
    snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<String>,
    #[serde(rename = "matchedRuleIds")]
    matched_rule_ids: Vec<String>,
    /// `deciding` — this rule is first in `matchedRuleIds`. `superseded` — a higher-precedence rule matched first.
    decision_role: &'static str,
    #[serde(rename = "winningRuleId", skip_serializing_if = "Option::is_none")]
    winning_rule_id: Option<String>,
}

fn truncate_preview_text(s: &str, max_chars: usize) -> String {
    let t = s.trim();
    let mut it = t.chars();
    let mut out = String::new();
    for _ in 0..max_chars {
        let Some(ch) = it.next() else {
            return out;
        };
        out.push(ch);
    }
    if it.next().is_some() {
        out.push('…');
    }
    out
}

fn row_matches_rule(row: &RefreshPreviewRow, rule_id: &str) -> bool {
    row.matched_rule_ids.iter().any(|id| id == rule_id)
}

fn row_rule_decides(row: &RefreshPreviewRow, rule_id: &str) -> bool {
    row.matched_rule_ids
        .first()
        .map(|id| id.as_str() == rule_id)
        .unwrap_or(false)
}

fn refresh_row_to_sample(row: &RefreshPreviewRow, rule_id: &str) -> RulePreviewSampleRow {
    let decides = row_rule_decides(row, rule_id);
    let winning = row.matched_rule_ids.first().cloned();
    RulePreviewSampleRow {
        message_id: row.message_id.clone(),
        date: row.date.clone(),
        from_address: row.from_address.clone(),
        from_name: row.from_name.clone(),
        subject: truncate_preview_text(&row.subject, RULE_PREVIEW_SUBJECT_MAX_CHARS),
        snippet: truncate_preview_text(&row.snippet, RULE_PREVIEW_SNIPPET_MAX_CHARS),
        action: row.action.clone(),
        matched_rule_ids: row.matched_rule_ids.clone(),
        decision_role: if decides { "deciding" } else { "superseded" },
        winning_rule_id: if decides { None } else { winning },
    }
}

/// Pick a small set of rows so agents can sanity-check rule breadth (too broad / too narrow).
fn build_rule_preview_samples(
    matched: &[RefreshPreviewRow],
    rule_id: &str,
) -> Vec<RulePreviewSampleRow> {
    let deciding: Vec<&RefreshPreviewRow> = matched
        .iter()
        .filter(|r| row_matches_rule(r, rule_id) && row_rule_decides(r, rule_id))
        .collect();
    let superseded: Vec<&RefreshPreviewRow> = matched
        .iter()
        .filter(|r| row_matches_rule(r, rule_id) && !row_rule_decides(r, rule_id))
        .collect();

    let mut picked: Vec<&RefreshPreviewRow> = Vec::new();
    if superseded.is_empty() {
        picked.extend(deciding.iter().take(RULE_PREVIEW_MAX_SAMPLES).copied());
    } else if deciding.is_empty() {
        picked.extend(superseded.iter().take(RULE_PREVIEW_MAX_SAMPLES).copied());
    } else {
        let mut n_dec = deciding.len().min(5);
        let mut n_sup = superseded.len().min(3);
        while n_dec + n_sup > RULE_PREVIEW_MAX_SAMPLES {
            if n_dec > 0 && (n_sup == 0 || n_dec >= n_sup) {
                n_dec -= 1;
            } else if n_sup > 0 {
                n_sup -= 1;
            } else {
                break;
            }
        }
        picked.extend(deciding.iter().take(n_dec).copied());
        picked.extend(superseded.iter().take(n_sup).copied());
    }

    picked
        .into_iter()
        .map(|r| refresh_row_to_sample(r, rule_id))
        .collect()
}

/// Shown in JSON after mutating rules so agents re-run inbox triage (new `rules_fingerprint`).
fn rules_change_hints_json() -> serde_json::Value {
    serde_json::json!([
        "Re-triage with the current ruleset: ripmail inbox --reapply (optional window, e.g. ripmail inbox 30d --reapply).",
        "Rules apply to whole threads by default (`threadScope` true). Use `ripmail rules add --message-only` or `ripmail rules edit <id> --message-only` for per-message matching; `ripmail rules list` shows each rule JSON including `threadScope`."
    ])
}

fn compact_rules_move_json(rules: &RulesFile, moved_id: &str) -> serde_json::Value {
    let entries: Vec<serde_json::Value> = rules
        .rules
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id(),
                "action": r.action_str(),
            })
        })
        .collect();
    serde_json::json!({
        "moved": moved_id,
        "rules": entries,
        "hints": rules_change_hints_json(),
    })
}

fn print_compact_rules_move_text(rules: &RulesFile, moved_id: &str) {
    println!("moved: {moved_id}");
    println!("rulesOrder (first = highest precedence):");
    for (i, r) in rules.rules.iter().enumerate() {
        println!("  {:>3}  {}  {}", i, r.id(), r.action_str());
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RulePreviewJson {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    candidates_scanned: usize,
    llm_duration_ms: u64,
    /// Messages where this rule appears in the match chain (includes superseded).
    matched_count: usize,
    /// Messages where this rule is first in `matchedRuleIds` (its action applies).
    effective_matched_count: usize,
    /// Messages that also match this rule, but a higher-precedence rule matched first.
    superseded_match_count: usize,
    superseded_by_higher_priority: Vec<SupersessionByRule>,
    /// Representative messages (truncated fields) for quick agent review.
    samples: Vec<RulePreviewSampleRow>,
    #[serde(skip)]
    all_matched: Vec<RefreshPreviewRow>,
}

impl RulePreviewJson {
    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            available: false,
            reason: Some(reason.into()),
            candidates_scanned: 0,
            llm_duration_ms: 0,
            matched_count: 0,
            effective_matched_count: 0,
            superseded_match_count: 0,
            superseded_by_higher_priority: Vec::new(),
            samples: Vec::new(),
            all_matched: Vec::new(),
        }
    }

    fn from_preview(preview: RuleImpactPreview, rule_id: &str) -> Self {
        let samples = build_rule_preview_samples(&preview.matched, rule_id);
        let all_matched = preview.matched;
        Self {
            available: true,
            reason: None,
            candidates_scanned: preview.candidates_scanned,
            llm_duration_ms: preview.llm_duration_ms,
            matched_count: all_matched.len(),
            effective_matched_count: preview.effective_matched_count,
            superseded_match_count: preview.superseded_match_count,
            superseded_by_higher_priority: preview.superseded_by_higher_priority,
            samples,
            all_matched,
        }
    }
}

fn build_rule_preview(
    home: &std::path::Path,
    rule_id: &str,
    preview_window: Option<&str>,
    mailbox: Option<&str>,
) -> Result<RulePreviewJson, Box<dyn std::error::Error>> {
    let cfg = load_cfg();
    let window = preview_window
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&cfg.inbox_default_window);
    let cutoff_iso = match parse_inbox_window_to_iso_cutoff(window) {
        Ok(value) => value,
        Err(err) => {
            return Ok(RulePreviewJson::unavailable(format!(
                "Preview unavailable: preview window '{window}' is invalid: {err}"
            )));
        }
    };
    // Inbox rule preview replays / re-samples the DB and may persist triage state — needs write.
    let conn = db::open_file(cfg.db_path())?;
    let mailbox_ids: Vec<String> = match resolve_mailbox_id(mailbox)? {
        None => vec![],
        Some(id) => vec![id],
    };
    let fp = inbox_rules_fingerprint_for_scope(home, &mailbox_ids)?;
    let owner = (!cfg.imap_user.trim().is_empty()).then(|| cfg.imap_user.clone());
    let opts = RunInboxScanOptions {
        surface_mode: InboxSurfaceMode::Review,
        cutoff_iso,
        include_all: false,
        replay: true,
        reapply_llm: true,
        include_archived_candidates: true,
        diagnostics: true,
        rules_fingerprint: Some(fp),
        owner_address: owner,
        owner_aliases: cfg.imap_aliases.clone(),
        candidate_cap: None,
        notable_cap: None,
        batch_size: None,
        source_ids: mailbox_ids,
    };
    let mut classifier = DeterministicInboxClassifier::new_for_home(&conn, home, &opts)?;
    let runtime = tokio::runtime::Runtime::new()?;
    let preview = runtime.block_on(preview_rule_impact(&conn, &opts, &mut classifier, rule_id))?;
    Ok(RulePreviewJson::from_preview(preview, rule_id))
}

fn print_rule_preview_text(preview: &RulePreviewJson) {
    println!();
    println!("Rule preview:");
    if !preview.available {
        if let Some(reason) = &preview.reason {
            println!("  {reason}");
        }
        return;
    }
    println!(
        "  matched {} of {} recent inbox candidates (pattern chain includes this rule)",
        preview.matched_count, preview.candidates_scanned
    );
    println!(
        "  this rule decides the action for {} of those; {} superseded by higher-priority rules",
        preview.effective_matched_count, preview.superseded_match_count
    );
    if !preview.superseded_by_higher_priority.is_empty() {
        println!("  higher-priority winners (rule id → count):");
        for e in &preview.superseded_by_higher_priority {
            println!("    {} → {}", e.winning_rule_id, e.count);
        }
    }
    println!("  classify time: {} ms", preview.llm_duration_ms);
    if preview.all_matched.is_empty() {
        println!("  No recent messages matched this rule.");
        return;
    }
    if !preview.samples.is_empty() {
        println!("  Sample messages (check fit: too broad / too narrow / wrong senders):");
        for s in &preview.samples {
            let role = s.decision_role;
            let win = s
                .winning_rule_id
                .as_deref()
                .map(|w| format!("; higher rule {w} wins"))
                .unwrap_or_default();
            println!(
                "    [{role}]{win}  {}  |  {}  |  {}",
                s.subject, s.from_address, s.message_id
            );
            if !s.snippet.is_empty() {
                println!("      {}", s.snippet);
            }
        }
        if preview.all_matched.len() > preview.samples.len() {
            println!(
                "  … {} total matches in window; showing {} samples above.",
                preview.all_matched.len(),
                preview.samples.len()
            );
        }
    }
}

pub(crate) fn run_rules(sub: RulesCmd, source: Option<String>) -> CliResult {
    let home = ripmail_home_path();
    let mb_id = resolve_mailbox_id(source.as_deref())?;
    match sub {
        RulesCmd::Validate { sample } => {
            let rules = match &mb_id {
                None => load_rules_file(&home)?,
                Some(id) => load_effective_rules_for_mailbox(&home, id)?,
            };
            validate_rules_file(&rules)?;
            if sample {
                let cfg = load_cfg();
                let conn = db::open_file_for_queries(cfg.db_path())?;
                validate_rules_file_with_db_sample(&rules, &conn)?;
            }
            println!("OK: {} rule(s)", rules.rules.len());
        }
        RulesCmd::ResetDefaults { yes } => {
            if mb_id.is_some() {
                return Err(
                    "reset-defaults applies only to $RIPMAIL_HOME/rules.json; omit --source".into(),
                );
            }
            if !yes {
                eprintln!(
                    "This replaces {} with bundled default rules.\n\
The current file will be renamed to rules.json.bak.<uuid> in the same directory.\n\
Re-run with: ripmail rules reset-defaults --yes",
                    rules_path(&home).display()
                );
                std::process::exit(1);
            }
            match reset_rules_to_bundled_defaults(&home) {
                Ok(Some(bak)) => {
                    println!("Backed up previous rules to {}", bak.display());
                    println!("Wrote bundled defaults to {}", rules_path(&home).display());
                }
                Ok(None) => {
                    println!("Wrote bundled defaults to {}", rules_path(&home).display());
                }
                Err(e) => return Err(e.into()),
            }
        }
        RulesCmd::List { text } => {
            let rules = match &mb_id {
                None => load_rules_file(&home)?,
                Some(id) => load_rules_file_from_path(&mailbox_rules_path(&home, id))?,
            };
            let path_display = match &mb_id {
                None => rules_path(&home),
                Some(id) => mailbox_rules_path(&home, id),
            };
            if text {
                println!("Rules file: {}", path_display.display());
                println!("Rules:");
                for rule in rules.rules {
                    println!("  {}", serde_json::to_string(&rule)?);
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&rules)?);
            }
        }
        RulesCmd::Show { id, text } => {
            let rules = match &mb_id {
                None => load_rules_file(&home)?,
                Some(mid) => load_rules_file_from_path(&mailbox_rules_path(&home, mid))?,
            };
            if let Some(rule) = rules.rules.iter().find(|rule| rule.id() == id) {
                if text {
                    println!("{}", serde_json::to_string_pretty(rule)?);
                } else {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&serde_json::json!({
                            "type": "rule",
                            "value": rule
                        }))?
                    );
                }
            } else {
                eprintln!("Rule not found: {id}");
                std::process::exit(1);
            }
        }
        RulesCmd::Add {
            action,
            query,
            from,
            to,
            subject,
            category,
            from_or_to_union,
            insert_before,
            description,
            preview_window,
            text,
            message_only,
        } => {
            let thread_scope = !message_only;
            let q = query.as_deref().unwrap_or("");
            let rule = add_search_rule(
                &home,
                &action,
                q,
                from.as_deref(),
                to.as_deref(),
                subject.as_deref(),
                category.as_deref(),
                from_or_to_union,
                description,
                insert_before.as_deref(),
                mb_id.as_deref(),
                thread_scope,
            )?;
            let preview = build_rule_preview(
                &home,
                rule.id(),
                preview_window.as_deref(),
                mb_id.as_deref(),
            )?;
            if text {
                println!("{}", serde_json::to_string_pretty(&rule)?);
                print_rule_preview_text(&preview);
            } else {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "rule": rule,
                        "preview": preview,
                        "hints": rules_change_hints_json(),
                    }))?
                );
            }
        }
        RulesCmd::Edit {
            id,
            action,
            query,
            from,
            to,
            subject,
            category,
            from_or_to_union,
            set_message_only,
            set_whole_thread,
            preview_window,
            text,
        } => {
            let thread_scope = if set_message_only {
                Some(false)
            } else if set_whole_thread {
                Some(true)
            } else {
                None
            };
            let has_structured = from.is_some()
                || to.is_some()
                || subject.is_some()
                || category.is_some()
                || from_or_to_union.is_some();
            if action.is_none() && query.is_none() && thread_scope.is_none() && !has_structured {
                return Err(RulesError::InvalidRules(
                    "pass at least one of --action, --query, --from, --to, --subject, --category, --from-or-to-union, --message-only, or --whole-thread"
                        .into(),
                )
                .into());
            }
            let Some(rule) = edit_rule(
                &home,
                &id,
                action.as_deref(),
                query.as_deref(),
                from.as_deref(),
                to.as_deref(),
                subject.as_deref(),
                category.as_deref(),
                from_or_to_union,
                thread_scope,
                mb_id.as_deref(),
            )?
            else {
                eprintln!("Rule not found: {id}");
                std::process::exit(1);
            };
            let preview = build_rule_preview(
                &home,
                rule.id(),
                preview_window.as_deref(),
                mb_id.as_deref(),
            )?;
            if text {
                println!("{}", serde_json::to_string_pretty(&rule)?);
                print_rule_preview_text(&preview);
            } else {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "rule": rule,
                        "preview": preview,
                        "hints": rules_change_hints_json(),
                    }))?
                );
            }
        }
        RulesCmd::Remove { id, yes: _, text } => {
            let Some(rule) = remove_rule(&home, &id, mb_id.as_deref())? else {
                eprintln!("Rule not found: {id}");
                std::process::exit(1);
            };
            if text {
                println!("Removed [{}]", rule.id());
            } else {
                println!("{}", serde_json::to_string_pretty(&rule)?);
            }
        }
        RulesCmd::Move {
            id,
            before,
            after,
            text,
        } => {
            if move_rule(
                &home,
                &id,
                before.as_deref(),
                after.as_deref(),
                mb_id.as_deref(),
            )?
            .is_none()
            {
                eprintln!("Rule not found: {id}");
                std::process::exit(1);
            }
            let rules = match &mb_id {
                None => load_rules_file(&home)?,
                Some(mid) => load_rules_file_from_path(&mailbox_rules_path(&home, mid))?,
            };
            if text {
                print_compact_rules_move_text(&rules, &id);
            } else {
                let v = compact_rules_move_json(&rules, &id);
                println!("{}", serde_json::to_string_pretty(&v)?);
            }
        }
        RulesCmd::Feedback { feedback, text } => {
            let proposal = propose_rule_from_feedback(&feedback);
            if text {
                println!("Proposed rule:");
                println!("  action: {}", proposal.proposed.action);
                println!("  condition: {}", proposal.proposed.condition);
                println!("Reasoning:");
                println!("  {}", proposal.reasoning);
                println!("Apply:");
                println!("  {}", proposal.apply);
            } else {
                println!("{}", serde_json::to_string_pretty(&proposal)?);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod sample_picker_tests {
    use super::build_rule_preview_samples;
    use ripmail::RefreshPreviewRow;

    fn row(msg_idx: usize, ids: &[&str]) -> RefreshPreviewRow {
        let matched_rule_ids: Vec<String> = ids.iter().map(|s| (*s).to_string()).collect();
        debug_assert!(!matched_rule_ids.is_empty());
        let action = matched_rule_ids
            .first()
            .map(|w| if w == "low" { "ignore" } else { "notify" }.to_string());
        RefreshPreviewRow {
            message_id: format!("<m{msg_idx}@t>"),
            source_id: "".into(),
            date: "2026-01-01T00:00:00Z".into(),
            from_address: "a@b.com".into(),
            from_name: None,
            subject: "subj".into(),
            snippet: "snip".into(),
            note: None,
            attachments: None,
            category: None,
            action,
            matched_rule_ids,
            decision_source: None,
            requires_user_action: false,
            action_summary: None,
        }
    }

    #[test]
    fn samples_include_both_deciding_and_superseded_when_present() {
        let rid = "low";
        let matched = vec![row(0, &["low"]), row(1, &["low"]), row(2, &["high", "low"])];
        let s = build_rule_preview_samples(&matched, rid);
        assert!(s.iter().any(|x| x.decision_role == "deciding"), "{s:?}");
        assert!(s.iter().any(|x| x.decision_role == "superseded"), "{s:?}");
        assert!(s
            .iter()
            .any(|x| x.winning_rule_id.as_deref() == Some("high")));
    }
}

#[cfg(test)]
mod preview_counts_tests {
    use ripmail::{InboxDispositionCounts, RefreshPreviewRow};

    fn preview_counts(rows: &[RefreshPreviewRow]) -> InboxDispositionCounts {
        let mut counts = InboxDispositionCounts::default();
        for row in rows {
            match row.action.as_deref() {
                Some("notify") => counts.notify += 1,
                Some("inform") => counts.inform += 1,
                Some("ignore") => counts.ignore += 1,
                _ => {}
            }
            if row.requires_user_action {
                counts.action_required += 1;
            }
        }
        counts
    }

    fn row(action: Option<&str>, requires_user_action: bool) -> RefreshPreviewRow {
        RefreshPreviewRow {
            message_id: "<x@test>".into(),
            source_id: "".into(),
            date: "2026-01-01T00:00:00Z".into(),
            from_address: "a@b.com".into(),
            from_name: None,
            subject: "s".into(),
            snippet: "b".into(),
            note: None,
            attachments: None,
            category: None,
            action: action.map(String::from),
            matched_rule_ids: vec![],
            decision_source: None,
            requires_user_action,
            action_summary: requires_user_action.then(|| "Do the thing".into()),
        }
    }

    #[test]
    fn preview_counts_action_required_independent_of_notify_inform_ignore() {
        let rows = vec![
            row(Some("notify"), true),
            row(Some("inform"), true),
            row(Some("inform"), false),
            row(Some("ignore"), true),
        ];
        let c = preview_counts(&rows);
        assert_eq!(c.notify, 1);
        assert_eq!(c.inform, 2);
        assert_eq!(c.ignore, 1);
        assert_eq!(c.action_required, 3);
    }

    #[test]
    fn preview_counts_ignores_unknown_action_but_still_counts_action_required() {
        let mut r = row(None, true);
        r.action = None;
        let c = preview_counts(std::slice::from_ref(&r));
        assert_eq!(c.notify, 0);
        assert_eq!(c.inform, 0);
        assert_eq!(c.ignore, 0);
        assert_eq!(c.action_required, 1);
    }
}
