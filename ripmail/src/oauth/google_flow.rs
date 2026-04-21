//! Interactive browser OAuth: loopback redirect + token exchange.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use base64::Engine;
use rand::RngCore;

use super::client::GoogleOAuthClientSettings;
use super::pkce::{code_challenge_s256, new_code_verifier};
use super::token_http::{exchange_authorization_code, TokenEndpointResponse, TokenHttpError};

/// Gmail IMAP/SMTP only (use when the account email is already known, e.g. `ripmail setup --email`).
pub const GOOGLE_OAUTH_SCOPE_MAIL: &str = "https://mail.google.com/";
/// Mail + OpenID + email — needed to discover the mailbox address after browser sign-in (wizard Gmail OAuth path).
pub const GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL: &str = "https://mail.google.com/ openid email";
/// Gmail IMAP/SMTP + Google Calendar read ([OPP-053](../docs/opportunities/archive/OPP-053-local-gateway-calendar-and-beyond.md)).
pub const GOOGLE_OAUTH_SCOPE_MAIL_CALENDAR_READONLY: &str =
    "https://mail.google.com/ https://www.googleapis.com/auth/calendar.readonly";
/// Wizard path: mail + calendar read + OpenID email discovery.
pub const GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_READONLY: &str =
    "https://mail.google.com/ https://www.googleapis.com/auth/calendar.readonly openid email";
const OAUTH_STATE_LEN: usize = 16;

