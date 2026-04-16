//! Configuration — mirrors `src/lib/config.ts` (without OpenAI getter side effects for tests).

use async_openai::config::OpenAIConfig;
use async_openai::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Per-mailbox display name and signatures in `config.json` (`mailboxes[].identity`).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxIdentityJson {
    /// How the user goes by (LLM compose, salutation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    /// Active key in `signatures` (default: `default` when a default block exists).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature_id: Option<String>,
    /// Named signature bodies (Markdown/plain).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signatures: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigJson {
    pub imap: Option<ImapJson>,
    #[serde(default)]
    pub mailboxes: Option<Vec<MailboxConfigJson>>,
    pub smtp: Option<SmtpJson>,
    pub sync: Option<SyncJson>,
    pub attachments: Option<AttachmentsJson>,
    pub inbox: Option<InboxJson>,
    pub mailbox_management: Option<MailboxManagementJson>,
    /// Optional LLM provider and models ([OPP-046](../docs/opportunities/archive/OPP-046-llm-provider-flexibility.md)).
    #[serde(default)]
    pub llm: Option<LlmJson>,
}

/// Per-mailbox search scope in `config.json` ([OPP-016](../docs/opportunities/archive/OPP-016-multi-inbox.md)).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxSearchJson {
    /// When `false`, default search omits this mailbox unless `--mailbox` is set.
    pub include_in_default: Option<bool>,
}

/// How this mailbox authenticates to IMAP/SMTP (`config.json` `imapAuth`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MailboxImapAuthKind {
    /// App password or legacy IMAP password in `.env`.
    #[default]
    AppPassword,
    /// Google OAuth (refresh token in `google-oauth.json`).
    GoogleOAuth,
}

impl MailboxImapAuthKind {
    pub fn from_json(s: Option<&str>) -> Self {
        match s.map(str::trim) {
            Some("googleOAuth") => Self::GoogleOAuth,
            _ => Self::AppPassword,
        }
    }
}

/// One mailbox entry in multi-inbox `config.json` ([OPP-016](../docs/opportunities/archive/OPP-016-multi-inbox.md)).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxConfigJson {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub imap: Option<ImapJson>,
    /// When `"googleOAuth"`, use Google token store instead of `RIPMAIL_IMAP_PASSWORD`.
    #[serde(default)]
    pub imap_auth: Option<String>,
    #[serde(default)]
    pub search: Option<MailboxSearchJson>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<MailboxIdentityJson>,
    /// `"imap"` (default) or `"applemail"` — local Apple Mail Envelope Index only.
    #[serde(default)]
    pub mailbox_type: Option<String>,
    /// Root `~/Library/Mail/V10` (or similar). When omitted, first discovered `V*` under `~/Library/Mail`.
    #[serde(default)]
    pub apple_mail_path: Option<String>,
}

