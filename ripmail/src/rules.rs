//! File-backed inbox rules (v4: search pattern + optional structured filters per rule).

use std::collections::HashSet;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::{apply_schema, open_memory};
use crate::search::{count_messages_matching_rule_query, SearchOptions};

/// Bundled defaults when `rules.json` is missing (`ripmail inbox` / first load).
pub const DEFAULT_RULES_JSON: &str = include_str!("rules/default_rules.v3.json");

/// Current `rules.json` **`version`** field. Files with a lower version (or legacy `kind: "regex"` rules) are replaced with [`DEFAULT_RULES_JSON`] on load (previous file renamed to `rules.json.bak.<uuid>`).
pub const RULES_FILE_FORMAT_VERSION: u32 = 4;

#[derive(thiserror::Error)]
pub enum RulesError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid action: {0}")]
    InvalidAction(String),
    #[error("missing update fields")]
    MissingUpdateFields,
    #[error("duplicate rule id: {0}")]
    DuplicateRuleId(String),
    #[error("invalid search query for rule {id}: {message}")]
    InvalidRuleQuery { id: String, message: String },
    #[error("invalid rules file: {0}")]
    InvalidRules(String),
    /// Existing file on disk cannot be parsed as rules v3 (legacy, corrupt JSON, etc.).
    #[error(
        "rules file is unusable: {}\n\n{}\n\nReplace with bundled defaults (current file is renamed to rules.json.bak.<uuid> in the same directory):\n  ripmail rules reset-defaults --yes\n\nOr migrate by hand to v3 rules (each rule has \"kind\": \"search\" and a \"query\" string). See skills/ripmail/references/INBOX-CUSTOMIZATION.md in the ripmail repo.",
        path.display(),
        detail
    )]
    UnusableRulesFile { path: PathBuf, detail: String },
}

impl fmt::Debug for RulesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RulesFile {
    #[serde(default = "default_rules_version")]
    pub version: u32,
    #[serde(default)]
    pub rules: Vec<UserRule>,
    #[serde(default)]
    pub context: Vec<ContextEntry>,
}

/// Inbox rule: `kind` is **`search`** — same options as `ripmail search` (regex pattern + structured filters).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UserRule {
    #[serde(rename = "search", rename_all = "camelCase")]
    Search {
        id: String,
        action: String,
        /// Regex matched against subject + body; empty when using only structured filters below.
        #[serde(default)]
        query: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_address: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to_address: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subject: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        category: Option<String>,
        #[serde(default)]
        from_or_to_union: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        /// When true (default), a rule that matches one message in a thread applies to every
        /// still-`pending` message in that thread within the inbox window. Set `threadScope: false`
        /// for legacy message-only matching.
        #[serde(default = "default_rule_thread_scope")]
        thread_scope: bool,
    },
}

fn default_rule_thread_scope() -> bool {
    true
}

impl UserRule {
    pub fn id(&self) -> &str {
        match self {
            UserRule::Search { id, .. } => id.as_str(),
        }
    }

    pub fn action_str(&self) -> &str {
        match self {
            UserRule::Search { action, .. } => action.as_str(),
        }
    }
}

