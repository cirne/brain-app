//! HTTPS calls to Google's token endpoint.

use serde::Deserialize;

use super::client::GoogleOAuthClientSettings;

#[derive(Debug, Deserialize)]
pub struct TokenEndpointResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub token_type: Option<String>,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum TokenHttpError {
    #[error("token endpoint HTTP {0}: {1}")]
    Http(u16, String),
    #[error("token endpoint: {0}")]
    Transport(String),
    #[error("token response JSON: {0}")]
    Json(String),
    #[error("OAuth error: {error} ({error_description})")]
    OAuth2 {
        error: String,
        error_description: String,
    },
}

#[derive(Debug, Deserialize)]
struct OAuth2ErrorBody {
    error: Option<String>,
    error_description: Option<String>,
}

pub fn exchange_authorization_code(
    settings: &GoogleOAuthClientSettings,
    code: &str,
    code_verifier: &str,
) -> Result<TokenEndpointResponse, TokenHttpError> {
    let body = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", settings.redirect_uri.as_str()),
        ("client_id", settings.client_id.as_str()),
        ("client_secret", settings.client_secret.as_str()),
        ("code_verifier", code_verifier),
    ];
    post_token(settings, &body)
}

pub fn refresh_access_token(
    settings: &GoogleOAuthClientSettings,
    refresh_token: &str,
) -> Result<TokenEndpointResponse, TokenHttpError> {
    let body = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", settings.client_id.as_str()),
        ("client_secret", settings.client_secret.as_str()),
        ("scope", "https://mail.google.com/ https://www.googleapis.com/auth/calendar.readonly openid email"),
    ];
    post_token(settings, &body)
}

fn post_token(
    settings: &GoogleOAuthClientSettings,
    pairs: &[(&str, &str)],
) -> Result<TokenEndpointResponse, TokenHttpError> {
    let encoded: String = pairs
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let resp = ureq::post(&settings.token_uri)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&encoded)
        .map_err(|e| TokenHttpError::Transport(e.to_string()))?;

    let status = resp.status();
    let text = resp
        .into_string()
        .map_err(|e| TokenHttpError::Transport(e.to_string()))?;

    if status >= 400 {
        eprintln!("ripmail: OAuth token error {} response: {}", status, text);
        if let Ok(err) = serde_json::from_str::<OAuth2ErrorBody>(&text) {
            return Err(TokenHttpError::OAuth2 {
                error: err.error.unwrap_or_else(|| "unknown".into()),
                error_description: err.error_description.unwrap_or_default(),
            });
        }
        return Err(TokenHttpError::Http(status, text));
    }

    let parsed: TokenEndpointResponse =
        serde_json::from_str(&text).map_err(|e| TokenHttpError::Json(e.to_string()))?;

    // Log the scopes returned if present (sometimes Google returns them in the token response)
    // Note: TokenEndpointResponse doesn't have a scope field yet, but we can check the raw text
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(scope) = v.get("scope").and_then(|s| s.as_str()) {
            eprintln!("ripmail: token issued with scopes: {}", scope);
        }
    }

    Ok(parsed)
}