#[derive(Debug, thiserror::Error)]
pub enum GoogleOAuthInteractiveError {
    #[error("invalid redirect URI (need http://host:port/path): {0}")]
    BadRedirect(String),
    #[error("could not bind loopback listener: {0}")]
    Bind(String),
    #[error("browser open failed: {0}")]
    Browser(String),
    #[error("OAuth redirect error: {0} ({1})")]
    ProviderError(String, String),
    #[error("missing authorization code in redirect")]
    MissingCode,
    #[error("state mismatch (possible CSRF)")]
    StateMismatch,
    #[error("token exchange failed: {0}")]
    Token(#[from] TokenHttpError),
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
}

/// Parse `http://127.0.0.1:8765/oauth/callback` into host, port, path (starts with `/`).
fn parse_loopback_redirect(
    redirect_uri: &str,
) -> Result<(String, u16, String), GoogleOAuthInteractiveError> {
    let u = redirect_uri.trim();
    let rest = u
        .strip_prefix("http://")
        .or_else(|| u.strip_prefix("https://"))
        .ok_or_else(|| GoogleOAuthInteractiveError::BadRedirect(redirect_uri.to_string()))?;

    let (host_port, path_part) = match rest.split_once('/') {
        Some((hp, p)) if !p.is_empty() => (hp, format!("/{}", p.trim_end_matches('/'))),
        Some((hp, _)) => (hp, "/".to_string()),
        None => (rest, "/".to_string()),
    };

    let (host, port_s) = host_port
        .rsplit_once(':')
        .ok_or_else(|| GoogleOAuthInteractiveError::BadRedirect(redirect_uri.to_string()))?;
    let port: u16 = port_s
        .parse()
        .map_err(|_| GoogleOAuthInteractiveError::BadRedirect(redirect_uri.to_string()))?;
    Ok((host.to_string(), port, path_part))
}

pub(crate) fn random_state() -> String {
    let mut buf = [0u8; OAUTH_STATE_LEN];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

pub(crate) fn open_browser(url: &str) -> Result<(), GoogleOAuthInteractiveError> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .status()
            .map_err(|e| GoogleOAuthInteractiveError::Browser(e.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        for cmd in ["xdg-open", "gio", "gnome-open"] {
            if std::process::Command::new(cmd)
                .arg(url)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
            {
                return Ok(());
            }
        }
        Err(GoogleOAuthInteractiveError::Browser(
            "no xdg-open/gio/gnome-open".into(),
        ))
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .status()
            .map_err(|e| GoogleOAuthInteractiveError::Browser(e.to_string()))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = url;
        Err(GoogleOAuthInteractiveError::Browser(
            "unsupported OS: open URL manually".into(),
        ))
    }
}

pub(crate) fn google_authorize_url(
    settings: &GoogleOAuthClientSettings,
    code_challenge: &str,
    state: &str,
    scope: &str,
) -> String {
    let auth_base = settings.auth_uri.trim().to_string();
    let q = format!(
        "client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        urlencoding::encode(&settings.client_id),
        urlencoding::encode(&settings.redirect_uri),
        urlencoding::encode(scope),
        urlencoding::encode(state),
        urlencoding::encode(code_challenge),
    );
    format!("{auth_base}?{q}")
}

/// Run browser login: loopback redirect, then exchange code for tokens.
///
/// `scope` is typically [`GOOGLE_OAUTH_SCOPE_MAIL`] or [`GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL`].
pub fn run_google_oauth_interactive(
    settings: &GoogleOAuthClientSettings,
    scope: &str,
) -> Result<TokenEndpointResponse, GoogleOAuthInteractiveError> {
    let code_verifier = new_code_verifier();
    let code_challenge = code_challenge_s256(&code_verifier);
    let state = random_state();

    let (host, port, path) = parse_loopback_redirect(&settings.redirect_uri)?;

    let listener = TcpListener::bind((host.as_str(), port))
        .map_err(|e| GoogleOAuthInteractiveError::Bind(e.to_string()))?;
    listener
        .set_nonblocking(false)
        .map_err(GoogleOAuthInteractiveError::Io)?;

    let url = google_authorize_url(settings, &code_challenge, &state, scope);

    open_browser(&url)?;

    let (mut stream, _) = listener
        .accept()
        .map_err(|e| GoogleOAuthInteractiveError::Bind(e.to_string()))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf)?;
    let req = String::from_utf8_lossy(&buf[..n]);

    let line = req.lines().next().unwrap_or("");
    let path_and_query = line
        .strip_prefix("GET ")
        .and_then(|s| s.split_whitespace().next())
        .ok_or(GoogleOAuthInteractiveError::MissingCode)?;

    let query = path_and_query
        .find('?')
        .map(|i| &path_and_query[i + 1..])
        .unwrap_or("");

    let mut code = None::<String>;
    let mut ret_state = None::<String>;
    let mut err = None::<String>;
    let mut err_desc = None::<String>;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            match k {
                "code" => code = Some(urlencoding::decode(v).unwrap_or_default().into_owned()),
                "state" => {
                    ret_state = Some(urlencoding::decode(v).unwrap_or_default().into_owned())
                }
                "error" => err = Some(urlencoding::decode(v).unwrap_or_default().into_owned()),
                "error_description" => {
                    err_desc = Some(urlencoding::decode(v).unwrap_or_default().into_owned())
                }
                _ => {}
            }
        }
    }

    let body_ok: &[u8] = br#"<!DOCTYPE html><html><body><p>ripmail: signed in. You can close this tab.</p></body></html>"#;
    let body_err: &[u8] = br#"<!DOCTYPE html><html><body><p>ripmail: authorization failed. See the terminal.</p></body></html>"#;
    let (status_line, body): (&str, &[u8]) = if err.is_some() {
        ("HTTP/1.1 400 Bad Request\r\n", body_err)
    } else {
        ("HTTP/1.1 200 OK\r\n", body_ok)
    };
    let response = format!(
        "{}Content-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status_line,
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(body);

    if let Some(e) = err {
        return Err(GoogleOAuthInteractiveError::ProviderError(
            e,
            err_desc.unwrap_or_default(),
        ));
    }

    let Some(c) = code else {
        return Err(GoogleOAuthInteractiveError::MissingCode);
    };
    if ret_state.as_deref() != Some(&state) {
        return Err(GoogleOAuthInteractiveError::StateMismatch);
    }

    // Path check: allow if request path prefix matches (ignore query)
    let req_path = path_and_query.split('?').next().unwrap_or("");
    if req_path != path && !path.is_empty() && path != "/" {
        // Some clients send path without trailing match — require prefix
        if !req_path.starts_with(path.trim_end_matches('/')) {
            return Err(GoogleOAuthInteractiveError::BadRedirect(format!(
                "path got {req_path} expected {path}"
            )));
        }
    }

    exchange_authorization_code(settings, &c, &code_verifier).map_err(Into::into)
}