/// Fully resolved mailbox (IMAP + paths + secrets) for sync and CLI.
#[derive(Debug, Clone)]
pub struct ResolvedMailbox {
    pub id: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_user: String,
    pub imap_aliases: Vec<String>,
    pub imap_password: String,
    pub imap_auth: MailboxImapAuthKind,
    /// Default search / inbox scan includes this mailbox when `true` (default).
    pub include_in_default: bool,
    pub maildir_path: PathBuf,
    /// When set, this mailbox is indexed from Apple Mail’s local store (no IMAP).
    pub apple_mail_root: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapJson {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub aliases: Option<Vec<String>>,
    #[serde(default)]
    pub imap_auth: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtpJson {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub secure: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncJson {
    pub default_since: Option<String>,
    pub mailbox: Option<String>,
    pub exclude_labels: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentsJson {
    pub cache_extracted_text: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxJson {
    pub default_window: Option<String>,
    /// Rolling window (e.g. `1d`): messages older than this are bulk-archived after `rebuild-index` bootstrap.
    pub bootstrap_archive_older_than: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxManagementJson {
    pub enabled: Option<bool>,
    pub allow: Option<Vec<String>>,
}

/// Optional `llm` block in `config.json` ([OPP-046](../docs/opportunities/archive/OPP-046-llm-provider-flexibility.md)).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmJson {
    /// `"openai"` | `"anthropic"` | `"ollama"`. Default: OpenAI when absent.
    pub provider: Option<String>,
    /// Base URL for OpenAI-compatible `/v1` API (required for Ollama unless using the default localhost port).
    pub base_url: Option<String>,
    /// Cheaper / faster model: `ripmail ask` investigation loop (tool calls).
    pub fast_model: Option<String>,
    /// Higher-quality model: `ripmail ask` final answer and draft LLM compose/edit.
    pub default_model: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlmProvider {
    OpenAi,
    Anthropic,
    Ollama,
}

/// Resolved LLM settings for `ripmail ask` and draft compose ([OPP-046](../docs/opportunities/archive/OPP-046-llm-provider-flexibility.md)).
#[derive(Debug, Clone)]
pub struct ResolvedLlm {
    pub provider: LlmProvider,
    pub base_url: String,
    /// Fast path (e.g. `ripmail ask` investigation).
    pub fast_model: String,
    /// Default quality path (e.g. `ripmail ask` synthesis, `draft` LLM).
    pub default_model: String,
    /// For OpenAI/Anthropic: real API key. For **Ollama**, a placeholder only (`"ollama"` unless
    /// `RIPMAIL_OLLAMA_API_KEY` is set); local Ollama does not require you to configure a key.
    pub api_key: String,
}

fn parse_llm_provider(s: &str) -> Option<LlmProvider> {
    match s.trim().to_ascii_lowercase().as_str() {
        "openai" => Some(LlmProvider::OpenAi),
        "anthropic" => Some(LlmProvider::Anthropic),
        "ollama" => Some(LlmProvider::Ollama),
        _ => None,
    }
}

fn default_llm_base_url(provider: LlmProvider) -> &'static str {
    match provider {
        LlmProvider::OpenAi => "https://api.openai.com/v1",
        LlmProvider::Anthropic => "https://api.anthropic.com/v1",
        LlmProvider::Ollama => "http://localhost:11434/v1",
    }
}

fn default_fast_model(provider: LlmProvider) -> &'static str {
    match provider {
        LlmProvider::OpenAi => "gpt-4.1-nano",
        LlmProvider::Anthropic => "claude-haiku-4-5-20251001",
        LlmProvider::Ollama => "",
    }
}

fn default_default_model(provider: LlmProvider) -> &'static str {
    match provider {
        LlmProvider::OpenAi => "gpt-4.1-mini",
        LlmProvider::Anthropic => "claude-sonnet-4-6",
        LlmProvider::Ollama => "",
    }
}

/// Build an OpenAI-compatible HTTP client (OpenAI, Anthropic compat, Ollama, etc.).
pub fn build_llm_client(resolved: &ResolvedLlm) -> Client<OpenAIConfig> {
    Client::with_config(
        OpenAIConfig::new()
            .with_api_key(&resolved.api_key)
            .with_api_base(&resolved.base_url),
    )
}

/// Resolve LLM settings from `config.json` and env (`RIPMAIL_HOME`, merged `.env`).
pub fn resolve_llm(opts: &LoadConfigOptions) -> Result<ResolvedLlm, String> {
    let home = ripmail_home(opts.home.clone());
    let json = load_config_json(&home);
    let env_file = read_ripmail_env_file(&home);
    let process_env: HashMap<String, String> = opts
        .env
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    resolve_llm_with_env(&json, &env_file, &process_env)
}

/// Resolve LLM settings for tests and tooling (explicit env maps).
pub fn resolve_llm_with_env(
    json: &ConfigJson,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<ResolvedLlm, String> {
    let llm = json.llm.as_ref();

    let provider_str = llm
        .and_then(|l| l.provider.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            effective_env("RIPMAIL_LLM_PROVIDER", env_file, process_env)
                .filter(|s| !s.trim().is_empty())
        });

    let provider = provider_str
        .as_deref()
        .and_then(parse_llm_provider)
        .unwrap_or(LlmProvider::OpenAi);

    let default_base = default_llm_base_url(provider);
    let base_url = llm
        .and_then(|l| l.base_url.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_end_matches('/').to_string())
        .unwrap_or_else(|| default_base.trim_end_matches('/').to_string());

    let (fast_model, default_model) = match provider {
        LlmProvider::Ollama => {
            let lj = llm.ok_or_else(|| {
                "Add an \"llm\" object to config.json with fastModel and/or defaultModel (and baseUrl optional; defaults to http://localhost:11434/v1) when using Ollama."
                    .to_string()
            })?;
            let fast = lj
                .fast_model
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let def = lj
                .default_model
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            match (fast, def) {
                (Some(f), Some(d)) => (f, d),
                (Some(f), None) => {
                    let f2 = f.clone();
                    (f, f2)
                }
                (None, Some(d)) => {
                    let d2 = d.clone();
                    (d, d2)
                }
                (None, None) => {
                    return Err(
                        "llm.fastModel and llm.defaultModel: set at least one when provider is ollama (the other defaults to the same value)."
                            .to_string(),
                    );
                }
            }
        }
        LlmProvider::OpenAi | LlmProvider::Anthropic => {
            let fast = llm
                .and_then(|l| l.fast_model.as_ref())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| default_fast_model(provider).to_string());
            let default_m = llm
                .and_then(|l| l.default_model.as_ref())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| default_default_model(provider).to_string());
            (fast, default_m)
        }
    };

    let api_key = match provider {
        LlmProvider::OpenAi => effective_env("RIPMAIL_OPENAI_API_KEY", env_file, process_env)
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                effective_env("OPENAI_API_KEY", env_file, process_env)
                    .filter(|s| !s.trim().is_empty())
            })
            .ok_or_else(|| {
                "Set RIPMAIL_OPENAI_API_KEY or OPENAI_API_KEY for OpenAI, or set llm.provider to anthropic or ollama in config.json."
                    .to_string()
            })?,
        LlmProvider::Anthropic => effective_env("RIPMAIL_ANTHROPIC_API_KEY", env_file, process_env)
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                effective_env("ANTHROPIC_API_KEY", env_file, process_env)
                    .filter(|s| !s.trim().is_empty())
            })
            .ok_or_else(|| {
                "Set RIPMAIL_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY for Anthropic.".to_string()
            })?,
        LlmProvider::Ollama => effective_env("RIPMAIL_OLLAMA_API_KEY", env_file, process_env)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "ollama".to_string()),
    };

    Ok(ResolvedLlm {
        provider,
        base_url,
        fast_model,
        default_model,
        api_key,
    })
}

#[derive(Debug, Clone)]
pub struct ResolvedSmtp {
    pub host: String,
    pub port: u16,
    pub secure: bool,
}

/// Infer SMTP from IMAP host (see `src/send/smtp-resolve.ts`).
pub fn resolve_smtp_settings(
    imap_host: &str,
    overrides: Option<&SmtpJson>,
) -> Result<ResolvedSmtp, String> {
    let h = imap_host.trim().to_lowercase();
    let o = overrides;
    // Apple Mail–only mailbox: no outbound SMTP until the user sets `smtp` in config.json.
    if h == "local.applemail" {
        return Ok(ResolvedSmtp {
            host: o
                .and_then(|x| x.host.clone())
                .unwrap_or_else(|| "localhost".into()),
            port: o.and_then(|x| x.port).unwrap_or(587),
            secure: o.and_then(|x| x.secure).unwrap_or(false),
        });
    }
    let base: Option<ResolvedSmtp> = if h == "imap.gmail.com" {
        Some(ResolvedSmtp {
            host: "smtp.gmail.com".into(),
            port: 587,
            secure: false,
        })
    } else {
        h.strip_prefix("imap.").map(|rest| ResolvedSmtp {
            host: format!("smtp.{rest}"),
            port: 587,
            secure: false,
        })
    };

    let base = match base {
        Some(b) => b,
        None => {
            if let Some(s) = o {
                if let (Some(host), Some(port), Some(secure)) = (&s.host, s.port, s.secure) {
                    return Ok(ResolvedSmtp {
                        host: host.clone(),
                        port,
                        secure,
                    });
                }
            }
            return Err(format!(
                "Cannot infer SMTP settings for IMAP host \"{imap_host}\". Set smtp.host, smtp.port, and smtp.secure in config.json."
            ));
        }
    };

    Ok(ResolvedSmtp {
        host: o.and_then(|x| x.host.clone()).unwrap_or(base.host),
        port: o.and_then(|x| x.port).unwrap_or(base.port),
        secure: o.and_then(|x| x.secure).unwrap_or(base.secure),
    })
}

