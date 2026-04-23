//! Non-interactive `ripmail setup` and shared helpers for `ripmail wizard` / validation.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::config::{
    derive_mailbox_id_from_email, load_config_json, merge_mailbox_identity, write_config_json,
    ConfigJson, IdentityPatch, ImapJson, MailboxConfigJson, MailboxManagementJson, ResolvedMailbox,
    SourceKind, SyncJson,
};
use crate::oauth::{
    fetch_google_account_email, google_oauth_token_path,
    resolve_google_oauth_client_with_diagnostics, resolve_oauth_relay_base,
    run_google_oauth_hosted, run_google_oauth_interactive, save_google_oauth_token_store,
    GoogleOAuthTokenStore, DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_SCOPE_MAIL_CALENDAR_READONLY,
    GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_READONLY,
};
use crate::sync::{connect_imap_for_resolved_mailbox, connect_imap_session};

#[derive(Debug, Clone)]
pub struct SetupArgs {
    pub email: Option<String>,
    pub password: Option<String>,
    pub openai_key: Option<String>,
    /// Stable `mailbox_id` (default: slug from email).
    pub mailbox_id: Option<String>,
    pub imap_host: Option<String>,
    pub imap_port: Option<u16>,
    pub no_validate: bool,
    /// Optional per-mailbox identity merge (same semantics as `ripmail config`).
    pub identity_patch: Option<IdentityPatch>,
}

/// Resolve credential from CLI arg or `process_env` map (RIPMAIL_* keys).
pub fn resolve_setup_email(
    args: &SetupArgs,
    env: &std::collections::HashMap<String, String>,
) -> Option<String> {
    args.email
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| env.get("RIPMAIL_EMAIL").cloned())
        .filter(|s| !s.trim().is_empty())
}

pub fn resolve_setup_password(
    args: &SetupArgs,
    env: &std::collections::HashMap<String, String>,
) -> Option<String> {
    args.password
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| env.get("RIPMAIL_IMAP_PASSWORD").cloned())
        .filter(|s| !s.is_empty())
}

/// Resolved IMAP endpoint from a known email provider (mirrors Node `deriveImapSettings`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedImap {
    pub host: String,
    pub port: u16,
}

/// Derive IMAP host/port from email domain. Returns `None` if unknown (caller prompts host/port).
pub fn derive_imap_settings(email: &str) -> Option<DerivedImap> {
    let domain = email.split('@').nth(1)?.trim().to_lowercase();
    if domain == "gmail.com" {
        Some(DerivedImap {
            host: "imap.gmail.com".into(),
            port: 993,
        })
    } else {
        None
    }
}

/// Partial state from existing `config.json` (wizard defaults).
#[derive(Debug, Default, Clone)]
pub struct ExistingWizardConfig {
    pub email: Option<String>,
    pub imap_host: Option<String>,
    pub imap_port: Option<u16>,
    pub default_since: Option<String>,
    pub mailbox_management_enabled: bool,
}

/// Secrets from existing `$RIPMAIL_HOME/.env` (wizard reuse prompts).
#[derive(Debug, Default, Clone)]
pub struct ExistingEnvSecrets {
    pub password: Option<String>,
    pub api_key: Option<String>,
}

pub fn load_existing_wizard_config(home: &Path) -> ExistingWizardConfig {
    let path = home.join("config.json");
    let Ok(content) = fs::read_to_string(&path) else {
        return ExistingWizardConfig::default();
    };
    let j: ConfigJson = serde_json::from_str(&content).unwrap_or_default();
    let (email, imap_host, imap_port) = if let Some(mb) = j.sources.as_ref().and_then(|m| m.first())
    {
        (
            Some(mb.email.clone()),
            mb.imap.as_ref().and_then(|i| i.host.clone()),
            mb.imap.as_ref().and_then(|i| i.port),
        )
    } else {
        (
            j.imap.as_ref().and_then(|i| i.user.clone()),
            j.imap.as_ref().and_then(|i| i.host.clone()),
            j.imap.as_ref().and_then(|i| i.port),
        )
    };
    ExistingWizardConfig {
        email,
        imap_host,
        imap_port,
        default_since: j.sync.as_ref().and_then(|s| s.default_since.clone()),
        mailbox_management_enabled: j
            .mailbox_management
            .as_ref()
            .and_then(|m| m.enabled)
            .unwrap_or(false),
    }
}

/// Update only `mailboxManagement.enabled`, preserving other config fields and existing `allow`.
pub fn update_mailbox_management(home: &Path, enabled: bool) -> io::Result<()> {
    let mut cfg = load_config_json(home);
    let allow = cfg
        .mailbox_management
        .as_ref()
        .and_then(|m| m.allow.clone());
    cfg.mailbox_management = Some(MailboxManagementJson {
        enabled: Some(enabled),
        allow,
    });
    write_config_json(home, &cfg)?;
    Ok(())
}

/// Merge identity fields for one mailbox (non-destructive; used by `ripmail config`).
pub fn update_mailbox_identity(
    home: &Path,
    mailbox_id: &str,
    patch: &IdentityPatch,
) -> io::Result<()> {
    let mut cfg = load_config_json(home);
    let mut mailboxes = cfg.sources.take().unwrap_or_default();
    let pos = mailboxes
        .iter()
        .position(|m| m.id == mailbox_id)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("mailbox id not found: {mailbox_id}"),
            )
        })?;
    let preserved = mailboxes[pos].identity.clone();
    mailboxes[pos].identity = merge_mailbox_identity(preserved, patch);
    cfg.sources = Some(mailboxes);
    write_config_json(home, &cfg)?;
    Ok(())
}

/// Load secrets from root `$RIPMAIL_HOME/.env` and, for multi-inbox layout, the first mailbox's `.env`.
pub fn load_existing_env_secrets(home: &Path) -> ExistingEnvSecrets {
    let path = home.join(".env");
    let mut s = if let Ok(content) = fs::read_to_string(&path) {
        parse_dotenv_secrets(&content)
    } else {
        ExistingEnvSecrets::default()
    };
    if s.password.is_none() {
        if let Ok(cfg) = fs::read_to_string(home.join("config.json")) {
            if let Ok(j) = serde_json::from_str::<ConfigJson>(&cfg) {
                if let Some(mb) = j.sources.as_ref().and_then(|m| m.first()) {
                    if let Ok(c) = fs::read_to_string(home.join(&mb.id).join(".env")) {
                        let m = parse_dotenv_secrets(&c);
                        s.password = m.password.or(s.password);
                    }
                }
            }
        }
    }
    s
}

