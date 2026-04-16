//! Persisted Google OAuth tokens per mailbox (`google-oauth.json`).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const TOKEN_FILE: &str = "google-oauth.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GoogleOAuthTokenStore {
    pub refresh_token: String,
    #[serde(default)]
    pub access_token: Option<String>,
    /// Unix epoch seconds when `access_token` expires (best-effort from `expires_in`).
    #[serde(default)]
    pub access_token_expires_at: Option<i64>,
}

#[must_use]
pub fn google_oauth_token_path(home: &Path, mailbox_id: &str) -> PathBuf {
    home.join(mailbox_id).join(TOKEN_FILE)
}

/// True if `google-oauth.json` exists or mailbox `.env` contains `RIPMAIL_GOOGLE_REFRESH_TOKEN`.
pub fn google_oauth_credentials_present(home: &Path, mailbox_id: &str) -> bool {
    if google_oauth_token_path(home, mailbox_id).is_file() {
        return true;
    }
    let dotenv_path = home.join(mailbox_id).join(".env");
    let Ok(content) = fs::read_to_string(&dotenv_path) else {
        return false;
    };
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim() == "RIPMAIL_GOOGLE_REFRESH_TOKEN" && !v.trim().is_empty() {
                return true;
            }
        }
    }
    false
}

pub fn load_google_oauth_token_store(path: &Path) -> io::Result<GoogleOAuthTokenStore> {
    let raw = fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// Prefer `google-oauth.json`; if missing, accept `RIPMAIL_GOOGLE_REFRESH_TOKEN` in `<mailbox_id>/.env`.
pub fn load_google_oauth_token_store_for_mailbox(
    home: &Path,
    mailbox_id: &str,
) -> io::Result<GoogleOAuthTokenStore> {
    let json_path = google_oauth_token_path(home, mailbox_id);
    if json_path.is_file() {
        return load_google_oauth_token_store(&json_path);
    }
    let dotenv_path = home.join(mailbox_id).join(".env");
    let Ok(content) = fs::read_to_string(&dotenv_path) else {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "no google-oauth.json or mailbox .env with RIPMAIL_GOOGLE_REFRESH_TOKEN",
        ));
    };
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim() == "RIPMAIL_GOOGLE_REFRESH_TOKEN" {
                let rt = v.trim().to_string();
                if !rt.is_empty() {
                    return Ok(GoogleOAuthTokenStore {
                        refresh_token: rt,
                        access_token: None,
                        access_token_expires_at: None,
                    });
                }
            }
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "no google-oauth.json or RIPMAIL_GOOGLE_REFRESH_TOKEN in mailbox .env",
    ))
}

pub fn save_google_oauth_token_store(path: &Path, store: &GoogleOAuthTokenStore) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(store).map_err(io::Error::other)?;
    fs::write(path, raw)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(path, perms)?;
    }
    if let Some(mb_dir) = path.parent() {
        if let (Some(home), Some(id)) = (mb_dir.parent(), mb_dir.file_name()) {
            let _ = merge_mailbox_google_refresh_token_dotenv(
                home,
                id.to_string_lossy().as_ref(),
                &store.refresh_token,
            );
        }
    }
    Ok(())
}

/// Merge `RIPMAIL_GOOGLE_REFRESH_TOKEN` into `<mailbox_id>/.env` (0600 on Unix).
fn merge_mailbox_google_refresh_token_dotenv(
    home: &Path,
    mailbox_id: &str,
    refresh_token: &str,
) -> io::Result<()> {
    let path = home.join(mailbox_id).join(".env");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
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
                if k.trim() == "RIPMAIL_GOOGLE_REFRESH_TOKEN" {
                    continue;
                }
            }
            out.push_str(line);
            out.push('\n');
        }
    }
    out.push_str(&format!(
        "# Gmail OAuth refresh (mirrors google-oauth.json)\nRIPMAIL_GOOGLE_REFRESH_TOKEN={refresh_token}\n"
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
