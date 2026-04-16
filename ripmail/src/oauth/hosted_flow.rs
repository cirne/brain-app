//! Google OAuth via ripmail-hosted redirect relay + CLI polling (optional [`crate::setup::write_google_oauth_setup_hosted`]).

use std::time::{Duration, Instant};

use serde::Deserialize;

use super::client::GoogleOAuthClientSettings;
use super::google_flow::{google_authorize_url, open_browser, random_state};

/// Mail + OpenID + email so the CLI can learn the mailbox address from Google (no prompt before browser).
const GOOGLE_HOSTED_SCOPES: &str = "https://mail.google.com/ openid email";
use super::pkce::{code_challenge_s256, new_code_verifier};
use super::token_http::{exchange_authorization_code, TokenEndpointResponse, TokenHttpError};

const POLL_INTERVAL: Duration = Duration::from_millis(800);
const POLL_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Deserialize)]
struct PollJson {
    status: String,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum GoogleOAuthHostedError {
    #[error("OAuth relay base URL is invalid: {0}")]
    BadRelayBase(String),
    #[error("browser open failed: {0}")]
    Browser(String),
    #[error("OAuth redirect error: {0} ({1})")]
    ProviderError(String, String),
    #[error("relay poll: {0}")]
    Poll(String),
    #[error("relay did not return an authorization code")]
    MissingCode,
    #[error("state mismatch (possible CSRF)")]
    StateMismatch,
    #[error("token exchange failed: {0}")]
    Token(#[from] TokenHttpError),
}

fn poll_url(relay_base: &str, state: &str) -> Result<String, GoogleOAuthHostedError> {
    let base = relay_base.trim_end_matches('/');
    if base.is_empty() {
        return Err(GoogleOAuthHostedError::BadRelayBase("empty".into()));
    }
    Ok(format!(
        "{}/v1/oauth/poll?state={}",
        base,
        urlencoding::encode(state)
    ))
}

fn poll_once(url: &str) -> Result<PollJson, String> {
    let resp = ureq::get(url)
        .timeout(Duration::from_secs(25))
        .call()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.into_string().map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("poll JSON: {e}: {body}"))
}

/// Browser opens Google; redirect hits ripmail relay; CLI polls relay for the code, then exchanges tokens.
pub fn run_google_oauth_hosted(
    settings: &GoogleOAuthClientSettings,
    relay_base: &str,
) -> Result<TokenEndpointResponse, GoogleOAuthHostedError> {
    let code_verifier = new_code_verifier();
    let code_challenge = code_challenge_s256(&code_verifier);
    let state = random_state();

    let url = google_authorize_url(settings, &code_challenge, &state, GOOGLE_HOSTED_SCOPES);
    open_browser(&url).map_err(|e| GoogleOAuthHostedError::Browser(format!("{e}")))?;

    let poll = poll_url(relay_base, &state)?;
    let deadline = Instant::now() + POLL_TIMEOUT;
    let mut auth_code = None::<String>;
    loop {
        if Instant::now() >= deadline {
            break;
        }
        match poll_once(&poll) {
            Ok(j) => match j.status.as_str() {
                "pending" => std::thread::sleep(POLL_INTERVAL),
                "ready" => {
                    if let Some(c) = j.code.filter(|s| !s.is_empty()) {
                        auth_code = Some(c);
                        break;
                    }
                    return Err(GoogleOAuthHostedError::MissingCode);
                }
                "error" => {
                    let e = j.error.unwrap_or_else(|| "unknown".into());
                    let desc = String::new();
                    return Err(GoogleOAuthHostedError::ProviderError(e, desc));
                }
                other => {
                    return Err(GoogleOAuthHostedError::Poll(format!(
                        "unexpected status {other}"
                    )));
                }
            },
            Err(_) => std::thread::sleep(POLL_INTERVAL),
        }
    }

    let Some(c) = auth_code else {
        return Err(GoogleOAuthHostedError::Poll(
            "timed out waiting for browser (relay did not receive redirect)".into(),
        ));
    };

    exchange_authorization_code(settings, &c, &code_verifier).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poll_url_encodes_state() {
        let u = poll_url("https://oauth.example.com", "abc/def").unwrap();
        assert!(u.contains("state="));
        assert!(u.contains("oauth.example.com"));
    }
}