/// Parse `RIPMAIL_IMAP_PASSWORD` and `RIPMAIL_OPENAI_API_KEY` from dotenv-style text (for tests).
pub fn parse_dotenv_secrets(content: &str) -> ExistingEnvSecrets {
    let mut password = None;
    let mut api_key = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            match k.trim() {
                "RIPMAIL_IMAP_PASSWORD" => password = Some(v.to_string()),
                "RIPMAIL_OPENAI_API_KEY" | "OPENAI_API_KEY" => api_key = Some(v.to_string()),
                _ => {}
            }
        }
    }
    ExistingEnvSecrets { password, api_key }
}

/// Mask a secret for display (Node `maskSecret`).
pub fn mask_secret(value: &str) -> String {
    if value.len() <= 4 {
        "****".to_string()
    } else {
        format!("{}...", &value[..4])
    }
}

/// Parameters for writing `config.json` + `.env` (Node wizard / non-interactive shape).
pub struct WriteZmailParams<'a> {
    pub home: &'a Path,
    pub email: &'a str,
    pub password: &'a str,
    pub openai_key: Option<&'a str>,
    pub imap_host: &'a str,
    pub imap_port: u16,
    pub default_since: &'a str,
}

/// Merge OpenAI key into root `$RIPMAIL_HOME/.env`, preserving unrelated lines.
pub fn merge_root_openai_key(home: &Path, openai_key: Option<&str>) -> io::Result<()> {
    let Some(openai_key) = openai_key else {
        return Ok(());
    };
    let path = home.join(".env");
    let mut out = String::new();
    if path.exists() {
        for line in fs::read_to_string(&path)?.lines() {
            let t = line.trim();
            if t.is_empty() || t.starts_with('#') {
                out.push_str(line);
                out.push('\n');
                continue;
            }
            if let Some((k, _)) = t.split_once('=') {
                if matches!(k.trim(), "RIPMAIL_OPENAI_API_KEY" | "OPENAI_API_KEY") {
                    continue;
                }
            }
            out.push_str(line);
            out.push('\n');
        }
    }
    if !openai_key.is_empty() {
        out.push_str(&format!("RIPMAIL_OPENAI_API_KEY={openai_key}\n"));
    }
    fs::write(&path, out)?;
    Ok(())
}

/// If `$RIPMAIL_HOME/.env` does not define `RIPMAIL_OAUTH_RELAY_BASE`, append the effective relay URL
/// (bundled default or from env) so the file matches what the binary uses.
pub fn merge_root_oauth_relay_base_if_missing(home: &Path, effective: &str) -> io::Result<()> {
    let path = home.join(".env");
    if path.exists() {
        for line in fs::read_to_string(&path)?.lines() {
            let t = line.trim();
            if t.is_empty() || t.starts_with('#') {
                continue;
            }
            if let Some((k, _)) = t.split_once('=') {
                if k.trim() == "RIPMAIL_OAUTH_RELAY_BASE" {
                    return Ok(());
                }
            }
        }
    }
    fs::create_dir_all(home)?;
    let mut out = if path.exists() {
        let mut s = fs::read_to_string(&path)?;
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s
    } else {
        String::new()
    };
    out.push_str(&format!(
        "# ripmail hosted OAuth relay (override with RIPMAIL_OAUTH_RELAY_BASE)\nRIPMAIL_OAUTH_RELAY_BASE={effective}\n"
    ));
    fs::write(&path, out)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms)?;
    }
    Ok(())
}

/// If `$RIPMAIL_HOME/.env` does not define OAuth client id/secret, append bundled [`DEFAULT_PUBLIC_*`] when both are non-empty.
pub fn merge_root_google_oauth_client_if_missing(home: &Path) -> io::Result<()> {
    let id = DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID.trim();
    let sec = DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_SECRET.trim();
    if id.is_empty() || sec.is_empty() {
        return Ok(());
    }
    let path = home.join(".env");
    let mut has_id = false;
    let mut has_sec = false;
    if path.exists() {
        for line in fs::read_to_string(&path)?.lines() {
            let t = line.trim();
            if t.is_empty() || t.starts_with('#') {
                continue;
            }
            if let Some((k, _)) = t.split_once('=') {
                match k.trim() {
                    "RIPMAIL_GOOGLE_OAUTH_CLIENT_ID" => has_id = true,
                    "RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET" => has_sec = true,
                    _ => {}
                }
            }
        }
    }
    if has_id && has_sec {
        return Ok(());
    }
    fs::create_dir_all(home)?;
    let mut out = if path.exists() {
        let mut s = fs::read_to_string(&path)?;
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s
    } else {
        String::new()
    };
    if !has_id {
        out.push_str(&format!(
            "# ripmail Google OAuth Desktop client (override with env)\nRIPMAIL_GOOGLE_OAUTH_CLIENT_ID={id}\n"
        ));
    }
    if !has_sec {
        out.push_str(&format!("RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET={sec}\n"));
    }
    fs::write(&path, out)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms)?;
    }
    Ok(())
}

/// `true` when there is no configured account yet (no `mailboxes[]` and no legacy `imap.user`).
pub fn wizard_is_first_mailbox_setup(home: &Path) -> bool {
    let cfg = load_config_json(home);
    let has_mailboxes = cfg.sources.as_ref().map(|m| !m.is_empty()).unwrap_or(false);
    if has_mailboxes {
        return false;
    }
    let legacy_user = cfg
        .imap
        .as_ref()
        .and_then(|i| i.user.as_ref())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    legacy_user.is_none()
}