/// Build [`SearchOptions`] for a rule: structured filters plus optional regex [`UserRule::Search::query`].
pub fn search_options_from_rule(rule: &UserRule, base: &SearchOptions) -> SearchOptions {
    let mut o = base.clone();
    match rule {
        UserRule::Search {
            query,
            from_address,
            to_address,
            subject,
            category,
            from_or_to_union,
            thread_scope,
            ..
        } => {
            let q = query.trim();
            if !q.is_empty() {
                o.query = Some(q.to_string());
            }
            if let Some(ref f) = from_address {
                if !f.trim().is_empty() {
                    o.from_address = Some(f.trim().to_string());
                }
            }
            if let Some(ref t) = to_address {
                if !t.trim().is_empty() {
                    o.to_address = Some(t.trim().to_string());
                }
            }
            if let Some(ref s) = subject {
                if !s.trim().is_empty() {
                    o.subject = Some(s.trim().to_string());
                }
            }
            if let Some(ref c) = category {
                if !c.trim().is_empty() {
                    o.categories = vec![c.trim().to_ascii_lowercase()];
                }
            }
            o.from_or_to_union = *from_or_to_union;
            o.thread_scope = *thread_scope;
        }
    }
    o
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEntry {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleFeedbackProposal {
    pub proposed: ProposedRule,
    pub reasoning: String,
    pub apply: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedRule {
    pub condition: String,
    pub action: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleActionKind {
    Notify,
    Inform,
    Ignore,
}

fn default_rules_version() -> u32 {
    RULES_FILE_FORMAT_VERSION
}

pub fn rules_path(home: &Path) -> PathBuf {
    home.join("rules.json")
}

/// Per-mailbox overlay: `$RIPMAIL_HOME/<mailbox_id>/rules.json` ([OPP-016](../docs/opportunities/archive/OPP-016-multi-inbox.md)).
pub fn mailbox_rules_path(home: &Path, mailbox_id: &str) -> PathBuf {
    home.join(mailbox_id).join("rules.json")
}

/// Directory containing `rules.json` — `RIPMAIL_HOME` or `RIPMAIL_HOME/<mailbox_id>` for overlays.
pub fn rules_directory_for_mailbox(home: &Path, mailbox_id: Option<&str>) -> PathBuf {
    match mailbox_id {
        Some(id) if !id.trim().is_empty() => home.join(id.trim()),
        _ => home.to_path_buf(),
    }
}

fn merge_rules_files(mut global: RulesFile, overlay: RulesFile) -> RulesFile {
    global.rules.extend(overlay.rules);
    global.context.extend(overlay.context);
    global.version = global.version.max(overlay.version);
    global
}

/// Global `rules.json` plus optional per-mailbox overlay (global rules first, then overlay).
pub fn load_effective_rules_for_mailbox(
    home: &Path,
    mailbox_id: &str,
) -> Result<RulesFile, RulesError> {
    let global = load_rules_file(home)?;
    let mb_path = mailbox_rules_path(home, mailbox_id);
    if !mb_path.exists() {
        return Ok(global);
    }
    let overlay = load_rules_file_from_path(&mb_path)?;
    Ok(merge_rules_files(global, overlay))
}

/// Fingerprint of the merged rules list for one mailbox (inbox cache invalidation).
pub fn effective_rules_fingerprint_for_mailbox(
    home: &Path,
    mailbox_id: &str,
) -> Result<String, RulesError> {
    let file = load_effective_rules_for_mailbox(home, mailbox_id)?;
    Ok(rules_fingerprint(&file))
}

/// Composite fingerprint when scanning one or more mailboxes (stable across id order).
pub fn inbox_rules_fingerprint_for_scope(
    home: &Path,
    mailbox_ids: &[String],
) -> Result<String, RulesError> {
    use std::collections::BTreeSet;
    if mailbox_ids.is_empty() {
        let g = load_rules_file(home)?;
        return Ok(rules_fingerprint(&g));
    }
    let mut parts: Vec<String> = Vec::new();
    for id in mailbox_ids.iter().collect::<BTreeSet<_>>() {
        let fp = effective_rules_fingerprint_for_mailbox(home, id)?;
        parts.push(format!("{id}:{fp}"));
    }
    parts.sort();
    let joined = parts.join("|");
    let mut hasher = Sha256::new();
    hasher.update(joined.as_bytes());
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

fn rules_lock_path(home: &Path) -> PathBuf {
    home.join("rules.lock")
}

pub fn parse_rule_action(action: &str) -> Result<RuleActionKind, RulesError> {
    let trimmed = action.trim();
    if trimmed.eq_ignore_ascii_case("notify") {
        return Ok(RuleActionKind::Notify);
    }
    if trimmed.eq_ignore_ascii_case("inform") {
        return Ok(RuleActionKind::Inform);
    }
    if trimmed.eq_ignore_ascii_case("ignore")
        || trimmed.eq_ignore_ascii_case("suppress")
        || trimmed.eq_ignore_ascii_case("archive")
    {
        return Ok(RuleActionKind::Ignore);
    }
    Err(RulesError::InvalidAction(trimmed.to_string()))
}

fn generate_id(existing_ids: impl Iterator<Item = String>) -> String {
    let existing: HashSet<String> = existing_ids.collect();
    loop {
        let candidate = Uuid::new_v4()
            .simple()
            .to_string()
            .chars()
            .take(4)
            .collect::<String>();
        if !existing.contains(&candidate) {
            return candidate;
        }
    }
}

/// Write bundled defaults if `rules.json` does not exist (idempotent).
pub fn ensure_default_rules_file(home: &Path) -> Result<(), RulesError> {
    let path = rules_path(home);
    if path.exists() {
        return Ok(());
    }
    fs::create_dir_all(home)?;
    let file: RulesFile = serde_json::from_str(DEFAULT_RULES_JSON)?;
    write_rules_file_atomically(home, &file)?;
    Ok(())
}

fn reject_legacy_keys(raw: &str, path: &Path) -> Result<(), RulesError> {
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| diagnose_rules_parse_failure(path, raw, e))?;
    if let Some(rules) = v.get("rules").and_then(|r| r.as_array()) {
        for (i, rule) in rules.iter().enumerate() {
            if rule.get("snippetPattern").is_some() {
                return Err(RulesError::InvalidRules(format!(
                    "rules[{i}]: \"snippetPattern\" is not supported; use \"query\""
                )));
            }
            if rule.get("kind").and_then(|k| k.as_str()) == Some("regex") {
                return Err(RulesError::InvalidRules(format!(
                    "rules[{i}]: \"kind\": \"regex\" is no longer supported; use \"kind\": \"search\" with a \"query\" field (same language as ripmail search)"
                )));
            }
        }
    }
    Ok(())
}

/// Parse `rules.json` body from disk; on failure, classify legacy v1 / corrupt JSON for CLI messages.
pub(crate) fn parse_rules_file_str(raw: &str, path: &Path) -> Result<RulesFile, RulesError> {
    reject_legacy_keys(raw, path)?;
    let mut file: RulesFile = match serde_json::from_str(raw) {
        Ok(f) => f,
        Err(e) => return Err(diagnose_rules_parse_failure(path, raw, e)),
    };
    if file.version == 0 {
        file.version = default_rules_version();
    }
    validate_rules_file(&file)?;
    Ok(file)
}

fn diagnose_rules_parse_failure(path: &Path, raw: &str, e: serde_json::Error) -> RulesError {
    let mut detail = format!("{e}");
    let es = e.to_string();
    if es.contains("missing field `kind`") {
        detail = "Expected each rule to include \"kind\": \"search\". \
                  Older ripmail used version 1 with a free-text \"condition\" field — that format is no longer loaded."
            .to_string();
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
        if v.get("version").and_then(|x| x.as_u64()) == Some(1) {
            detail = "\"version\": 1 is no longer supported. ripmail requires rules.json version 3 with \"kind\": \"search\" rules."
                .to_string();
        } else if let Some(rules) = v.get("rules").and_then(|r| r.as_array()) {
            for (i, rule) in rules.iter().enumerate() {
                let obj = rule.as_object();
                let missing_kind = obj.is_some_and(|o| !o.contains_key("kind"));
                let looks_legacy = obj.is_some_and(|o| o.contains_key("condition"));
                if missing_kind && looks_legacy {
                    detail = format!(
                        "rules[{i}] looks like a legacy rule (has \"condition\" but no \"kind\"). Convert to v3 search rules or run `ripmail rules reset-defaults --yes`."
                    );
                    break;
                }
            }
        }
    }
    RulesError::UnusableRulesFile {
        path: path.to_path_buf(),
        detail,
    }
}

/// Returns `true` if the JSON describes a rules file older than [`RULES_FILE_FORMAT_VERSION`], or contains legacy `kind: "regex"` rules.
pub fn rules_file_needs_default_replacement(v: &serde_json::Value) -> bool {
    if let Some(ver) = v.get("version").and_then(|x| x.as_u64()) {
        if (ver as u32) < RULES_FILE_FORMAT_VERSION {
            return true;
        }
    }
    if let Some(rules) = v.get("rules").and_then(|r| r.as_array()) {
        for rule in rules {
            if rule.get("kind").and_then(|k| k.as_str()) == Some("regex") {
                return true;
            }
        }
    }
    false
}

pub fn load_rules_file_from_path(path: &Path) -> Result<RulesFile, RulesError> {
    if !path.exists() {
        return Ok(RulesFile {
            version: default_rules_version(),
            ..Default::default()
        });
    }
    let _home = path.parent().ok_or_else(|| {
        RulesError::InvalidRules(format!(
            "rules path has no parent directory: {}",
            path.display()
        ))
    })?;
    let raw = fs::read_to_string(path)?;
    parse_rules_file_str(&raw, path)
}

/// Replace `rules.json` with bundled defaults. If a file already exists, rename it to `rules.json.bak.<uuid>`.
pub fn reset_rules_to_bundled_defaults(home: &Path) -> Result<Option<PathBuf>, RulesError> {
    fs::create_dir_all(home)?;
    let path = rules_path(home);
    let backup = if path.exists() {
        let bak = home.join(format!("rules.json.bak.{}", Uuid::new_v4().simple()));
        fs::rename(&path, &bak)?;
        Some(bak)
    } else {
        None
    };
    let file: RulesFile = serde_json::from_str(DEFAULT_RULES_JSON)?;
    write_rules_file_atomically(home, &file)?;
    Ok(backup)
}

pub fn load_rules_file(home: &Path) -> Result<RulesFile, RulesError> {
    ensure_default_rules_file(home)?;
    load_rules_file_from_path(&rules_path(home))
}

fn rule_has_search_criteria(rule: &UserRule) -> bool {
    match rule {
        UserRule::Search {
            query,
            from_address,
            to_address,
            subject,
            category,
            ..
        } => {
            !query.trim().is_empty()
                || from_address.as_ref().is_some_and(|s| !s.trim().is_empty())
                || to_address.as_ref().is_some_and(|s| !s.trim().is_empty())
                || subject.as_ref().is_some_and(|s| !s.trim().is_empty())
                || category.as_ref().is_some_and(|s| !s.trim().is_empty())
        }
    }
}

fn validate_rule_queries_compile(file: &RulesFile) -> Result<(), RulesError> {
    let conn = open_memory().map_err(|e| RulesError::InvalidRules(format!("db: {e}")))?;
    apply_schema(&conn).map_err(|e| RulesError::InvalidRules(format!("schema: {e}")))?;
    let base = SearchOptions::default();
    for rule in &file.rules {
        let UserRule::Search { id, .. } = rule;
        if !rule_has_search_criteria(rule) {
            return Err(RulesError::InvalidRuleQuery {
                id: id.clone(),
                message: "empty pattern and no structured filters (fromAddress, category, …)"
                    .into(),
            });
        }
        let opts = search_options_from_rule(rule, &base);
        count_messages_matching_rule_query(&conn, &opts).map_err(|e| {
            RulesError::InvalidRuleQuery {
                id: id.clone(),
                message: e.to_string(),
            }
        })?;
    }
    Ok(())
}

/// Validate rules (duplicate ids, action, non-empty search query, SQL compile).
pub fn validate_rules_file(file: &RulesFile) -> Result<(), RulesError> {
    if file.version > 0 && file.version < 4 {
        return Err(RulesError::InvalidRules(
            "rules.json must be version 4 (search rules with structured filters). Run: ripmail rules reset-defaults --yes"
                .into(),
        ));
    }
    let mut seen = HashSet::new();
    for rule in &file.rules {
        let id = rule.id().to_string();
        if !seen.insert(id.clone()) {
            return Err(RulesError::DuplicateRuleId(id));
        }
        parse_rule_action(rule.action_str())?;
    }
    validate_rule_queries_compile(file)
}

/// Like [`validate_rules_file`] plus optional counts against an open DB (real index).
pub fn validate_rules_file_with_db_sample(
    file: &RulesFile,
    conn: &rusqlite::Connection,
) -> Result<(), RulesError> {
    validate_rules_file(file)?;
    let base = SearchOptions::default();
    for rule in &file.rules {
        let UserRule::Search { id, .. } = rule;
        let opts = search_options_from_rule(rule, &base);
        let _n = count_messages_matching_rule_query(conn, &opts).map_err(|e| {
            RulesError::InvalidRuleQuery {
                id: id.clone(),
                message: e.to_string(),
            }
        })?;
    }
    Ok(())
}

fn lock_rules_file(home: &Path) -> Result<File, RulesError> {
    fs::create_dir_all(home)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(rules_lock_path(home))?;
    lock.lock_exclusive()?;
    Ok(lock)
}

fn write_rules_file_atomically(home: &Path, rules: &RulesFile) -> Result<(), RulesError> {
    validate_rules_file(rules)?;
    fs::create_dir_all(home)?;
    let path = rules_path(home);
    let tmp_path = home.join(format!(
        ".rules.json.tmp.{}.{}",
        std::process::id(),
        Uuid::new_v4().simple()
    ));
    let raw = serde_json::to_string_pretty(rules)?;
    {
        let mut tmp = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp_path)?;
        tmp.write_all(format!("{raw}\n").as_bytes())?;
        tmp.sync_all()?;
    }
    fs::rename(&tmp_path, &path)?;
    if let Ok(dir) = File::open(home) {
        let _ = dir.sync_all();
    }
    Ok(())
}

fn with_locked_rules_file<T, F>(home: &Path, mutate: F) -> Result<T, RulesError>
where
    F: FnOnce(&mut RulesFile) -> Result<T, RulesError>,
{
    let lock = lock_rules_file(home)?;
    let path = rules_path(home);
    let mut file = if path.exists() {
        let raw = fs::read_to_string(&path)?;
        parse_rules_file_str(&raw, &path)?
    } else {
        RulesFile {
            version: default_rules_version(),
            ..Default::default()
        }
    };
    validate_rules_file(&file)?;
    let out = mutate(&mut file)?;
    validate_rules_file(&file)?;
    write_rules_file_atomically(home, &file)?;
    lock.unlock()?;
    Ok(out)
}

pub fn save_rules_file(home: &Path, rules: &RulesFile) -> Result<(), RulesError> {
    let replacement = rules.clone();
    validate_rules_file(&replacement)?;
    with_locked_rules_file(home, |file| {
        *file = replacement;
        Ok(())
    })
}

fn trim_opt_owned(s: Option<String>) -> Option<String> {
    s.and_then(|t| {
        let t = t.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

fn trim_filter_opt(s: Option<&str>) -> Option<String> {
    s.and_then(|t| {
        let t = t.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

/// Append a search rule or insert before an existing rule id when `insert_before` is set.
///
/// `query` is the body/subject regex pattern only (no inline `from:` / `subject:` tokens). Provide at
/// least one of a non-empty `query` or a structured filter (`from_address`, `to_address`, `subject`, `category`).
#[allow(clippy::too_many_arguments)] // CLI aggregates many optional filters; a struct would not simplify callers.
pub fn add_search_rule(
    home: &Path,
    action: &str,
    query: &str,
    from_address: Option<&str>,
    to_address: Option<&str>,
    subject: Option<&str>,
    category: Option<&str>,
    from_or_to_union: bool,
    description: Option<String>,
    insert_before: Option<&str>,
    mailbox_id: Option<&str>,
    thread_scope: bool,
) -> Result<UserRule, RulesError> {
    parse_rule_action(action)?;
    let q = query.trim().to_string();
    let from_address = trim_filter_opt(from_address);
    let to_address = trim_filter_opt(to_address);
    let subject = trim_filter_opt(subject);
    let category = trim_filter_opt(category);
    let description = trim_opt_owned(description);
    let base = rules_directory_for_mailbox(home, mailbox_id);
    with_locked_rules_file(&base, |file| {
        file.version = file.version.max(default_rules_version());
        let id = generate_id(
            file.rules
                .iter()
                .map(|r| r.id().to_string())
                .chain(file.context.iter().map(|c| c.id.clone())),
        );
        let rule = UserRule::Search {
            id,
            action: action.trim().to_string(),
            query: q,
            from_address,
            to_address,
            subject,
            category,
            from_or_to_union,
            description,
            thread_scope,
        };
        if !rule_has_search_criteria(&rule) {
            return Err(RulesError::InvalidRules(
                "search rule needs a non-empty --query or at least one of --from, --to, --subject, --category"
                    .into(),
            ));
        }
        if let Some(before_id) = insert_before.map(str::trim).filter(|s| !s.is_empty()) {
            let Some(idx) = file.rules.iter().position(|r| r.id() == before_id) else {
                return Err(RulesError::InvalidRules(format!(
                    "insert-before: no rule with id {before_id:?}"
                )));
            };
            file.rules.insert(idx, rule.clone());
        } else {
            file.rules.push(rule.clone());
        }
        Ok(rule)
    })
}

pub fn add_rule_from_json(
    home: &Path,
    json_rule: &str,
    insert_before: Option<&str>,
) -> Result<UserRule, RulesError> {
    let v: serde_json::Value = serde_json::from_str(json_rule)
        .map_err(|e| RulesError::InvalidRules(format!("invalid rule JSON: {e}")))?;
    if v.get("snippetPattern").is_some() {
        return Err(RulesError::InvalidRules(
            "\"snippetPattern\" is not supported; use \"query\"".into(),
        ));
    }
    let mut rule: UserRule = serde_json::from_value(v)
        .map_err(|e| RulesError::InvalidRules(format!("invalid rule JSON: {e}")))?;
    with_locked_rules_file(home, |file| {
        file.version = file.version.max(default_rules_version());
        let id = generate_id(
            file.rules
                .iter()
                .map(|r| r.id().to_string())
                .chain(file.context.iter().map(|c| c.id.clone())),
        );
        let UserRule::Search { id: rid, .. } = &mut rule;
        rid.clear();
        rid.push_str(&id);
        if let Some(before_id) = insert_before.map(str::trim).filter(|s| !s.is_empty()) {
            let Some(idx) = file.rules.iter().position(|r| r.id() == before_id) else {
                return Err(RulesError::InvalidRules(format!(
                    "insert-before: no rule with id {before_id:?}"
                )));
            };
            file.rules.insert(idx, rule.clone());
        } else {
            file.rules.push(rule.clone());
        }
        Ok(rule)
    })
}

/// Patch optional rule fields. For structured filters (`from_address`, etc.), pass `Some("")` to clear.
#[allow(clippy::too_many_arguments)] // Same as `add_search_rule`: mirrors CLI patch fields.
pub fn edit_rule(
    home: &Path,
    id: &str,
    action: Option<&str>,
    query: Option<&str>,
    from_address: Option<&str>,
    to_address: Option<&str>,
    subject: Option<&str>,
    category: Option<&str>,
    from_or_to_union: Option<bool>,
    thread_scope: Option<bool>,
    mailbox_id: Option<&str>,
) -> Result<Option<UserRule>, RulesError> {
    let has_any = action.is_some()
        || query.is_some()
        || from_address.is_some()
        || to_address.is_some()
        || subject.is_some()
        || category.is_some()
        || from_or_to_union.is_some()
        || thread_scope.is_some();
    if !has_any {
        return Err(RulesError::MissingUpdateFields);
    }
    if let Some(a) = action {
        parse_rule_action(a)?;
    }
    let base = rules_directory_for_mailbox(home, mailbox_id);
    with_locked_rules_file(&base, |file| {
        let Some(rule) = file.rules.iter_mut().find(|rule| rule.id() == id) else {
            return Ok(None);
        };
        let UserRule::Search {
            action: ra,
            query: rq,
            from_address: fa,
            to_address: ta,
            subject: sj,
            category: cat,
            from_or_to_union: fotu,
            thread_scope: ts,
            ..
        } = rule;
        if let Some(action) = action {
            *ra = action.trim().to_string();
        }
        if let Some(q) = query {
            *rq = q.trim().to_string();
        }
        if let Some(f) = from_address {
            *fa = trim_filter_opt(Some(f));
        }
        if let Some(t) = to_address {
            *ta = trim_filter_opt(Some(t));
        }
        if let Some(s) = subject {
            *sj = trim_filter_opt(Some(s));
        }
        if let Some(c) = category {
            *cat = trim_filter_opt(Some(c));
        }
        if let Some(u) = from_or_to_union {
            *fotu = u;
        }
        if let Some(scope) = thread_scope {
            *ts = scope;
        }
        if !rule_has_search_criteria(rule) {
            return Err(RulesError::InvalidRules(
                "edit would leave the rule with no criteria (need non-empty query or at least one of from/to/subject/category)"
                    .into(),
            ));
        }
        Ok(Some(rule.clone()))
    })
}

pub fn remove_rule(
    home: &Path,
    id: &str,
    mailbox_id: Option<&str>,
) -> Result<Option<UserRule>, RulesError> {
    let base = rules_directory_for_mailbox(home, mailbox_id);
    with_locked_rules_file(&base, |file| {
        let Some(index) = file.rules.iter().position(|rule| rule.id() == id) else {
            return Ok(None);
        };
        Ok(Some(file.rules.remove(index)))
    })
}

/// Move rule `id` relative to another rule: exactly one of `insert_before` / `insert_after` must be set
/// (the other `None`). Higher precedence = earlier in the list.
pub fn move_rule(
    home: &Path,
    id: &str,
    insert_before: Option<&str>,
    insert_after: Option<&str>,
    mailbox_id: Option<&str>,
) -> Result<Option<UserRule>, RulesError> {
    let before = insert_before.map(str::trim).filter(|s| !s.is_empty());
    let after = insert_after.map(str::trim).filter(|s| !s.is_empty());
    let (anchor_id, place_before) = match (before, after) {
        (None, None) => {
            return Err(RulesError::InvalidRules(
                "move rule: pass exactly one of --before or --after".into(),
            ));
        }
        (Some(_), Some(_)) => {
            return Err(RulesError::InvalidRules(
                "move rule: pass only one of --before or --after".into(),
            ));
        }
        (Some(b), None) => (b, true),
        (None, Some(a)) => (a, false),
    };

    let base = rules_directory_for_mailbox(home, mailbox_id);
    with_locked_rules_file(&base, |file| {
        let Some(from_idx) = file.rules.iter().position(|r| r.id() == id) else {
            return Ok(None);
        };
        if anchor_id == id {
            return Err(RulesError::InvalidRules(
                "move rule: cannot move relative to itself".into(),
            ));
        }
        let Some(anchor_idx) = file.rules.iter().position(|r| r.id() == anchor_id) else {
            return Err(RulesError::InvalidRules(format!(
                "move rule: no rule with id {anchor_id:?}"
            )));
        };
        let rule = file.rules.remove(from_idx);
        let mut anchor_idx_after = anchor_idx;
        if from_idx < anchor_idx {
            anchor_idx_after -= 1;
        }
        let insert_idx = if place_before {
            anchor_idx_after
        } else {
            anchor_idx_after + 1
        };
        file.rules.insert(insert_idx, rule);
        Ok(Some(file.rules[insert_idx].clone()))
    })
}

pub fn rules_fingerprint(file: &RulesFile) -> String {
    let rules_json: Vec<serde_json::Value> = file
        .rules
        .iter()
        .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
        .collect();
    let mut context = file.context.clone();
    context.sort_by(|a, b| a.id.cmp(&b.id).then_with(|| a.text.cmp(&b.text)));
    let normalized = serde_json::json!({
        "version": file.version,
        "rules": rules_json,
        "context": context,
    });
    let mut hasher = Sha256::new();
    hasher.update(normalized.to_string().as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn propose_rule_from_feedback(feedback: &str) -> RuleFeedbackProposal {
    let normalized = feedback.trim();
    let lower = normalized.to_ascii_lowercase();
    let (condition, action, reasoning) = if lower.contains("shipping")
        || lower.contains("tracking")
        || lower.contains("delivery")
    {
        (
            "pattern: tracking|delivery|shipped; optional --from for a specific shipper domain".to_string(),
            "ignore".to_string(),
            "Use `ripmail rules add`: put keywords in `--query` only; use `--from` / `--subject` for headers (not `from:` inside the pattern). See `ripmail rules add --help`."
                .to_string(),
        )
    } else if lower.contains("invoice")
        || lower.contains("receipt")
        || lower.contains("billing")
        || lower.contains("statement")
    {
        (
            "--from stripe.com (or your billing sender) plus --query receipt|invoice|statement".to_string(),
            "ignore".to_string(),
            "Structured filters use `--from` / `--subject`; body keywords go in `--query`. Run `ripmail rules validate` after edits."
                .to_string(),
        )
    } else if lower.contains("flight")
        || lower.contains("hotel")
        || lower.contains("travel")
        || lower.contains("itinerary")
    {
        (
            "--query 'itinerary|flight|hotel' (add --subject for a fixed phrase if needed)"
                .to_string(),
            "inform".to_string(),
            "Travel mail is often time-sensitive; use notify or inform.".to_string(),
        )
    } else if lower.contains("security")
        || lower.contains("fraud")
        || lower.contains("bank")
        || lower.contains("alert")
    {
        (
            "otp OR verification OR 2fa".to_string(),
            "notify".to_string(),
            "Security alerts should use notify; tune default search rules if needed.".to_string(),
        )
    } else {
        let action = "ignore".to_string();
        (
            normalized.to_string(),
            action.clone(),
            "Edit $RIPMAIL_HOME/rules.json (search queries); run ripmail rules validate."
                .to_string(),
        )
    };
    RuleFeedbackProposal {
        proposed: ProposedRule {
            condition: condition.clone(),
            action: action.clone(),
        },
        reasoning,
        apply: "Use `ripmail rules add` with `--query` for the body/subject pattern and `--from` / `--subject` / `--category` for metadata (see `ripmail rules add --help`), or `ripmail rules reset-defaults --yes` if the file is legacy/corrupt, or edit $RIPMAIL_HOME/rules.json by hand / with an agent."
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_json_omitted_thread_scope_defaults_true() {
        let r: UserRule =
            serde_json::from_str(r#"{"kind":"search","id":"x","action":"ignore","query":"y"}"#)
                .unwrap();
        assert!(matches!(
            r,
            UserRule::Search {
                thread_scope: true,
                ..
            }
        ));
    }

    #[test]
    fn action_parser_rejects_tag() {
        assert!(parse_rule_action("tag:travel").is_err());
    }

    #[test]
    fn action_parser_accepts_notify_and_inform() {
        assert_eq!(parse_rule_action("notify").unwrap(), RuleActionKind::Notify);
        assert_eq!(parse_rule_action("inform").unwrap(), RuleActionKind::Inform);
    }

    #[test]
    fn missing_file_after_ensure_loads_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let file = load_rules_file(dir.path()).unwrap();
        assert_eq!(file.version, RULES_FILE_FORMAT_VERSION);
        assert!(!file.rules.is_empty());
        assert!(file.context.is_empty());
    }

    #[test]
    fn default_rules_json_validates() {
        let file: RulesFile = serde_json::from_str(DEFAULT_RULES_JSON).unwrap();
        validate_rules_file(&file).unwrap();
    }

    #[test]
    fn rules_file_needs_default_replacement_logic() {
        let v1 = serde_json::json!({"version": 1, "rules": []});
        assert!(rules_file_needs_default_replacement(&v1));
        let v3 = serde_json::json!({"version": 3, "rules": [{"kind":"search","id":"x","action":"ignore","query":"a"}]});
        assert!(rules_file_needs_default_replacement(&v3));
        let v4 = serde_json::json!({"version": 4, "rules": [{"kind":"search","id":"x","action":"ignore","query":"a"}]});
        assert!(!rules_file_needs_default_replacement(&v4));
        let mixed = serde_json::json!({"version": 3, "rules": [{"kind":"regex","id":"x","action":"ignore","fromPattern":"x"}]});
        assert!(rules_file_needs_default_replacement(&mixed));
    }

    #[test]
    fn stale_rules_v2_regex_rejected_no_auto_migration() {
        let json = r#"{"version":2,"rules":[{"kind":"regex","id":"x","action":"ignore","snippetPattern":"(?i)foo"}],"context":[]}"#;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path()).unwrap();
        let path = rules_path(dir.path());
        std::fs::write(&path, json).unwrap();
        let err = load_rules_file_from_path(&path).unwrap_err();
        assert!(
            err.to_string().contains("regex") || err.to_string().contains("snippetPattern"),
            "{err}"
        );
    }

    #[test]
    fn save_rules_file_creates_lock_and_json() {
        let dir = tempfile::tempdir().unwrap();
        let rules = serde_json::from_str::<RulesFile>(DEFAULT_RULES_JSON).unwrap();
        save_rules_file(dir.path(), &rules).unwrap();
        assert!(rules_path(dir.path()).exists());
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        assert_eq!(loaded.rules.len(), rules.rules.len());
    }

    #[test]
    fn rules_fingerprint_changes_when_rule_order_changes() {
        let a: RulesFile = serde_json::from_str(DEFAULT_RULES_JSON).unwrap();
        let mut b = a.clone();
        b.rules.reverse();
        assert_ne!(rules_fingerprint(&a), rules_fingerprint(&b));
    }

    #[test]
    fn rules_fingerprint_changes_when_action_changes() {
        let a: RulesFile = serde_json::from_str(DEFAULT_RULES_JSON).unwrap();
        let mut b = a.clone();
        let target = b
            .rules
            .iter_mut()
            .find(|r| r.action_str() == "ignore")
            .expect("defaults include at least one ignore rule");
        let UserRule::Search { action, .. } = target;
        *action = "inform".into();
        assert_ne!(rules_fingerprint(&a), rules_fingerprint(&b));
    }

    #[test]
    fn add_search_rule_category_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let rule = add_rule_from_json(
            dir.path(),
            r#"{"kind":"search","id":"tmp","action":"inform","query":"","category":"promotional","description":"Promo bucket"}"#,
            None,
        )
        .unwrap();
        assert_eq!(rule.action_str(), "inform");
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        assert!(loaded.rules.iter().any(|r| {
            matches!(
                r,
                UserRule::Search {
                    query,
                    category: Some(c),
                    ..
                } if query.is_empty() && c == "promotional"
            )
        }));
    }

    #[test]
    fn add_search_rule_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let rule = add_search_rule(
            dir.path(),
            "ignore",
            "newsletter|digest",
            None,
            None,
            None,
            None,
            false,
            None,
            None,
            None,
            true,
        )
        .unwrap();
        assert_eq!(rule.action_str(), "ignore");
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        assert!(loaded.rules.iter().any(|r| {
            matches!(r, UserRule::Search { query, .. } if query == "newsletter|digest")
        }));
    }

    #[test]
    fn add_search_rule_from_only_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let rule = add_search_rule(
            dir.path(),
            "ignore",
            "",
            Some("legacycapfunders.com"),
            None,
            None,
            None,
            false,
            None,
            None,
            None,
            true,
        )
        .unwrap();
        assert!(matches!(
            rule,
            UserRule::Search {
                query,
                from_address: Some(ref f),
                ..
            } if query.is_empty() && f == "legacycapfunders.com"
        ));
    }

    #[test]
    fn edit_rule_thread_scope_only() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let rule = add_search_rule(
            dir.path(),
            "ignore",
            "pat",
            None,
            None,
            None,
            None,
            false,
            None,
            None,
            None,
            true,
        )
        .unwrap();
        let id = rule.id().to_string();
        let updated = edit_rule(
            dir.path(),
            &id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(false),
            None,
        )
        .unwrap()
        .unwrap();
        assert!(matches!(
            updated,
            UserRule::Search {
                thread_scope: false,
                ..
            }
        ));
        let again = edit_rule(
            dir.path(),
            &id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(true),
            None,
        )
        .unwrap()
        .unwrap();
        assert!(matches!(
            again,
            UserRule::Search {
                thread_scope: true,
                ..
            }
        ));
    }

    #[test]
    fn add_search_rule_from_pattern_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let rule = add_rule_from_json(
            dir.path(),
            r#"{"kind":"search","id":"tmp","action":"notify","query":"","fromAddress":"acme.test"}"#,
            None,
        )
        .unwrap();
        assert_eq!(rule.action_str(), "notify");
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        assert!(loaded.rules.iter().any(|r| {
            matches!(
                r,
                UserRule::Search {
                    query,
                    from_address: Some(f),
                    ..
                } if query.is_empty() && f == "acme.test"
            )
        }));
    }

    #[test]
    fn add_search_rule_insert_before_places_rule_first() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let loaded_before = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        let first_id = loaded_before.rules[0].id().to_string();
        let rule = add_rule_from_json(
            dir.path(),
            r#"{"kind":"search","id":"tmp","action":"inform","query":"","fromAddress":"insert-test.example"}"#,
            Some(&first_id),
        )
        .unwrap();
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        assert_eq!(loaded.rules[0].id(), rule.id());
        assert_eq!(loaded.rules[1].id(), first_id.as_str());
    }

    #[test]
    fn add_search_rule_insert_before_unknown_id_errors() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let err = add_search_rule(
            dir.path(),
            "inform",
            "x",
            None,
            None,
            None,
            None,
            false,
            None,
            Some("no-such-id"),
            None,
            true,
        )
        .unwrap_err();
        assert!(err.to_string().contains("insert-before"));
    }

    #[test]
    fn move_rule_before_works() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        let a = loaded.rules[0].id().to_string();
        let b = loaded.rules[1].id().to_string();
        move_rule(dir.path(), &b, Some(&a), None, None).unwrap();
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        assert_eq!(loaded.rules[0].id(), b);
        assert_eq!(loaded.rules[1].id(), a);
    }

    #[test]
    fn move_rule_after_last_appends() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        let n = loaded.rules.len();
        let first = loaded.rules[0].id().to_string();
        let last = loaded.rules[n - 1].id().to_string();
        move_rule(dir.path(), &first, None, Some(&last), None).unwrap();
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        assert_eq!(loaded.rules[n - 1].id(), first);
    }

    #[test]
    fn move_rule_requires_before_or_after() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let err = move_rule(dir.path(), "x", None, None, None).unwrap_err();
        assert!(err.to_string().contains("exactly one"));
    }

    #[test]
    fn move_rule_rejects_both_before_and_after() {
        let dir = tempfile::tempdir().unwrap();
        let _ = load_rules_file(dir.path()).unwrap();
        let loaded = load_rules_file_from_path(&rules_path(dir.path())).unwrap();
        let a = loaded.rules[0].id().to_string();
        let b = loaded.rules[1].id().to_string();
        let err = move_rule(dir.path(), &a, Some(&b), Some(&b), None).unwrap_err();
        assert!(err.to_string().contains("only one"));
    }

    #[test]
    fn load_legacy_v1_rules_rejected_no_auto_migration() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path()).unwrap();
        let path = rules_path(dir.path());
        fs::write(
            &path,
            r#"{"version":1,"rules":[{"id":"a","condition":"noise","action":"ignore"}],"context":[]}"#,
        )
        .unwrap();
        let err = load_rules_file_from_path(&path).unwrap_err();
        assert!(
            err.to_string().contains("version") || err.to_string().contains("rules.json"),
            "{err}"
        );
    }

    #[test]
    fn reset_rules_replaces_corrupt_file_with_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = rules_path(dir.path());
        fs::create_dir_all(dir.path()).unwrap();
        fs::write(&path, "{\"version\":2,\"rules\":[\n").unwrap();
        let bak = reset_rules_to_bundled_defaults(dir.path()).unwrap();
        assert!(bak.is_some());
        assert!(bak
            .as_ref()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("rules.json.bak."));
        let loaded = load_rules_file_from_path(&path).unwrap();
        validate_rules_file(&loaded).unwrap();
        assert!(!loaded.rules.is_empty());
    }
}
