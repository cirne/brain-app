//! Gmail API send over HTTPS (port 443) — for hosts where SMTP egress is blocked (e.g. DigitalOcean).

use base64::Engine;

const GMAIL_SEND_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_PROFILE_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

/// True when outbound mail should use Gmail REST API instead of SMTP (same OAuth token as XOAUTH2).
#[must_use]
pub fn should_send_via_gmail_api(
    imap_host: &str,
    imap_auth: crate::config::MailboxImapAuthKind,
) -> bool {
    imap_host.trim().eq_ignore_ascii_case("imap.gmail.com")
        && imap_auth == crate::config::MailboxImapAuthKind::GoogleOAuth
}

/// RFC 4648 base64url without padding (Gmail `raw` field).
pub fn base64url_raw_message(rfc822: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(rfc822);
    let mut s = b64.replace('+', "-").replace('/', "_");
    while s.ends_with('=') {
        s.pop();
    }
    s
}

/// POST `users.messages.send` with Bearer token; returns Gmail's JSON summary for logging.
pub fn send_raw_message_via_gmail_api(access_token: &str, rfc822: &[u8]) -> Result<String, String> {
    let raw = base64url_raw_message(rfc822);
    let body = serde_json::json!({ "raw": raw }).to_string();

    let resp = ureq::post(GMAIL_SEND_URL)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("Content-Type", "application/json")
        .send_string(&body)
        .map_err(|e| format!("Gmail API send (HTTP): {e}"))?;

    let status = resp.status();
    let text = resp
        .into_string()
        .map_err(|e| format!("Gmail API send: read body: {e}"))?;

    if status >= 400 {
        return Err(format!(
            "Gmail API send: HTTP {status} — {}",
            format_gmail_api_error_for_log(&text)
        ));
    }

    Ok(format_gmail_send_success_summary(&text))
}

/// GET `users/me/profile` — verifies token + Gmail API reachability without SMTP.
pub fn verify_gmail_api_access(access_token: &str) -> Result<(), String> {
    let resp = ureq::get(GMAIL_PROFILE_URL)
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .map_err(|e| format!("Gmail API profile (HTTP): {e}"))?;

    let status = resp.status();
    let text = resp
        .into_string()
        .map_err(|e| format!("Gmail API profile: read body: {e}"))?;

    if status >= 400 {
        return Err(format!(
            "Gmail API profile: HTTP {status} — {}",
            format_gmail_api_error_for_log(&text)
        ));
    }

    Ok(())
}

fn format_gmail_send_success_summary(json_text: &str) -> String {
    let v: serde_json::Value =
        serde_json::from_str(json_text).unwrap_or(serde_json::Value::String(json_text.to_string()));
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("");
    let thread_id = v.get("threadId").and_then(|x| x.as_str()).unwrap_or("");
    if id.is_empty() && thread_id.is_empty() {
        format!("gmail_api_ok body={json_text}")
    } else {
        format!("gmail_api_ok id={id} threadId={thread_id}")
    }
}

fn format_gmail_api_error_for_log(body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
        let msg = v
            .pointer("/error/message")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let status_name = v
            .pointer("/error/status")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let reason = v
            .pointer("/error/errors/0/reason")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let pieces: Vec<&str> = [msg, status_name, reason]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect();
        if !pieces.is_empty() {
            return pieces.join("; ");
        }
    }
    truncate_body_for_log(body)
}

fn truncate_body_for_log(s: &str) -> String {
    const MAX: usize = 500;
    if s.len() <= MAX {
        s.to_string()
    } else {
        format!("{}…", &s[..MAX])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_known_vector() {
        // "Hello" -> SGVsbG8 -> base64url unchanged for this ASCII
        assert_eq!(base64url_raw_message(b"Hello"), "SGVsbG8");
    }

    #[test]
    fn base64url_strips_padding() {
        let raw = b"f";
        let u = base64url_raw_message(raw);
        assert!(!u.contains('='), "got {u}");
    }

    #[test]
    fn should_send_helpers() {
        use crate::config::MailboxImapAuthKind;
        assert!(should_send_via_gmail_api(
            "imap.gmail.com",
            MailboxImapAuthKind::GoogleOAuth
        ));
        assert!(should_send_via_gmail_api(
            "IMAP.GMAIL.COM",
            MailboxImapAuthKind::GoogleOAuth
        ));
        assert!(!should_send_via_gmail_api(
            "imap.gmail.com",
            MailboxImapAuthKind::AppPassword
        ));
        assert!(!should_send_via_gmail_api(
            "imap.fastmail.com",
            MailboxImapAuthKind::GoogleOAuth
        ));
    }

    #[test]
    fn format_error_prefers_json_fields() {
        let j = r#"{"error":{"code":403,"message":"nope","status":"PERMISSION_DENIED","errors":[{"reason":"forbidden"}]}}"#;
        let s = format_gmail_api_error_for_log(j);
        assert!(s.contains("nope"), "{s}");
    }

    #[test]
    fn format_success_summary() {
        let j = r#"{"id":"abc123","threadId":"th456","labelIds":["SENT"]}"#;
        let s = format_gmail_send_success_summary(j);
        assert!(s.contains("abc123") && s.contains("th456"), "{s}");
    }
}