/// Mailboxes for wizard menus: `mailboxes[]` entries, or one synthetic entry from legacy `imap`.
pub fn load_mailbox_configs_for_wizard(home: &Path) -> Vec<MailboxConfigJson> {
    let cfg = load_config_json(home);
    if let Some(m) = cfg.sources.as_ref() {
        if !m.is_empty() {
            return m.clone();
        }
    }
    if let Some(ref imap) = cfg.imap {
        if let Some(ref user) = imap.user {
            if !user.trim().is_empty() {
                let id = derive_mailbox_id_from_email(user);
                return vec![MailboxConfigJson {
                    id,
                    kind: SourceKind::Imap,
                    email: user.clone(),
                    label: None,
                    imap: Some(ImapJson {
                        host: imap.host.clone(),
                        port: imap.port,
                        user: None,
                        aliases: imap.aliases.clone(),
                        imap_auth: imap.imap_auth.clone(),
                    }),
                    imap_auth: None,
                    search: None,
                    identity: None,
                    apple_mail_path: None,
                    path: None,
                    local_dir: None,
                    oauth_source_id: None,
                    calendar_ids: None,
                    default_calendars: None,
                    ics_url: None,
                    drive_folder_id: None,
                }];
            }
        }
    }
    vec![]
}

/// Load `RIPMAIL_IMAP_PASSWORD` for a mailbox: `<id>/.env`, else root `$RIPMAIL_HOME/.env` (legacy).
pub fn load_imap_password_for_mailbox_id(home: &Path, mailbox_id: &str) -> Option<String> {
    let per = home.join(mailbox_id).join(".env");
    if let Ok(content) = fs::read_to_string(&per) {
        let s = parse_dotenv_secrets(&content);
        if s.password.is_some() {
            return s.password;
        }
    }
    if let Ok(content) = fs::read_to_string(home.join(".env")) {
        parse_dotenv_secrets(&content).password
    } else {
        None
    }
}

/// Replace one `MailboxConfigJson` by `id` (preserves list order). Migrates legacy-only config to
/// `mailboxes[]` and clears top-level `imap` when synthesizing from legacy.
pub fn replace_mailbox_entry(home: &Path, entry: MailboxConfigJson) -> io::Result<()> {
    fs::create_dir_all(home)?;
    let mut cfg = load_config_json(home);
    let mut mailboxes = cfg.sources.take().unwrap_or_default();
    if mailboxes.is_empty() {
        mailboxes.push(entry);
        cfg.imap = None;
    } else if let Some(pos) = mailboxes.iter().position(|m| m.id == entry.id) {
        mailboxes[pos] = entry;
    } else {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("mailbox id not found: {}", entry.id),
        ));
    }
    cfg.sources = Some(mailboxes);
    write_config_json(home, &cfg)?;
    crate::rules::ensure_default_rules_file(home).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(())
}

/// Remove one mailbox from `config.json` by `id`. Handles legacy top-level `imap` when it matches
/// the same derived id (single-account layout).
pub fn remove_mailbox_from_config(home: &Path, mailbox_id: &str) -> io::Result<()> {
    let mut cfg = load_config_json(home);
    let mut mailboxes = cfg.sources.take().unwrap_or_default();
    let before = mailboxes.len();
    mailboxes.retain(|m| m.id != mailbox_id);
    if mailboxes.len() < before {
        cfg.sources = Some(mailboxes);
        cfg.imap = None;
        fs::write(
            home.join("config.json"),
            serde_json::to_string_pretty(&cfg)? + "\n",
        )?;
        return Ok(());
    }
    if let Some(ref imap) = cfg.imap {
        if let Some(ref user) = imap.user {
            if !user.trim().is_empty() && derive_mailbox_id_from_email(user) == mailbox_id {
                cfg.imap = None;
                cfg.sources = Some(mailboxes);
                fs::write(
                    home.join("config.json"),
                    serde_json::to_string_pretty(&cfg)? + "\n",
                )?;
                return Ok(());
            }
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!("mailbox id not in config: {mailbox_id}"),
    ))
}

/// Update only `sync.defaultSince`, preserving other `sync` fields and the rest of `config.json`.
pub fn update_sync_default_since(home: &Path, default_since: &str) -> io::Result<()> {
    let mut cfg = load_config_json(home);
    let mut sync = cfg.sync.unwrap_or_else(|| SyncJson {
        default_since: None,
        mailbox: Some(String::new()),
        exclude_labels: Some(vec!["Trash".into(), "Spam".into()]),
    });
    sync.default_since = Some(default_since.to_string());
    cfg.sync = Some(sync);
    write_config_json(home, &cfg)?;
    Ok(())
}

/// Upsert one mailbox into `config.json` by id, write `<id>/.env`, optionally merge root OpenAI.
/// Returns the resolved `mailbox_id`.
#[allow(clippy::too_many_arguments)]
pub fn upsert_mailbox_setup(
    home: &Path,
    email: &str,
    password: &str,
    openai_key: Option<&str>,
    mailbox_id: Option<&str>,
    imap_host: Option<&str>,
    imap_port: Option<u16>,
    default_since: Option<&str>,
    identity_patch: Option<&IdentityPatch>,
) -> io::Result<String> {
    fs::create_dir_all(home)?;
    let id = mailbox_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| derive_mailbox_id_from_email(email));
    fs::create_dir_all(home.join(&id))?;

    let (host, port) = match (
        imap_host.map(str::trim).filter(|s| !s.is_empty()),
        imap_port,
    ) {
        (Some(h), Some(p)) => (h.to_string(), p),
        (Some(h), None) => (h.to_string(), 993),
        _ => derive_imap_settings(email)
            .map(|d| (d.host, d.port))
            .unwrap_or_else(|| ("imap.gmail.com".into(), 993)),
    };

    let mut cfg = load_config_json(home);
    let mut mailboxes = cfg.sources.take().unwrap_or_default();
    let preserved_search = mailboxes
        .iter()
        .find(|m| m.id == id)
        .and_then(|m| m.search.clone());
    let preserved_identity = mailboxes
        .iter()
        .find(|m| m.id == id)
        .and_then(|m| m.identity.clone());
    let identity = match identity_patch {
        Some(p) => merge_mailbox_identity(preserved_identity, p),
        None => preserved_identity,
    };
    let entry = MailboxConfigJson {
        id: id.clone(),
        kind: SourceKind::Imap,
        email: email.to_string(),
        label: None,
        imap: Some(ImapJson {
            host: Some(host),
            port: Some(port),
            user: None,
            aliases: None,
            imap_auth: None,
        }),
        imap_auth: None,
        search: preserved_search,
        identity,
        apple_mail_path: None,
        path: None,
        local_dir: None,
        oauth_source_id: None,
        calendar_ids: None,
        default_calendars: None,
        ics_url: None,
        drive_folder_id: None,
    };
    if let Some(pos) = mailboxes.iter().position(|m| m.id == id) {
        mailboxes[pos] = entry;
    } else {
        mailboxes.push(entry);
    }
    cfg.sources = Some(mailboxes);
    if cfg.sources.as_ref().is_some_and(|m| !m.is_empty()) {
        cfg.imap = None;
    }
    if cfg.sync.is_none() {
        cfg.sync = Some(SyncJson {
            default_since: Some(default_since.unwrap_or("1y").to_string()),
            mailbox: Some(String::new()),
            exclude_labels: Some(vec!["Trash".into(), "Spam".into()]),
        });
    }

    write_config_json(home, &cfg)?;
    merge_root_openai_key(home, openai_key)?;
    let mb_dotenv = format!("RIPMAIL_IMAP_PASSWORD={password}\n");
    fs::write(home.join(&id).join(".env"), mb_dotenv)?;
    crate::rules::ensure_default_rules_file(home).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(id)
}