/// Parse a single `.env` file path with the same whitelist as ripmail home `.env`.
fn load_env_file_at_path(path: &Path) -> HashMap<String, String> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim();
            if matches!(
                key,
                "RIPMAIL_EMAIL"
                    | "RIPMAIL_IMAP_PASSWORD"
                    | "RIPMAIL_OPENAI_API_KEY"
                    | "OPENAI_API_KEY"
                    | "RIPMAIL_ANTHROPIC_API_KEY"
                    | "ANTHROPIC_API_KEY"
                    | "RIPMAIL_OLLAMA_API_KEY"
                    | "RIPMAIL_LLM_PROVIDER"
                    | "RIPMAIL_OAUTH_RELAY_BASE"
                    | "RIPMAIL_GOOGLE_REFRESH_TOKEN"
            ) || key.starts_with("RIPMAIL_GOOGLE_OAUTH_")
            {
                map.insert(key.to_string(), v.to_string());
            }
        }
    }
    map
}

fn load_env_file(home: &Path) -> HashMap<String, String> {
    load_env_file_at_path(&home.join(".env"))
}

/// `{project}/.env` next to the crate root (`Cargo.toml`) — local dev secrets; not used on end-user installs when the path does not exist.
pub fn read_project_repo_dotenv() -> HashMap<String, String> {
    load_env_file_at_path(&Path::new(env!("CARGO_MANIFEST_DIR")).join(".env"))
}

/// Only `RIPMAIL_HOME/.env` (no merge with project). For diagnostics vs merged [`read_ripmail_env_file`].
pub(crate) fn read_ripmail_home_dotenv_only(home: &Path) -> HashMap<String, String> {
    load_env_file(home)
}

/// Merged env: `~/.ripmail/.env` then **overlay** [`read_project_repo_dotenv`] so repo `.env` wins for local dev.
///
/// Empty values from the repo file are **skipped** so a placeholder `RIPMAIL_IMAP_PASSWORD=` in a git clone
/// does not wipe secrets from `~/.ripmail/.env` (a common cause of "setup works but `cargo run` send fails").
pub fn read_ripmail_env_file(home: &Path) -> HashMap<String, String> {
    let mut m = load_env_file(home);
    for (k, v) in read_project_repo_dotenv() {
        if v.trim().is_empty() {
            continue;
        }
        m.insert(k, v);
    }
    m
}

