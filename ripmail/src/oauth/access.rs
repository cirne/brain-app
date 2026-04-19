//! Obtain a valid Google access token for IMAP/SMTP (refresh when expired).

use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::client::{resolve_google_oauth_client_with_diagnostics, GoogleOAuthClientSettings};
use super::token_http::{refresh_access_token, TokenHttpError};
use super::token_store::{
    google_oauth_token_path, load_google_oauth_token_store_for_mailbox,
    save_google_oauth_token_store, GoogleOAuthTokenStore,
};

/// Skew: refresh this many seconds before expiry.
const EXPIRY_SKEW_SECS: i64 = 120;

#[derive(Debug, thiserror::Error)]
pub enum GoogleAccessTokenError {
    #[error("no Google OAuth token store for this mailbox; run `ripmail setup --google-oauth` or the wizard")]
    MissingTokenStore,
    #[error("OAuth client configuration: {0}")]
    Client(#[from] super::client::GoogleOAuthClientError),
    #[error("token store: {0}")]
    Store(#[from] std::io::Error),
    #[error("token refresh: {0}")]
    Refresh(#[from] TokenHttpError),
}

fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn access_token_still_valid(store: &GoogleOAuthTokenStore) -> bool {
    let Some(ref tok) = store.access_token else {
        return false;
    };
    if tok.is_empty() {
        return false;
    }
    let Some(exp) = store.access_token_expires_at else {
        return false;
    };
    now_epoch_secs() < exp - EXPIRY_SKEW_SECS
}

/// Return a valid access token, refreshing and persisting when needed.
pub fn ensure_google_access_token(
    home: &Path,
    mailbox_id: &str,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
) -> Result<String, GoogleAccessTokenError> {
    let path = google_oauth_token_path(home, mailbox_id);
    let mut store = load_google_oauth_token_store_for_mailbox(home, mailbox_id)
        .map_err(|_| GoogleAccessTokenError::MissingTokenStore)?;
    if access_token_still_valid(&store) {
        return Ok(store.access_token.clone().unwrap());
    }

    eprintln!(
        "ripmail: access token expired or missing, refreshing for {}...",
        mailbox_id
    );
    let settings = resolve_google_oauth_client_with_diagnostics(Some(home), env_file, process_env)?;
    refresh_and_persist(&settings, &path, &mut store)?;
    Ok(store.access_token.unwrap_or_default())
}

fn refresh_and_persist(
    settings: &GoogleOAuthClientSettings,
    path: &Path,
    store: &mut GoogleOAuthTokenStore,
) -> Result<(), GoogleAccessTokenError> {
    let resp = refresh_access_token(settings, &store.refresh_token)?;
    store.access_token = Some(resp.access_token);
    if let Some(sec) = resp.expires_in {
        store.access_token_expires_at = Some(now_epoch_secs() + sec as i64);
    }
    if let Some(new_rt) = resp.refresh_token {
        if !new_rt.is_empty() {
            store.refresh_token = new_rt;
        }
    }
    save_google_oauth_token_store(path, store)?;
    Ok(())
}
