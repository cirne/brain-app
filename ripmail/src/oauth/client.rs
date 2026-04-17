//! Resolve Google OAuth client settings: compile-time embed, then env.

use std::collections::HashMap;
use std::path::Path;

/// OAuth client for Google token and authorize endpoints (Desktop app).
#[derive(Debug, Clone)]
pub struct GoogleOAuthClientSettings {
    pub client_id: String,
    pub client_secret: String,
    pub auth_uri: String,
    pub token_uri: String,
    pub redirect_uri: String,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum GoogleOAuthClientError {
    #[error("missing Google OAuth client credentials (details were printed to stderr)")]
    MissingCredentials,
    #[error("Invalid OAuth redirect URI: {0}")]
    InvalidRedirectUri(String),
}

/// Bundled Desktop OAuth client when env / compile-time embed are unset (same values as release CI embeds).
/// Non-empty in official release branches; override with `RIPMAIL_GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` in `{project}/.env` or `$RIPMAIL_HOME/.env`.
pub const DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: &str = "";
pub const DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_SECRET: &str = "";

fn env_first(
    key: &str,
    env_file: &HashMap<String, String>,
    process: &HashMap<String, String>,
) -> Option<String> {
    process
        .get(key)
        .cloned()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| env_file.get(key).cloned().filter(|s| !s.trim().is_empty()))
}