/// Read `config.json` from `~/.ripmail` (or `RIPMAIL_HOME`). Returns default when missing or invalid.
pub fn load_config_json(home: &Path) -> ConfigJson {
    let path = home.join("config.json");
    let Ok(content) = std::fs::read_to_string(&path) else {
        return ConfigJson::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

/// Write `config.json` (pretty-printed JSON).
pub fn write_config_json(home: &Path, cfg: &ConfigJson) -> std::io::Result<()> {
    fs::create_dir_all(home)?;
    fs::write(
        home.join("config.json"),
        serde_json::to_string_pretty(cfg)? + "\n",
    )
}

/// Resolve which mailbox `--id` / `--email` refers to for `ripmail config`.
pub fn resolve_config_target_mailbox_id(
    home: &Path,
    id: Option<&str>,
    email: Option<&str>,
) -> Result<String, String> {
    let cfg = load_config_json(home);
    let mbs = cfg
        .mailboxes
        .as_ref()
        .filter(|m| !m.is_empty())
        .ok_or_else(|| {
            "No mailboxes in config.json. Run `ripmail setup` or `ripmail wizard` first."
                .to_string()
        })?;
    if let Some(id) = id.map(str::trim).filter(|s| !s.is_empty()) {
        if mbs.iter().any(|m| m.id == id) {
            return Ok(id.to_string());
        }
        return Err(format!("Unknown mailbox id: {id}"));
    }
    if let Some(em) = email.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(mb) = mbs.iter().find(|m| m.email.eq_ignore_ascii_case(em)) {
            return Ok(mb.id.clone());
        }
        return Err(format!("No mailbox with email: {em}"));
    }
    if mbs.len() == 1 {
        return Ok(mbs[0].id.clone());
    }
    Err(
        "Multiple mailboxes: pass `--id <mailbox-id>` or `--email <addr>` to choose one."
            .to_string(),
    )
}

/// Find one mailbox entry by id (multi-inbox `mailboxes[]`).
pub fn mailbox_config_by_id(home: &Path, mailbox_id: &str) -> Option<MailboxConfigJson> {
    let cfg = load_config_json(home);
    cfg.mailboxes?.into_iter().find(|m| m.id == mailbox_id)
}

/// Resolve the active signature body for LLM compose / display (uses `signatureId` or `default`).
pub fn resolved_signature_body(identity: &MailboxIdentityJson) -> Option<String> {
    let sigs = identity.signatures.as_ref()?;
    if sigs.is_empty() {
        return None;
    }
    let key = identity
        .signature_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("default");
    sigs.get(key)
        .cloned()
        .or_else(|| sigs.get("default").cloned())
}

/// Context for draft LLM: outbound identity from config (no LLM placeholders).
#[derive(Debug, Clone, Default)]
pub struct DraftComposeIdentity {
    pub mailbox_email: String,
    pub preferred_name: Option<String>,
    pub full_name: Option<String>,
    pub signature_body: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct IdentityPatch {
    pub preferred_name: Option<String>,
    pub full_name: Option<String>,
    /// Sets `signatures["default"]` and may set `signature_id` to `default`.
    pub signature: Option<String>,
    pub signature_id: Option<String>,
}

fn trim_opt(s: Option<&String>) -> Option<String> {
    s.and_then(|x| {
        let t = x.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

/// Field-level merge of identity patch into existing `MailboxIdentityJson`.
pub fn merge_mailbox_identity(
    existing: Option<MailboxIdentityJson>,
    patch: &IdentityPatch,
) -> Option<MailboxIdentityJson> {
    let has_patch = patch.preferred_name.is_some()
        || patch.full_name.is_some()
        || patch.signature.is_some()
        || patch.signature_id.is_some();
    if !has_patch {
        return existing;
    }
    let mut out = existing.unwrap_or_default();
    if let Some(ref s) = patch.preferred_name {
        let t = s.trim();
        if t.is_empty() {
            out.preferred_name = None;
        } else {
            out.preferred_name = Some(t.to_string());
        }
    }
    if let Some(ref s) = patch.full_name {
        let t = s.trim();
        if t.is_empty() {
            out.full_name = None;
        } else {
            out.full_name = Some(t.to_string());
        }
    }
    if let Some(ref sig) = patch.signature {
        let t = sig.trim();
        let mut map = out.signatures.unwrap_or_default();
        let key = patch
            .signature_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "default".to_string());
        if t.is_empty() {
            map.remove(&key);
            if key == "default" {
                map.remove("default");
            }
            if map.is_empty() {
                out.signatures = None;
            } else {
                out.signatures = Some(map);
            }
        } else {
            map.insert(key.clone(), t.to_string());
            out.signatures = Some(map);
            out.signature_id = Some(key);
        }
    } else if let Some(ref sid) = patch.signature_id {
        let t = sid.trim();
        if t.is_empty() {
            out.signature_id = None;
        } else {
            out.signature_id = Some(t.to_string());
        }
    }
    if out.preferred_name.is_none()
        && out.full_name.is_none()
        && out.signature_id.is_none()
        && out
            .signatures
            .as_ref()
            .map(|m| m.is_empty())
            .unwrap_or(true)
    {
        None
    } else {
        Some(out)
    }
}

/// Build [`DraftComposeIdentity`] from a mailbox row and optional explicit mailbox id override.
/// Returns `None` when no mailbox matches; identity fields are `None` when `mailboxes[].identity` is absent.
pub fn draft_compose_identity_for_mailbox(
    home: &Path,
    resolved_mailboxes: &[ResolvedMailbox],
    mailbox_spec: Option<&str>,
) -> Option<DraftComposeIdentity> {
    let spec = mailbox_spec.map(str::trim).filter(|s| !s.is_empty());
    let mb = if let Some(s) = spec {
        resolve_mailbox_spec(resolved_mailboxes, s)?
    } else {
        resolved_mailboxes.first()?
    };
    let row = mailbox_config_by_id(home, &mb.id)?;
    let id = row.identity.as_ref();
    Some(DraftComposeIdentity {
        mailbox_email: mb.email.clone(),
        preferred_name: id.and_then(|i| trim_opt(i.preferred_name.as_ref())),
        full_name: id.and_then(|i| trim_opt(i.full_name.as_ref())),
        signature_body: id.and_then(resolved_signature_body),
    })
}

/// Stable directory name for a mailbox (`@` → `_`, `.` → `_`, lowercased). See [OPP-016](../docs/opportunities/archive/OPP-016-multi-inbox.md).
pub fn derive_mailbox_id_from_email(email: &str) -> String {
    let lower = email.trim().to_lowercase();
    lower
        .chars()
        .map(|c| match c {
            '@' => '_',
            '.' => '_',
            _ => c,
        })
        .collect()
}

/// Resolved configuration (pure: no global env mutation).
#[derive(Debug, Clone)]
pub struct Config {
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_user: String,
    pub imap_aliases: Vec<String>,
    pub imap_password: String,
    pub imap_auth: MailboxImapAuthKind,
    pub smtp: ResolvedSmtp,
    pub sync_default_since: String,
    pub sync_mailbox: String,
    pub sync_exclude_labels: Vec<String>,
    pub attachments_cache_extracted_text: bool,
    pub inbox_default_window: String,
    pub inbox_bootstrap_archive_older_than: String,
    pub mailbox_management_enabled: bool,
    pub mailbox_management_allow_archive: bool,
    /// `RIPMAIL_HOME` — drafts live under [`Self::data_dir`] (`<home>/data/`); message `raw_path` in
    /// SQLite is relative to [`Self::message_path_root`].
    pub ripmail_home: PathBuf,
    /// Shared non-maildir data: `drafts/`, `sent/`, etc.
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub maildir_path: PathBuf,
    /// Base path for resolving `messages.raw_path` / attachment `stored_path` (legacy: same as
    /// `data_dir`; multi-inbox: `RIPMAIL_HOME` with paths like `<mailbox_id>/maildir/...`).
    pub message_path_root: PathBuf,
    /// Primary mailbox id (first entry in `mailboxes` or derived from legacy IMAP user).
    pub mailbox_id: String,
    /// All configured mailboxes (for multi-account refresh, search scope, status).
    pub resolved_mailboxes: Vec<ResolvedMailbox>,
}

impl Config {
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn maildir_path(&self) -> &Path {
        &self.maildir_path
    }

    pub fn message_path_root(&self) -> &Path {
        &self.message_path_root
    }
}

pub struct LoadConfigOptions {
    pub home: Option<PathBuf>,
    /// If None, reads `std::env::vars()` into a map for known keys only.
    pub env: Option<HashMap<String, String>>,
}

fn ripmail_home(explicit: Option<PathBuf>) -> PathBuf {
    explicit.unwrap_or_else(|| {
        std::env::var("RIPMAIL_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".ripmail")
            })
    })
}

/// If `RIPMAIL_HOME` is unset, `~/.zmail` contains `config.json`, and `~/.ripmail` is missing, or
/// exists but is empty and has no `config.json`, rename `~/.zmail` → `~/.ripmail` (one-time migration
/// from the pre-rename default).
///
/// Called once at the start of every CLI invocation ([`crate::cli::commands::handle_command`]) so
/// bare `ripmail` and all subcommands resolve the same home path.
pub fn migrate_legacy_zmail_home_dir_if_needed() -> std::io::Result<()> {
    if std::env::var("RIPMAIL_HOME").is_ok() {
        return Ok(());
    }
    let Some(user_home) = dirs::home_dir() else {
        return Ok(());
    };
    migrate_legacy_zmail_home_dir_impl(user_home.as_path())
}

fn migrate_legacy_zmail_home_dir_impl(user_home: &Path) -> std::io::Result<()> {
    let legacy = user_home.join(".zmail");
    if !legacy.is_dir() || !legacy.join("config.json").is_file() {
        return Ok(());
    }
    let new_home = user_home.join(".ripmail");
    if new_home.exists() {
        if new_home.join("config.json").is_file() {
            return Ok(());
        }
        if is_empty_dir(&new_home)? {
            fs::remove_dir(&new_home)?;
        } else {
            return Ok(());
        }
    }
    fs::rename(&legacy, &new_home)?;
    eprintln!(
        "ripmail: renamed {} → {} (old default config directory).",
        legacy.display(),
        new_home.display()
    );
    Ok(())
}

fn is_empty_dir(path: &Path) -> std::io::Result<bool> {
    let mut it = fs::read_dir(path)?;
    Ok(it.next().is_none())
}

fn effective_env(
    key: &str,
    env_file: &HashMap<String, String>,
    process: &HashMap<String, String>,
) -> Option<String> {
    process
        .get(key)
        .cloned()
        .or_else(|| env_file.get(key).cloned())
}

/// Ids of mailboxes included in default search / inbox when no `--mailbox` is given.
pub fn mailbox_ids_for_default_search(mailboxes: &[ResolvedMailbox]) -> Vec<String> {
    mailboxes
        .iter()
        .filter(|m| m.include_in_default)
        .map(|m| m.id.clone())
        .collect()
}

/// Build a [`Config`] for outbound SMTP using the given mailbox (email or id), or the default
/// (first resolved mailbox) when `mailbox_spec` is `None` or empty.
pub fn config_for_outbound_send(
    cfg: &Config,
    mailbox_spec: Option<&str>,
) -> Result<Config, String> {
    let spec = mailbox_spec.map(str::trim).filter(|s| !s.is_empty());
    let Some(spec) = spec else {
        return Ok(cfg.clone());
    };
    let mb = resolve_mailbox_spec(&cfg.resolved_mailboxes, spec)
        .ok_or_else(|| format!("Unknown mailbox: {spec}"))?;
    let json = load_config_json(&cfg.ripmail_home);
    let mut out = cfg.clone();
    out.imap_host = mb.imap_host.clone();
    out.imap_port = mb.imap_port;
    out.imap_user = mb.imap_user.clone();
    out.imap_aliases = mb.imap_aliases.clone();
    out.imap_password = mb.imap_password.clone();
    out.imap_auth = mb.imap_auth;
    out.maildir_path = mb.maildir_path.clone();
    out.mailbox_id = mb.id.clone();
    out.smtp = resolve_smtp_settings(&out.imap_host, json.smtp.as_ref())?;
    Ok(out)
}

/// Resolve `--mailbox <email|id>` to a configured mailbox.
pub fn resolve_mailbox_spec<'a>(
    mailboxes: &'a [ResolvedMailbox],
    spec: &str,
) -> Option<&'a ResolvedMailbox> {
    let s = spec.trim();
    if s.is_empty() {
        return None;
    }
    mailboxes
        .iter()
        .find(|m| m.id == s || m.email.eq_ignore_ascii_case(s))
}

fn expand_tilde_path(s: &str) -> PathBuf {
    if let Some(rest) = s.trim().strip_prefix("~/") {
        return dirs::home_dir()
            .map(|h| h.join(rest))
            .unwrap_or_else(|| PathBuf::from(s));
    }
    PathBuf::from(s)
}

fn build_resolved_mailboxes(
    json: &ConfigJson,
    home: &Path,
    data_dir: &Path,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Vec<ResolvedMailbox> {
    let multi = json
        .mailboxes
        .as_ref()
        .map(|m| !m.is_empty())
        .unwrap_or(false);

    if multi {
        let mut out = Vec::new();
        for mb in json.mailboxes.as_ref().unwrap() {
            let mailbox_type = mb.mailbox_type.as_deref().unwrap_or("imap");
            if mailbox_type.eq_ignore_ascii_case("applemail") {
                let apple_root = mb
                    .apple_mail_path
                    .as_deref()
                    .map(expand_tilde_path)
                    .or_else(|| {
                        dirs::home_dir()
                            .and_then(|h| crate::applemail::default_mail_library_root(&h))
                    });
                let Some(apple_root) = apple_root else {
                    // No `~/Library/Mail/V*` (non-macOS or missing Mail data).
                    continue;
                };
                let include_in_default = mb
                    .search
                    .as_ref()
                    .and_then(|s| s.include_in_default)
                    .unwrap_or(true);
                let imap_aliases = mb
                    .imap
                    .as_ref()
                    .and_then(|i| i.aliases.clone())
                    .unwrap_or_default();
                out.push(ResolvedMailbox {
                    id: mb.id.clone(),
                    email: mb.email.trim().to_string(),
                    imap_host: "local.applemail".into(),
                    imap_port: 993,
                    imap_user: mb.email.trim().to_string(),
                    imap_aliases,
                    // Placeholder non-empty so first-backfill detection works without IMAP secrets.
                    imap_password: "applemail-placeholder".into(),
                    imap_auth: MailboxImapAuthKind::AppPassword,
                    include_in_default,
                    maildir_path: home.join(&mb.id).join("maildir"),
                    apple_mail_root: Some(apple_root),
                });
                continue;
            }
            let mb_env = load_env_file(&home.join(&mb.id));
            let imap_host = mb
                .imap
                .as_ref()
                .and_then(|i| i.host.clone())
                .unwrap_or_else(|| "imap.gmail.com".into());
            let imap_port = mb.imap.as_ref().and_then(|i| i.port).unwrap_or(993);
            let mut imap_user = mb.email.trim().to_string();
            if imap_user.is_empty() {
                imap_user = mb
                    .imap
                    .as_ref()
                    .and_then(|i| i.user.clone())
                    .or_else(|| effective_env("RIPMAIL_EMAIL", env_file, process_env))
                    .unwrap_or_default();
            }
            let imap_aliases = mb
                .imap
                .as_ref()
                .and_then(|i| i.aliases.clone())
                .unwrap_or_default();
            // Only the mailbox-level `imapAuth` selects OAuth; ignore nested `imap.imapAuth` so a stray
            // `"googleOAuth"` under `imap` cannot override app-password setups.
            let imap_auth = MailboxImapAuthKind::from_json(mb.imap_auth.as_deref());
            let imap_password = if imap_auth == MailboxImapAuthKind::GoogleOAuth {
                String::new()
            } else {
                effective_env("RIPMAIL_IMAP_PASSWORD", &mb_env, process_env)
                    .or_else(|| effective_env("RIPMAIL_IMAP_PASSWORD", env_file, process_env))
                    .unwrap_or_default()
            };
            let include_in_default = mb
                .search
                .as_ref()
                .and_then(|s| s.include_in_default)
                .unwrap_or(true);
            out.push(ResolvedMailbox {
                id: mb.id.clone(),
                email: mb.email.trim().to_string(),
                imap_host,
                imap_port,
                imap_user,
                imap_aliases,
                imap_password,
                imap_auth,
                include_in_default,
                maildir_path: home.join(&mb.id).join("maildir"),
                apple_mail_root: None,
            });
        }
        return out;
    }

    let imap_host = json
        .imap
        .as_ref()
        .and_then(|i| i.host.clone())
        .unwrap_or_else(|| "imap.gmail.com".into());
    let imap_port = json.imap.as_ref().and_then(|i| i.port).unwrap_or(993);
    let imap_user = json
        .imap
        .as_ref()
        .and_then(|i| i.user.clone())
        .or_else(|| effective_env("RIPMAIL_EMAIL", env_file, process_env))
        .unwrap_or_default();
    let imap_aliases = json
        .imap
        .as_ref()
        .and_then(|i| i.aliases.clone())
        .unwrap_or_default();
    let imap_auth =
        MailboxImapAuthKind::from_json(json.imap.as_ref().and_then(|i| i.imap_auth.as_deref()));
    let imap_password = if imap_auth == MailboxImapAuthKind::GoogleOAuth {
        String::new()
    } else {
        effective_env("RIPMAIL_IMAP_PASSWORD", env_file, process_env).unwrap_or_default()
    };
    let id = if imap_user.trim().is_empty() {
        String::new()
    } else {
        derive_mailbox_id_from_email(&imap_user)
    };
    vec![ResolvedMailbox {
        id,
        email: imap_user.clone(),
        imap_host,
        imap_port,
        imap_user,
        imap_aliases,
        imap_password,
        imap_auth,
        include_in_default: true,
        maildir_path: data_dir.join("maildir"),
        apple_mail_root: None,
    }]
}

/// Enumerate configured mailboxes with credentials (for tests and multi-account tooling).
pub fn load_all_mailboxes(opts: &LoadConfigOptions) -> Vec<ResolvedMailbox> {
    let home = ripmail_home(opts.home.clone());
    crate::layout_migrate::migrate_legacy_layout_if_needed(&home);
    crate::layout_migrate::migrate_deferred_legacy_data_if_needed(&home);
    let env_file = read_ripmail_env_file(&home);
    let json = load_config_json(&home);
    let process_env: HashMap<String, String> = opts
        .env
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    let data_dir = home.join("data");
    build_resolved_mailboxes(&json, &home, &data_dir, &env_file, &process_env)
}

/// Load config like TS `loadConfig(options?)`.
pub fn load_config(opts: LoadConfigOptions) -> Config {
    let home = ripmail_home(opts.home.clone());
    crate::layout_migrate::migrate_legacy_layout_if_needed(&home);
    crate::layout_migrate::migrate_deferred_legacy_data_if_needed(&home);

    let env_file = read_ripmail_env_file(&home);
    let json = load_config_json(&home);

    let process_env: HashMap<String, String> =
        opts.env.unwrap_or_else(|| std::env::vars().collect());

    let data_dir = home.join("data");
    let resolved_mailboxes =
        build_resolved_mailboxes(&json, &home, &data_dir, &env_file, &process_env);

    let multi = json
        .mailboxes
        .as_ref()
        .map(|m| !m.is_empty())
        .unwrap_or(false);

    let (
        imap_host,
        imap_port,
        imap_user,
        imap_aliases,
        imap_password,
        imap_auth,
        db_path,
        maildir_path,
        message_path_root,
    ) = if multi {
        let mb = resolved_mailboxes.first().expect("mailboxes non-empty");
        (
            mb.imap_host.clone(),
            mb.imap_port,
            mb.imap_user.clone(),
            mb.imap_aliases.clone(),
            mb.imap_password.clone(),
            mb.imap_auth,
            home.join("ripmail.db"),
            mb.maildir_path.clone(),
            home.clone(),
        )
    } else {
        let mb = resolved_mailboxes.first();
        let imap_host = mb
            .map(|m| m.imap_host.clone())
            .unwrap_or_else(|| "imap.gmail.com".into());
        let imap_port = mb.map(|m| m.imap_port).unwrap_or(993);
        let imap_user = mb.map(|m| m.imap_user.clone()).unwrap_or_default();
        let imap_aliases = mb.map(|m| m.imap_aliases.clone()).unwrap_or_default();
        let imap_password = mb.map(|m| m.imap_password.clone()).unwrap_or_default();
        let imap_auth = mb.map(|m| m.imap_auth).unwrap_or_default();
        (
            imap_host,
            imap_port,
            imap_user,
            imap_aliases,
            imap_password,
            imap_auth,
            data_dir.join("ripmail.db"),
            data_dir.join("maildir"),
            data_dir.clone(),
        )
    };

    let mailbox_id = resolved_mailboxes
        .first()
        .map(|m| m.id.clone())
        .unwrap_or_default();

    let smtp = resolve_smtp_settings(&imap_host, json.smtp.as_ref())
        .expect("SMTP resolution: default imap.gmail.com always resolves");

    let mailbox_mgmt = json.mailbox_management.as_ref();
    let mailbox_management_enabled = mailbox_mgmt.and_then(|m| m.enabled).unwrap_or(false);
    let allow_list = mailbox_mgmt.and_then(|m| m.allow.as_ref());
    let mailbox_management_allow_archive = mailbox_management_enabled
        && allow_list
            .map(|a| a.iter().any(|s| s.eq_ignore_ascii_case("archive")))
            .unwrap_or(true);

    Config {
        imap_host,
        imap_port,
        imap_user,
        imap_aliases,
        imap_password,
        imap_auth,
        smtp,
        sync_default_since: json
            .sync
            .as_ref()
            .and_then(|s| s.default_since.clone())
            .unwrap_or_else(|| "1y".into()),
        sync_mailbox: json
            .sync
            .as_ref()
            .and_then(|s| s.mailbox.clone())
            .unwrap_or_default(),
        sync_exclude_labels: json
            .sync
            .as_ref()
            .and_then(|s| s.exclude_labels.clone())
            .unwrap_or_else(|| vec!["trash".into(), "spam".into()]),
        attachments_cache_extracted_text: json
            .attachments
            .as_ref()
            .and_then(|a| a.cache_extracted_text)
            .unwrap_or(false),
        inbox_default_window: json
            .inbox
            .as_ref()
            .and_then(|i| i.default_window.clone())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "24h".into()),
        inbox_bootstrap_archive_older_than: json
            .inbox
            .as_ref()
            .and_then(|i| i.bootstrap_archive_older_than.clone())
            .unwrap_or_else(|| "1d".into()),
        mailbox_management_enabled,
        mailbox_management_allow_archive,
        ripmail_home: home,
        data_dir,
        db_path,
        maildir_path,
        message_path_root,
        mailbox_id,
        resolved_mailboxes,
    }
}

/// Resolve OpenAI API key from process env, `~/.ripmail/.env`, and repo `{project}/.env` (overlay).
pub fn resolve_openai_api_key(opts: &LoadConfigOptions) -> Option<String> {
    let home = ripmail_home(opts.home.clone());
    let env_file = read_ripmail_env_file(&home);
    let process_env: HashMap<String, String> = opts
        .env
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    effective_env("RIPMAIL_OPENAI_API_KEY", &env_file, &process_env)
        .filter(|s: &String| !s.trim().is_empty())
        .or_else(|| {
            effective_env("OPENAI_API_KEY", &env_file, &process_env)
                .filter(|s: &String| !s.trim().is_empty())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolve_smtp_local_applemail_defaults() {
        let r = resolve_smtp_settings("local.applemail", None).unwrap();
        assert_eq!(r.host, "localhost");
        assert_eq!(r.port, 587);
        assert!(!r.secure);
    }

    #[test]
    fn resolve_smtp_unknown_host_errors() {
        let r = resolve_smtp_settings("mail.example.com", None);
        assert!(r.is_err());
    }

    #[test]
    fn resolve_smtp_override_only_when_complete() {
        let j = SmtpJson {
            host: Some("mx.example.com".into()),
            port: Some(587),
            secure: Some(false),
        };
        let r = resolve_smtp_settings("unknown.imap.com", Some(&j)).unwrap();
        assert_eq!(r.host, "mx.example.com");
    }

    #[test]
    fn config_json_empty_object() {
        let j: ConfigJson = serde_json::from_str("{}").unwrap();
        assert!(j.imap.is_none());
    }

    #[test]
    fn mailbox_config_applemail_deserializes() {
        let raw = r#"{"mailboxes":[{"id":"am1","email":"u@icloud.com","mailboxType":"applemail","appleMailPath":"~/Library/Mail/V10"}]}"#;
        let j: ConfigJson = serde_json::from_str(raw).unwrap();
        let mb = j.mailboxes.as_ref().unwrap().first().unwrap();
        assert_eq!(mb.mailbox_type.as_deref(), Some("applemail"));
        assert_eq!(mb.apple_mail_path.as_deref(), Some("~/Library/Mail/V10"));
    }

    #[test]
    fn config_json_deserialize_nested() {
        let raw = r#"{"imap":{"host":"imap.x","port":993,"user":"u@x.com","aliases":["alias@x.com"]},"inbox":{"defaultWindow":"48h"}}"#;
        let j: ConfigJson = serde_json::from_str(raw).unwrap();
        assert_eq!(j.imap.as_ref().unwrap().host.as_deref(), Some("imap.x"));
        assert_eq!(
            j.imap.as_ref().unwrap().aliases.as_ref().unwrap(),
            &vec!["alias@x.com".to_string()]
        );
        assert_eq!(
            j.inbox.as_ref().unwrap().default_window.as_deref(),
            Some("48h")
        );
    }

    #[test]
    fn migrate_legacy_renames_when_zmail_has_config_json() {
        let tmp = tempfile::tempdir().unwrap();
        let user = tmp.path();
        let legacy = user.join(".zmail");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("config.json"), "{}").unwrap();
        migrate_legacy_zmail_home_dir_impl(user).unwrap();
        assert!(user.join(".ripmail").join("config.json").is_file());
        assert!(!user.join(".zmail").exists());
    }

    #[test]
    fn migrate_legacy_skips_when_ripmail_has_config_json() {
        let tmp = tempfile::tempdir().unwrap();
        let user = tmp.path();
        let rip = user.join(".ripmail");
        fs::create_dir_all(&rip).unwrap();
        fs::write(rip.join("config.json"), "{}").unwrap();
        let legacy = user.join(".zmail");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("config.json"), "{}").unwrap();
        migrate_legacy_zmail_home_dir_impl(user).unwrap();
        assert!(user.join(".zmail").join("config.json").is_file());
        assert!(user.join(".ripmail").join("config.json").is_file());
    }

    #[test]
    fn migrate_legacy_replaces_empty_ripmail_when_zmail_has_config() {
        let tmp = tempfile::tempdir().unwrap();
        let user = tmp.path();
        fs::create_dir_all(user.join(".ripmail")).unwrap();
        let legacy = user.join(".zmail");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("config.json"), r#"{"imap":{"user":"a@b.com"}}"#).unwrap();
        migrate_legacy_zmail_home_dir_impl(user).unwrap();
        assert!(user.join(".ripmail").join("config.json").is_file());
        assert!(!user.join(".zmail").exists());
    }

    #[test]
    fn migrate_legacy_skips_when_zmail_has_no_config() {
        let tmp = tempfile::tempdir().unwrap();
        let user = tmp.path();
        fs::create_dir_all(user.join(".zmail")).unwrap();
        migrate_legacy_zmail_home_dir_impl(user).unwrap();
        assert!(user.join(".zmail").is_dir());
        assert!(!user.join(".ripmail").exists());
    }

    #[test]
    fn resolve_llm_no_llm_defaults_openai_with_key() {
        let json: ConfigJson = serde_json::from_str("{}").unwrap();
        let env_file = HashMap::new();
        let mut process = HashMap::new();
        process.insert("RIPMAIL_OPENAI_API_KEY".into(), "sk-test".into());
        let r = resolve_llm_with_env(&json, &env_file, &process).unwrap();
        assert_eq!(r.provider, LlmProvider::OpenAi);
        assert_eq!(r.base_url, "https://api.openai.com/v1");
        assert_eq!(r.fast_model, "gpt-4.1-nano");
        assert_eq!(r.default_model, "gpt-4.1-mini");
        assert_eq!(r.api_key, "sk-test");
    }

    #[test]
    fn resolve_llm_openai_missing_key_errors() {
        let json: ConfigJson = serde_json::from_str("{}").unwrap();
        let r = resolve_llm_with_env(&json, &HashMap::new(), &HashMap::new());
        assert!(r.is_err());
    }

    #[test]
    fn resolve_llm_ollama_requires_models() {
        let json: ConfigJson = serde_json::from_str(r#"{"llm":{"provider":"ollama"}}"#).unwrap();
        let r = resolve_llm_with_env(&json, &HashMap::new(), &HashMap::new());
        assert!(r.is_err());
    }

    #[test]
    fn resolve_llm_ollama_single_tag_duplicates() {
        let json: ConfigJson =
            serde_json::from_str(r#"{"llm":{"provider":"ollama","fastModel":"qwen2.5:7b"}}"#)
                .unwrap();
        let r = resolve_llm_with_env(&json, &HashMap::new(), &HashMap::new()).unwrap();
        assert_eq!(r.fast_model, "qwen2.5:7b");
        assert_eq!(r.default_model, "qwen2.5:7b");
    }

    #[test]
    fn resolve_llm_anthropic_defaults() {
        let json: ConfigJson = serde_json::from_str(r#"{"llm":{"provider":"anthropic"}}"#).unwrap();
        let mut process = HashMap::new();
        process.insert("RIPMAIL_ANTHROPIC_API_KEY".into(), "sk-ant".into());
        let r = resolve_llm_with_env(&json, &HashMap::new(), &process).unwrap();
        assert_eq!(r.provider, LlmProvider::Anthropic);
        assert_eq!(r.fast_model, "claude-haiku-4-5-20251001");
        assert_eq!(r.default_model, "claude-sonnet-4-6");
        assert_eq!(r.api_key, "sk-ant");
    }

    #[test]
    fn resolve_llm_env_override_to_ollama() {
        let json: ConfigJson =
            serde_json::from_str(r#"{"llm":{"fastModel":"m1","defaultModel":"m2"}}"#).unwrap();
        let mut process = HashMap::new();
        process.insert("RIPMAIL_LLM_PROVIDER".into(), "ollama".into());
        let r = resolve_llm_with_env(&json, &HashMap::new(), &process).unwrap();
        assert_eq!(r.provider, LlmProvider::Ollama);
        assert_eq!(r.fast_model, "m1");
        assert_eq!(r.default_model, "m2");
        assert_eq!(r.api_key, "ollama");
    }

    #[test]
    fn resolve_llm_openai_custom_models() {
        let json: ConfigJson = serde_json::from_str(
            r#"{"llm":{"provider":"openai","fastModel":"gpt-4o-mini","defaultModel":"gpt-4o"}}"#,
        )
        .unwrap();
        let mut process = HashMap::new();
        process.insert("RIPMAIL_OPENAI_API_KEY".into(), "sk".into());
        let r = resolve_llm_with_env(&json, &HashMap::new(), &process).unwrap();
        assert_eq!(r.fast_model, "gpt-4o-mini");
        assert_eq!(r.default_model, "gpt-4o");
    }
}