/// Add or update an Apple Mail–backed mailbox (`mailboxType: applemail`) — no IMAP password.
#[allow(clippy::too_many_arguments)]
pub fn upsert_mailbox_applemail(
    home: &Path,
    email: &str,
    openai_key: Option<&str>,
    mailbox_id: Option<&str>,
    apple_mail_path: Option<&str>,
    default_since: Option<&str>,
    identity_patch: Option<&IdentityPatch>,
) -> io::Result<String> {
    fs::create_dir_all(home)?;
    let id = mailbox_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| derive_mailbox_id_from_email(email));
    fs::create_dir_all(home.join(&id))?;

    let mut cfg = load_config_json(home);
    let mut mailboxes = cfg.sources.take().unwrap_or_default();
    let preserved_search = mailboxes
        .iter()
        .find(|m| m.id == id)
        .and_then(|m| m.search.clone());
    let preserved_identity = mailboxes
        .iter()
        .find(|m| m.id == id)
        .and_then(|m| m.identity.clone());
    let identity = match identity_patch {
        Some(p) => merge_mailbox_identity(preserved_identity, p),
        None => preserved_identity,
    };
    let apple_path_json = apple_mail_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let entry = MailboxConfigJson {
        id: id.clone(),
        kind: SourceKind::AppleMail,
        email: email.to_string(),
        label: None,
        imap: None,
        imap_auth: None,
        search: preserved_search,
        identity,
        apple_mail_path: apple_path_json,
        path: None,
        local_dir: None,
        oauth_source_id: None,
        calendar_ids: None,
        default_calendars: None,
        ics_url: None,
        drive_folder_id: None,
    };
    if let Some(pos) = mailboxes.iter().position(|m| m.id == id) {
        mailboxes[pos] = entry;
    } else {
        mailboxes.push(entry);
    }
    cfg.sources = Some(mailboxes);
    if cfg.sources.as_ref().is_some_and(|m| !m.is_empty()) {
        cfg.imap = None;
    }
    if cfg.sync.is_none() {
        cfg.sync = Some(SyncJson {
            default_since: Some(default_since.unwrap_or("1y").to_string()),
            mailbox: Some(String::new()),
            exclude_labels: Some(vec!["Trash".into(), "Spam".into()]),
        });
    }

    write_config_json(home, &cfg)?;
    merge_root_openai_key(home, openai_key)?;
    crate::rules::ensure_default_rules_file(home).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(id)
}

/// Same as [`upsert_mailbox_setup`] but `imapAuth: googleOAuth` and `google-oauth.json` instead of app password.
#[allow(clippy::too_many_arguments)]
pub fn upsert_mailbox_google_oauth(
    home: &Path,
    email: &str,
    openai_key: Option<&str>,
    mailbox_id: Option<&str>,
    imap_host: Option<&str>,
    imap_port: Option<u16>,
    default_since: Option<&str>,
    token: &GoogleOAuthTokenStore,
    identity_patch: Option<&IdentityPatch>,
) -> io::Result<String> {
    fs::create_dir_all(home)?;
    let id = mailbox_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| derive_mailbox_id_from_email(email));
    fs::create_dir_all(home.join(&id))?;

    let (host, port) = match (
        imap_host.map(str::trim).filter(|s| !s.is_empty()),
        imap_port,
    ) {
        (Some(h), Some(p)) => (h.to_string(), p),
        (Some(h), None) => (h.to_string(), 993),
        _ => derive_imap_settings(email)
            .map(|d| (d.host, d.port))
            .unwrap_or_else(|| ("imap.gmail.com".into(), 993)),
    };

    let mut cfg = load_config_json(home);
    let mut mailboxes = cfg.sources.take().unwrap_or_default();
    let preserved_search = mailboxes
        .iter()
        .find(|m| m.id == id)
        .and_then(|m| m.search.clone());
    let preserved_identity = mailboxes
        .iter()
        .find(|m| m.id == id)
        .and_then(|m| m.identity.clone());
    let identity = match identity_patch {
        Some(p) => merge_mailbox_identity(preserved_identity, p),
        None => preserved_identity,
    };
    let entry = MailboxConfigJson {
        id: id.clone(),
        kind: SourceKind::Imap,
        email: email.to_string(),
        label: None,
        imap: Some(ImapJson {
            host: Some(host),
            port: Some(port),
            user: None,
            aliases: None,
            imap_auth: None,
        }),
        imap_auth: Some("googleOAuth".into()),
        search: preserved_search,
        identity,
        apple_mail_path: None,
        path: None,
        local_dir: None,
        oauth_source_id: None,
        calendar_ids: None,
        default_calendars: None,
        ics_url: None,
        drive_folder_id: None,
    };
    if let Some(pos) = mailboxes.iter().position(|m| m.id == id) {
        mailboxes[pos] = entry;
    } else {
        mailboxes.push(entry);
    }
    cfg.sources = Some(mailboxes);
    if cfg.sources.as_ref().is_some_and(|m| !m.is_empty()) {
        cfg.imap = None;
    }
    if cfg.sync.is_none() {
        cfg.sync = Some(SyncJson {
            default_since: Some(default_since.unwrap_or("1y").to_string()),
            mailbox: Some(String::new()),
            exclude_labels: Some(vec!["Trash".into(), "Spam".into()]),
        });
    }

    write_config_json(home, &cfg)?;
    merge_root_openai_key(home, openai_key)?;
    save_google_oauth_token_store(&google_oauth_token_path(home, &id), token)?;
    crate::rules::ensure_default_rules_file(home).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(id)
}

