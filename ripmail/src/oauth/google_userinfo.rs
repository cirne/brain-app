//! Resolve the Google account email after OAuth (hosted / browser-first flows).

use serde::Deserialize;

use crate::observability::otel;

const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

#[derive(Debug, Clone, thiserror::Error)]
pub enum GoogleUserinfoError {
    #[error("Google userinfo HTTP {0}: {1}")]
    Http(u16, String),
    #[error("Google userinfo: {0}")]
    Transport(String),
    #[error("Google did not return an email for this account")]
    MissingEmail,
}

#[derive(Debug, Deserialize)]
struct UserInfoBody {
    email: Option<String>,
}

pub fn fetch_google_account_email(access_token: &str) -> Result<String, GoogleUserinfoError> {
    otel::with_http_client_span("google.oauth2.userinfo", "GET", GOOGLE_USERINFO_URL, || {
        let resp = ureq::get(GOOGLE_USERINFO_URL)
            .set("Authorization", &format!("Bearer {access_token}"))
            .call()
            .map_err(|e| GoogleUserinfoError::Transport(e.to_string()))?;
        let status = resp.status();
        let body = resp
            .into_string()
            .map_err(|e| GoogleUserinfoError::Transport(e.to_string()))?;
        if !(200..300).contains(&status) {
            return Err(GoogleUserinfoError::Http(status, body));
        }
        let j: UserInfoBody = serde_json::from_str(&body)
            .map_err(|e| GoogleUserinfoError::Transport(e.to_string()))?;
        let email = j
            .email
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .ok_or(GoogleUserinfoError::MissingEmail)?;
        Ok((email, status))
    })
}