fn pick_client_id(
    env_file: &HashMap<String, String>,
    process: &HashMap<String, String>,
) -> Option<String> {
    option_env!("RIPMAIL_OAUTH_EMBEDDED_CLIENT_ID")
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| env_first("RIPMAIL_GOOGLE_OAUTH_CLIENT_ID", env_file, process))
        .or_else(|| {
            let s = DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
}

fn pick_client_secret(
    env_file: &HashMap<String, String>,
    process: &HashMap<String, String>,
) -> Option<String> {
    option_env!("RIPMAIL_OAUTH_EMBEDDED_CLIENT_SECRET")
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| env_first("RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET", env_file, process))
        .or_else(|| {
            let s = DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_SECRET.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
}

/// Resolve client settings: compile-time embed, process env, merged `{project}/.env` + `$RIPMAIL_HOME/.env`, then [`DEFAULT_PUBLIC_*`] when non-empty.
pub fn resolve_google_oauth_client(
    env_file: &HashMap<String, String>,
    process: &HashMap<String, String>,
) -> Result<GoogleOAuthClientSettings, GoogleOAuthClientError> {
    let client_id =
        pick_client_id(env_file, process).ok_or(GoogleOAuthClientError::MissingCredentials)?;
    let client_secret =
        pick_client_secret(env_file, process).ok_or(GoogleOAuthClientError::MissingCredentials)?;

    let auth_uri = env_first("RIPMAIL_GOOGLE_OAUTH_AUTH_URI", env_file, process)
        .unwrap_or_else(|| "https://accounts.google.com/o/oauth2/v2/auth".into());
    let token_uri = env_first("RIPMAIL_GOOGLE_OAUTH_TOKEN_URI", env_file, process)
        .unwrap_or_else(|| "https://oauth2.googleapis.com/token".into());

    let redirect_uri = env_first("RIPMAIL_GOOGLE_OAUTH_REDIRECT_URI", env_file, process)
        .unwrap_or_else(|| "http://127.0.0.1:8765/oauth/callback".into());

    let ru = redirect_uri.trim();
    if !(ru.starts_with("http://") || ru.starts_with("https://")) {
        return Err(GoogleOAuthClientError::InvalidRedirectUri(redirect_uri));
    }

    Ok(GoogleOAuthClientSettings {
        client_id,
        client_secret,
        auth_uri,
        token_uri,
        redirect_uri,
    })
}

/// Same as [`resolve_google_oauth_client`], but on failure prints **stderr** diagnostics when `home` is set.
pub fn resolve_google_oauth_client_with_diagnostics(
    home: Option<&Path>,
    env_file: &HashMap<String, String>,
    process: &HashMap<String, String>,
) -> Result<GoogleOAuthClientSettings, GoogleOAuthClientError> {
    match resolve_google_oauth_client(env_file, process) {
        Ok(s) => Ok(s),
        Err(GoogleOAuthClientError::MissingCredentials) => {
            if let Some(h) = home {
                eprint_google_oauth_client_missing(h, env_file, process);
            }
            Err(GoogleOAuthClientError::MissingCredentials)
        }
        Err(e) => Err(e),
    }
}

fn eprint_google_oauth_client_missing(
    home: &Path,
    _env_file: &HashMap<String, String>,
    process: &HashMap<String, String>,
) {
    use crate::config::{read_project_repo_dotenv, read_ripmail_home_dotenv_only};

    let embed_id = option_env!("RIPMAIL_OAUTH_EMBEDDED_CLIENT_ID")
        .filter(|s| !s.is_empty())
        .is_some();
    let embed_sec = option_env!("RIPMAIL_OAUTH_EMBEDDED_CLIENT_SECRET")
        .filter(|s| !s.is_empty())
        .is_some();
    let proc_id = process
        .get("RIPMAIL_GOOGLE_OAUTH_CLIENT_ID")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let proc_sec = process
        .get("RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let project_map = read_project_repo_dotenv();
    let project_id = project_map
        .get("RIPMAIL_GOOGLE_OAUTH_CLIENT_ID")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let project_sec = project_map
        .get("RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let ripmail_map = read_ripmail_home_dotenv_only(home);
    let ripmail_id = ripmail_map
        .get("RIPMAIL_GOOGLE_OAUTH_CLIENT_ID")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let ripmail_sec = ripmail_map
        .get("RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let bundled_id = !DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID.trim().is_empty();
    let bundled_sec = !DEFAULT_PUBLIC_GOOGLE_OAUTH_CLIENT_SECRET.trim().is_empty();

    eprintln!("ripmail: Google OAuth Desktop client id and secret are not available.");
    eprintln!("  Checked (in order):");
    eprintln!(
        "    • Build-time RIPMAIL_OAUTH_EMBEDDED_CLIENT_ID / _SECRET: id={} secret={}",
        if embed_id { "set" } else { "empty" },
        if embed_sec { "set" } else { "empty" }
    );
    eprintln!(
        "    • Process environment RIPMAIL_GOOGLE_OAUTH_*: id={} secret={}",
        if proc_id { "set" } else { "empty" },
        if proc_sec { "set" } else { "empty" }
    );
    eprintln!(
        "    • Project `.env` next to Cargo.toml (dev overlay): id={} secret={}",
        if project_id { "set" } else { "empty" },
        if project_sec { "set" } else { "empty" }
    );
    eprintln!(
        "    • {}: id={} secret={}",
        home.join(".env").display(),
        if ripmail_id { "set" } else { "empty" },
        if ripmail_sec { "set" } else { "empty" }
    );
    eprintln!(
        "    • Bundled defaults in binary (DEFAULT_PUBLIC_*): id={} secret={}",
        if bundled_id { "set" } else { "empty" },
        if bundled_sec { "set" } else { "empty" }
    );
    eprintln!(
        "  Add credentials (local dev: repo `.env` next to Cargo.toml; or `$RIPMAIL_HOME/.env`):"
    );
    eprintln!(
        "    RIPMAIL_GOOGLE_OAUTH_CLIENT_ID=<Desktop OAuth client id>.apps.googleusercontent.com"
    );
    eprintln!("    RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET=<client secret>");
    eprintln!("  Production / CI: embed at build time:");
    eprintln!("    RIPMAIL_OAUTH_EMBEDDED_CLIENT_ID=... RIPMAIL_OAUTH_EMBEDDED_CLIENT_SECRET=... cargo build --release");
}

/// Default public relay URL for optional hosted OAuth (`write_google_oauth_setup_hosted`; bundled).
/// Override: `RIPMAIL_OAUTH_RELAY_BASE` in env / `$RIPMAIL_HOME/.env`, or `RIPMAIL_OAUTH_RELAY_DEFAULT` at compile time.
pub const DEFAULT_PUBLIC_OAUTH_RELAY_BASE: &str = "https://oauth.ripmail.dev";

/// Public HTTPS relay for optional hosted OAuth (browser redirects here; CLI polls for the code).
/// Resolution order: `RIPMAIL_OAUTH_RELAY_BASE` (process then `$RIPMAIL_HOME/.env`), then
/// `RIPMAIL_OAUTH_RELAY_DEFAULT` from the build, then [`DEFAULT_PUBLIC_OAUTH_RELAY_BASE`].
pub fn resolve_oauth_relay_base(
    env_file: &HashMap<String, String>,
    process: &HashMap<String, String>,
) -> String {
    env_first("RIPMAIL_OAUTH_RELAY_BASE", env_file, process)
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            option_env!("RIPMAIL_OAUTH_RELAY_DEFAULT")
                .filter(|s| !s.is_empty())
                .map(String::from)
        })
        .unwrap_or_else(|| DEFAULT_PUBLIC_OAUTH_RELAY_BASE.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_from_process_env() {
        let env_file = HashMap::new();
        let mut process = HashMap::new();
        process.insert(
            "RIPMAIL_GOOGLE_OAUTH_CLIENT_ID".into(),
            "id.apps.googleusercontent.com".into(),
        );
        process.insert("RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET".into(), "sec".into());
        let s = resolve_google_oauth_client(&env_file, &process).unwrap();
        assert_eq!(s.client_id, "id.apps.googleusercontent.com");
        assert!(s.redirect_uri.contains("127.0.0.1"));
    }

    #[test]
    fn missing_errors() {
        let env_file = HashMap::new();
        let process = HashMap::new();
        assert!(resolve_google_oauth_client(&env_file, &process).is_err());
    }

    #[test]
    fn resolve_relay_from_env() {
        let mut process = HashMap::new();
        process.insert(
            "RIPMAIL_OAUTH_RELAY_BASE".into(),
            "https://oauth.example.com".into(),
        );
        let env_file = HashMap::new();
        assert_eq!(
            resolve_oauth_relay_base(&env_file, &process).as_str(),
            "https://oauth.example.com"
        );
    }

    #[test]
    fn resolve_relay_defaults_when_unset() {
        let env_file = HashMap::new();
        let process = HashMap::new();
        assert_eq!(
            resolve_oauth_relay_base(&env_file, &process).as_str(),
            DEFAULT_PUBLIC_OAUTH_RELAY_BASE
        );
    }
}