/// Hosted redirect (`RIPMAIL_OAUTH_RELAY_BASE`) + poll relay for the code; then same persistence as [`write_google_oauth_setup`].
///
/// `email`: if `None`, the Google account email is read from the userinfo API after sign-in (browser-first).
#[allow(clippy::too_many_arguments)]
pub fn write_google_oauth_setup_hosted(
    home: &Path,
    email: Option<&str>,
    openai_key: Option<&str>,
    mailbox_id: Option<&str>,
    imap_host: Option<&str>,
    imap_port: Option<u16>,
    no_validate: bool,
    identity_patch: Option<&IdentityPatch>,
) -> Result<String, Box<dyn std::error::Error>> {
    let env_map: std::collections::HashMap<String, String> = std::env::vars().collect();
    let mut env_file = crate::config::read_ripmail_env_file(home);
    let relay = resolve_oauth_relay_base(&env_file, &env_map);
    let base = relay.trim_end_matches('/').to_string();
    merge_root_oauth_relay_base_if_missing(home, &base)?;
    merge_root_google_oauth_client_if_missing(home)?;
    env_file = crate::config::read_ripmail_env_file(home);
    let mut client = resolve_google_oauth_client_with_diagnostics(Some(home), &env_file, &env_map)?;
    client.redirect_uri = format!("{}/oauth/callback", base);
    let tokens = run_google_oauth_hosted(&client, &base).map_err(|e| e.to_string())?;
    let email = match email {
        Some(e) if !e.trim().is_empty() => e.trim().to_string(),
        _ => fetch_google_account_email(&tokens.access_token).map_err(|e| e.to_string())?,
    };
    let refresh = tokens
        .refresh_token
        .ok_or_else(|| "Google did not return a refresh token. Try revoking ripmail access in Google Account settings and run again.".to_string())?;
    let store = GoogleOAuthTokenStore {
        refresh_token: refresh,
        access_token: Some(tokens.access_token),
        access_token_expires_at: tokens.expires_in.map(|s| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            now + s as i64
        }),
    };
    let id = upsert_mailbox_google_oauth(
        home,
        email.as_str(),
        openai_key,
        mailbox_id,
        imap_host,
        imap_port,
        Some("1y"),
        &store,
        identity_patch,
    )?;
    let cfg = crate::config::load_config(crate::config::LoadConfigOptions {
        home: Some(home.to_path_buf()),
        env: None,
    });
    let mb = cfg
        .resolved_mailboxes()
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| "mailbox missing after OAuth setup".to_string())?;
    if !no_validate {
        validate_imap_for_mailbox(home, mb)?;
    }
    Ok(id)
}

/// Run browser Google OAuth on **loopback** (`RIPMAIL_GOOGLE_OAUTH_REDIRECT_URI` or default
/// `http://127.0.0.1:8765/oauth/callback`), persist tokens, write `imapAuth`, optionally validate IMAP.
///
/// `email`: if `None` or empty after trim, scopes include `openid email` and the address is read from
/// Google userinfo after sign-in (same idea as the former hosted wizard path).
#[allow(clippy::too_many_arguments)]
pub fn write_google_oauth_setup(
    home: &Path,
    email: Option<&str>,
    openai_key: Option<&str>,
    mailbox_id: Option<&str>,
    imap_host: Option<&str>,
    imap_port: Option<u16>,
    no_validate: bool,
    identity_patch: Option<&IdentityPatch>,
) -> Result<String, Box<dyn std::error::Error>> {
    let env_map: std::collections::HashMap<String, String> = std::env::vars().collect();
    merge_root_google_oauth_client_if_missing(home)?;
    let env_file = crate::config::read_ripmail_env_file(home);
    let client = resolve_google_oauth_client_with_diagnostics(Some(home), &env_file, &env_map)?;
    let scope = if email.map(|e| !e.trim().is_empty()).unwrap_or(false) {
        GOOGLE_OAUTH_SCOPE_MAIL_CALENDAR_READONLY
    } else {
        GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_READONLY
    };
    let tokens = run_google_oauth_interactive(&client, scope)?;
    let resolved_email = match email {
        Some(e) if !e.trim().is_empty() => e.trim().to_string(),
        _ => fetch_google_account_email(&tokens.access_token).map_err(|e| e.to_string())?,
    };
    let refresh = tokens
        .refresh_token
        .ok_or_else(|| "Google did not return a refresh token. Try revoking ripmail access in Google Account settings and run again with prompt=consent.".to_string())?;
    let store = GoogleOAuthTokenStore {
        refresh_token: refresh,
        access_token: Some(tokens.access_token),
        access_token_expires_at: tokens.expires_in.map(|s| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            now + s as i64
        }),
    };
    let id = upsert_mailbox_google_oauth(
        home,
        resolved_email.as_str(),
        openai_key,
        mailbox_id,
        imap_host,
        imap_port,
        Some("1y"),
        &store,
        identity_patch,
    )?;
    let cfg = crate::config::load_config(crate::config::LoadConfigOptions {
        home: Some(home.to_path_buf()),
        env: None,
    });
    let mb = cfg
        .resolved_mailboxes()
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| "mailbox missing after OAuth setup".to_string())?;
    if !no_validate {
        validate_imap_for_mailbox(home, mb)?;
    }
    Ok(id)
}

/// Validate IMAP using resolved mailbox (password or OAuth).
pub fn validate_imap_for_mailbox(home: &Path, mb: &ResolvedMailbox) -> Result<(), String> {
    let env_file = crate::config::read_ripmail_env_file(home);
    let process_env: std::collections::HashMap<String, String> = std::env::vars().collect();
    let mut s = connect_imap_for_resolved_mailbox(home, mb, &env_file, &process_env)
        .map_err(|e| e.to_string())?;
    s.logout().map_err(|e| e.to_string())?;
    Ok(())
}

/// Write multi-inbox `config.json` ([OPP-016](../docs/opportunities/archive/OPP-016-multi-inbox.md)), root
/// `.env` (OpenAI only), and `<mailbox_id>/.env` (IMAP password).
pub fn write_ripmail_config_and_env(p: &WriteZmailParams<'_>) -> io::Result<()> {
    upsert_mailbox_setup(
        p.home,
        p.email,
        p.password,
        p.openai_key,
        None,
        Some(p.imap_host),
        Some(p.imap_port),
        Some(p.default_since),
        None,
    )?;
    Ok(())
}

/// Write `config.json` + `.env` for non-interactive `ripmail setup` (derives host/port from Gmail).
#[allow(clippy::too_many_arguments)]
pub fn write_setup(
    home: &Path,
    email: &str,
    password: &str,
    openai_key: Option<&str>,
    mailbox_id: Option<&str>,
    imap_host: Option<&str>,
    imap_port: Option<u16>,
    identity_patch: Option<&IdentityPatch>,
) -> io::Result<String> {
    upsert_mailbox_setup(
        home,
        email,
        password,
        openai_key,
        mailbox_id,
        imap_host,
        imap_port,
        Some("1y"),
        identity_patch,
    )
}

/// Write `config.json` for non-interactive `ripmail setup --apple-mail` (no IMAP credentials).
#[allow(clippy::too_many_arguments)]
pub fn write_applemail_setup(
    home: &Path,
    email: &str,
    openai_key: Option<&str>,
    mailbox_id: Option<&str>,
    apple_mail_path: Option<&str>,
    identity_patch: Option<&IdentityPatch>,
) -> io::Result<String> {
    upsert_mailbox_applemail(
        home,
        email,
        openai_key,
        mailbox_id,
        apple_mail_path,
        Some("1y"),
        identity_patch,
    )
}

/// Remove **all** top-level files and directories under `home` (`RIPMAIL_HOME`).
///
/// Used by `ripmail wizard --clean`. This directory is expected to be ripmail-only; anything
/// present at the top level (config, secrets, SQLite DB + WAL, `data/`, per-mailbox dirs including
/// those without `maildir/`, `logs/`, rules files, etc.) is deleted.
pub fn clean_ripmail_home(home: &Path) -> io::Result<()> {
    if !home.exists() {
        return Ok(());
    }
    let entries: Vec<_> = fs::read_dir(home)?.flatten().collect();
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    for e in entries {
        let p = e.path();
        if p.is_dir() {
            dirs.push(p);
        } else {
            files.push(p);
        }
    }
    for p in files {
        fs::remove_file(&p)?;
    }
    for p in dirs {
        fs::remove_dir_all(&p)?;
    }
    Ok(())
}

/// True when `home` exists and has at least one top-level file or directory (wizard `--clean` / `ripmail clean`).
pub fn ripmail_home_has_entries(home: &Path) -> bool {
    fs::read_dir(home)
        .map(|mut r| r.next().is_some())
        .unwrap_or(false)
}

/// Best-effort path to the SQLite index (multi-inbox layout first, then legacy `data/`).
fn ripmail_db_path_best_effort(home: &Path) -> Option<PathBuf> {
    let root = home.join("ripmail.db");
    if root.is_file() {
        return Some(root);
    }
    let legacy = home.join("data").join("ripmail.db");
    if legacy.is_file() {
        return Some(legacy);
    }
    None
}

fn trim_iso_date(s: &str) -> String {
    s.chars().take(10).collect()
}

fn format_date_range_span(min: Option<String>, max: Option<String>) -> String {
    match (min, max) {
        (Some(a), Some(b)) if a == b => trim_iso_date(&a),
        (Some(a), Some(b)) => format!("{} – {}", trim_iso_date(&a), trim_iso_date(&b)),
        (Some(a), None) | (None, Some(a)) => trim_iso_date(&a),
        (None, None) => "—".to_string(),
    }
}

fn format_count_with_commas(n: i64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out.chars().rev().collect()
}

fn mailbox_via_label(mb: &MailboxConfigJson) -> &'static str {
    match mb.kind {
        SourceKind::AppleMail => "Apple Mail",
        SourceKind::LocalDir => "Local folder",
        SourceKind::Imap => "IMAP",
        SourceKind::GoogleCalendar => "Google Calendar",
        SourceKind::AppleCalendar => "Apple Calendar",
        SourceKind::IcsSubscription => "ICS URL",
        SourceKind::IcsFile => "ICS file",
        SourceKind::GoogleDrive => "Google Drive",
    }
}

fn format_ripmail_home_top_level_list(home: &Path) -> String {
    let Ok(entries) = fs::read_dir(home) else {
        return String::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    if names.is_empty() {
        return String::new();
    }
    let mut s = String::from("Top-level paths that would be removed:\n");
    for n in names {
        s.push_str(&format!("  • {n}\n"));
    }
    s
}

/// Shorten long ISO timestamps for display (date + time, no redundant zone noise when possible).
fn trim_display_timestamp(s: &str) -> String {
    let t = s.trim();
    if t.len() > 19 && t.as_bytes().get(10) == Some(&b'T') {
        // "2026-04-15T13:45:18+00:00" -> "2026-04-15 13:45"
        format!("{} {}", &t[..10], &t[11..16])
    } else {
        t.to_string()
    }
}

/// Multi-line summary for `ripmail clean` / `wizard --clean` (indexed mailboxes, counts, sync metadata).
pub fn ripmail_clean_preview(home: &Path) -> String {
    let mut out = String::new();
    out.push_str(
        "This resets ripmail on this computer: your local index and ripmail settings in the directory below will be erased.\n",
    );
    out.push_str(&format!(
        "Ripmail directory (RIPMAIL_HOME):\n  {}\n\n",
        home.display()
    ));
    out.push_str(
        "Nothing is deleted from your email provider or from the Mail app — only ripmail's copy here.\n",
    );
    if ripmail_home_has_entries(home) {
        out.push('\n');
        out.push_str(&format_ripmail_home_top_level_list(home));
        out.push('\n');
    }

    let mailboxes = load_mailbox_configs_for_wizard(home);
    let db_path = ripmail_db_path_best_effort(home);
    let conn = db_path.and_then(|p| {
        rusqlite::Connection::open_with_flags(&p, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
    });

    let Some(conn) = conn else {
        if mailboxes.is_empty() {
            out.push_str("There's no local index yet, and no accounts in config — only leftover files would be cleared.\n");
        } else {
            out.push_str("There's no readable local index yet. These accounts are configured but not indexed on disk:\n");
            for mb in &mailboxes {
                out.push_str(&format!("  • {} ({})\n", mb.email, mailbox_via_label(mb)));
            }
        }
        return out;
    };

    let mut by_id: HashMap<String, (i64, Option<String>, Option<String>)> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT source_id, COUNT(*), MIN(date), MAX(date) FROM messages GROUP BY source_id",
    ) {
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        });
        if let Ok(rows) = rows {
            for r in rows.flatten() {
                by_id.insert(r.0, (r.1, r.2, r.3));
            }
        }
    }

    out.push_str("Here's what ripmail has indexed locally:\n");
    let mut configured_ids = HashSet::new();
    if mailboxes.is_empty() && by_id.is_empty() {
        out.push_str("  (no accounts in config; index is empty)\n");
    } else {
        if mailboxes.is_empty() {
            out.push_str("  (no accounts listed in config — leftover index rows below)\n");
        }
        for mb in &mailboxes {
            configured_ids.insert(mb.id.clone());
            let (count, min_d, max_d) = by_id
                .get(mb.id.as_str())
                .cloned()
                .unwrap_or((0, None, None));
            let span = format_date_range_span(min_d, max_d);
            let msg_word = if count == 1 { "message" } else { "messages" };
            let n = format_count_with_commas(count);
            out.push_str(&format!(
                "  • {} — {}\n    {} {} · dates in index: {}\n",
                mb.email,
                mailbox_via_label(mb),
                n,
                msg_word,
                span
            ));
        }
    }

    for (id, (count, min_d, max_d)) in &by_id {
        if configured_ids.contains(id) {
            continue;
        }
        let span = format_date_range_span(min_d.clone(), max_d.clone());
        let msg_word = if *count == 1 { "message" } else { "messages" };
        let n = format_count_with_commas(*count);
        let label = if id.is_empty() {
            "Older account (legacy)"
        } else {
            id.as_str()
        };
        out.push_str(&format!(
            "  • {label}\n    {n} {msg_word} · dates in index: {span}\n",
        ));
    }

    if let Ok((earliest, latest, target, _sync_start, last)) = conn.query_row(
        "SELECT earliest_synced_date, latest_synced_date, target_start_date, sync_start_earliest_date, last_sync_at FROM sync_summary WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        },
    ) {
        let any = earliest.is_some()
            || latest.is_some()
            || target.is_some()
            || _sync_start.is_some()
            || last.is_some();
        if any {
            out.push_str("\nSync details:\n");
            if let (Some(a), Some(b)) = (earliest.clone(), latest.clone()) {
                if trim_iso_date(&a) == trim_iso_date(&b) {
                    out.push_str(&format!(
                        "  • Newest and oldest message in the index: {}\n",
                        trim_iso_date(&a)
                    ));
                } else {
                    out.push_str(&format!(
                        "  • Oldest message in the index: {}\n  • Newest message in the index: {}\n",
                        trim_iso_date(&a),
                        trim_iso_date(&b)
                    ));
                }
            }
            if let Some(s) = target {
                out.push_str(&format!(
                    "  • Sync was set to include mail from {} onward\n",
                    trim_iso_date(&s)
                ));
            }
            if let Some(s) = last {
                let disp = trim_display_timestamp(&s);
                out.push_str(&format!("  • Last sync finished: {disp}\n"));
            }
        }
    }

    out
}

/// Validate IMAP by connecting and logging out (Node `validateImap`).
pub fn validate_imap_credentials(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
) -> Result<(), String> {
    let mut s = connect_imap_session(host, port, user, pass).map_err(|e| e.to_string())?;
    s.logout().map_err(|e| e.to_string())?;
    Ok(())
}

/// Validate OpenAI key via `models.list` (Node `validateOpenAI`).
pub fn validate_openai_key(api_key: &str) -> Result<(), String> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    rt.block_on(async {
        use async_openai::config::OpenAIConfig;
        use async_openai::Client;
        let client = Client::with_config(OpenAIConfig::new().with_api_key(api_key));
        client.models().list().await.map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsJson {
    pub message_count: i64,
    pub thread_count: i64,
    pub attachment_count: i64,
    pub people_count: i64,
}

pub fn collect_stats(conn: &rusqlite::Connection) -> rusqlite::Result<StatsJson> {
    let message_count: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
    let thread_count: i64 = conn.query_row("SELECT COUNT(*) FROM threads", [], |r| r.get(0))?;
    let attachment_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0))?;
    let people_count: i64 = conn.query_row("SELECT COUNT(*) FROM people", [], |r| r.get(0))?;
    Ok(StatsJson {
        message_count,
        thread_count,
        attachment_count,
        people_count,
    })
}

#[cfg(test)]
mod tests {
    use crate::config::{ConfigJson, ImapJson, MailboxSearchJson};

    use super::*;

    #[test]
    fn derive_gmail() {
        let d = derive_imap_settings("a@gmail.com").unwrap();
        assert_eq!(d.host, "imap.gmail.com");
        assert_eq!(d.port, 993);
    }

    #[test]
    fn derive_unknown() {
        assert!(derive_imap_settings("a@corp.com").is_none());
    }

    #[test]
    fn mask_secret_short() {
        assert_eq!(mask_secret("ab"), "****");
    }

    #[test]
    fn mask_secret_long() {
        assert_eq!(mask_secret("sk-long-key"), "sk-l...");
    }

    #[test]
    fn parse_dotenv() {
        let s =
            parse_dotenv_secrets("RIPMAIL_IMAP_PASSWORD=secret\nRIPMAIL_OPENAI_API_KEY=sk-test\n");
        assert_eq!(s.password.as_deref(), Some("secret"));
        assert_eq!(s.api_key.as_deref(), Some("sk-test"));
    }

    #[test]
    fn wizard_first_setup_true_when_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(wizard_is_first_mailbox_setup(dir.path()));
    }

    #[test]
    fn wizard_first_setup_false_when_mailboxes() {
        let dir = tempfile::tempdir().unwrap();
        upsert_mailbox_setup(
            dir.path(),
            "a@gmail.com",
            "pw",
            None,
            None,
            None,
            None,
            Some("1y"),
            None,
        )
        .unwrap();
        assert!(!wizard_is_first_mailbox_setup(dir.path()));
    }

    #[test]
    fn load_mailbox_configs_for_wizard_legacy_imap() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = ConfigJson {
            imap: Some(ImapJson {
                host: Some("imap.example.com".into()),
                port: Some(993),
                user: Some("u@example.com".into()),
                aliases: None,
                imap_auth: None,
            }),
            ..Default::default()
        };
        fs::write(
            dir.path().join("config.json"),
            serde_json::to_string_pretty(&cfg).unwrap() + "\n",
        )
        .unwrap();
        let m = load_mailbox_configs_for_wizard(dir.path());
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].email, "u@example.com");
        assert_eq!(m[0].id, derive_mailbox_id_from_email("u@example.com"));
    }

    #[test]
    fn update_sync_default_since_preserves_mailboxes() {
        let dir = tempfile::tempdir().unwrap();
        upsert_mailbox_setup(
            dir.path(),
            "a@gmail.com",
            "pw",
            None,
            None,
            None,
            None,
            Some("1y"),
            None,
        )
        .unwrap();
        update_sync_default_since(dir.path(), "7d").unwrap();
        let raw = fs::read_to_string(dir.path().join("config.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["sync"]["defaultSince"], "7d");
        assert!(!v["sources"].as_array().unwrap().is_empty());
    }

    #[test]
    fn remove_mailbox_from_config_drops_one() {
        let dir = tempfile::tempdir().unwrap();
        upsert_mailbox_setup(
            dir.path(),
            "a@gmail.com",
            "pw",
            None,
            None,
            None,
            None,
            Some("1y"),
            None,
        )
        .unwrap();
        upsert_mailbox_setup(
            dir.path(),
            "b@gmail.com",
            "pw",
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let id_a = derive_mailbox_id_from_email("a@gmail.com");
        remove_mailbox_from_config(dir.path(), &id_a).unwrap();
        let m = load_mailbox_configs_for_wizard(dir.path());
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].email, "b@gmail.com");
    }

    #[test]
    fn replace_mailbox_entry_updates_search() {
        let dir = tempfile::tempdir().unwrap();
        upsert_mailbox_setup(
            dir.path(),
            "a@gmail.com",
            "pw",
            None,
            None,
            None,
            None,
            Some("1y"),
            None,
        )
        .unwrap();
        let _id = derive_mailbox_id_from_email("a@gmail.com");
        let mut cfg = super::load_config_json(dir.path());
        let mut mbs = cfg.sources.take().unwrap();
        mbs[0].search = Some(MailboxSearchJson {
            include_in_default: Some(false),
        });
        cfg.sources = Some(mbs);
        fs::write(
            dir.path().join("config.json"),
            serde_json::to_string_pretty(&cfg).unwrap() + "\n",
        )
        .unwrap();

        let mut entry = load_mailbox_configs_for_wizard(dir.path()).pop().unwrap();
        entry.email = "b@gmail.com".into();
        replace_mailbox_entry(dir.path(), entry).unwrap();
        let raw = fs::read_to_string(dir.path().join("config.json")).unwrap();
        assert!(raw.contains("b@gmail.com"));
        assert!(raw.contains("\"includeInDefault\": false"));
    }

    #[test]
    fn clean_ripmail_home_removes_everything_including_mailbox_without_maildir() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        fs::create_dir_all(home.join("apple-only").join("nested")).unwrap();
        fs::write(home.join("apple-only").join(".env"), b"SECRET=1\n").unwrap();
        fs::write(home.join("config.json"), b"{}\n").unwrap();
        fs::write(home.join(".env"), b"ROOT=1\n").unwrap();
        fs::write(home.join("rules.json"), b"{}\n").unwrap();
        fs::create_dir_all(home.join("data").join("maildir")).unwrap();
        fs::create_dir_all(home.join("logs")).unwrap();

        super::clean_ripmail_home(home).unwrap();

        assert!(!super::ripmail_home_has_entries(home));
    }

    #[test]
    fn ripmail_home_has_entries_sees_orphan_mailbox_only() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        fs::create_dir_all(home.join("mb")).unwrap();
        fs::write(home.join("mb").join(".env"), b"x\n").unwrap();
        assert!(super::ripmail_home_has_entries(home));
    }

    #[test]
    fn upsert_mailbox_applemail_writes_mailbox_type() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        super::upsert_mailbox_applemail(home, "u@icloud.com", None, None, None, Some("30d"), None)
            .unwrap();
        let raw = fs::read_to_string(home.join("config.json")).unwrap();
        assert!(raw.contains("applemail"), "{raw}");
        assert!(raw.contains("u@icloud.com"), "{raw}");
    }

    #[test]
    fn ripmail_clean_preview_shows_counts_and_sync_meta() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        upsert_mailbox_setup(
            home,
            "a@gmail.com",
            "pw",
            None,
            None,
            None,
            None,
            Some("1y"),
            None,
        )
        .unwrap();
        let id = derive_mailbox_id_from_email("a@gmail.com");
        let db_path = home.join("ripmail.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::db::apply_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO messages (message_id, thread_id, folder, uid, labels, from_address, date, body_text, raw_path, source_id) VALUES (?1, 't', 'INBOX', 1, '[]', 'a@b', '2024-06-15T12:00:00Z', '', 'x', ?2)",
            rusqlite::params!["<m1@test>", id],
        )
        .unwrap();
        conn.execute(
            "UPDATE sync_summary SET target_start_date = '2024-01-01', earliest_synced_date = '2024-06-15T12:00:00Z', latest_synced_date = '2024-06-15T12:00:00Z', last_sync_at = '2026-04-01 12:00:00' WHERE id = 1",
            [],
        )
        .unwrap();
        drop(conn);

        let s = super::ripmail_clean_preview(home);
        assert!(s.contains("Ripmail directory (RIPMAIL_HOME):"), "{s}");
        assert!(s.contains("Top-level paths"), "{s}");
        assert!(s.contains("a@gmail.com"), "{s}");
        assert!(s.contains("1 message"), "{s}");
        assert!(s.contains("2024-06-15"), "{s}");
        assert!(s.contains("Sync was set to include mail from"), "{s}");
        assert!(s.contains("Last sync finished"), "{s}");
    }
}
