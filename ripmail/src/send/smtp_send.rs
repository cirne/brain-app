//! Outbound send: SMTP via lettre for most providers; Gmail + OAuth uses Gmail API HTTPS (`users.messages.send`).

use std::collections::HashMap;

use crate::config::{Config, MailboxImapAuthKind, ResolvedSmtp};
use crate::oauth::ensure_google_access_token;
use crate::send::draft_body::plain_to_minimal_html;
use crate::send::gmail_api_send::{
    send_raw_message_via_gmail_api, should_send_via_gmail_api, verify_gmail_api_access,
};
use crate::send::recipients::assert_send_recipients_allowed;
use lettre::message::{Mailbox, Message, MultiPart};
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::{SmtpTransport, Transport};
use uuid::Uuid;

/// SMTP verify (Node nodemailer `transport.verify()`). Uses same resolution as send path.
pub fn verify_smtp_credentials(imap_host: &str, user: &str, pass: &str) -> Result<(), String> {
    let smtp = crate::config::resolve_smtp_settings(imap_host, None)?;
    let creds = Credentials::new(user.to_string(), pass.to_string());
    let transport = build_smtp_transport_plain(&smtp, creds).map_err(|e| e.to_string())?;
    transport.test_connection().map_err(|e| e.to_string())?;
    Ok(())
}

/// SMTP verify for the loaded config (app password or Google OAuth).
pub fn verify_smtp_for_config(cfg: &Config) -> Result<(), String> {
    match cfg.imap_auth {
        MailboxImapAuthKind::AppPassword => {
            let creds = Credentials::new(cfg.imap_user.clone(), cfg.imap_password.clone());
            let transport =
                build_smtp_transport_plain(&cfg.smtp, creds).map_err(|e| e.to_string())?;
            transport.test_connection().map_err(|e| e.to_string())?;
            Ok(())
        }
        MailboxImapAuthKind::GoogleOAuth => {
            let env_file = crate::config::read_ripmail_env_file(&cfg.ripmail_home);
            let process_env: HashMap<String, String> = std::env::vars().collect();
            let tok = ensure_google_access_token(
                &cfg.ripmail_home,
                &cfg.source_id,
                &env_file,
                &process_env,
            )
            .map_err(|e| e.to_string())?;
            if should_send_via_gmail_api(&cfg.imap_host, cfg.imap_auth) {
                verify_gmail_api_access(&tok)?;
                return Ok(());
            }
            let creds = Credentials::new(cfg.imap_user.clone(), tok);
            let transport =
                build_smtp_transport_xoauth2(&cfg.smtp, creds).map_err(|e| e.to_string())?;
            transport.test_connection().map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

#[derive(Debug, Clone)]
pub struct SendSimpleFields {
    pub to: Vec<String>,
    pub cc: Option<Vec<String>>,
    pub bcc: Option<Vec<String>>,
    pub subject: String,
    pub text: String,
    /// When `Some`, used as the `text/html` part (e.g. [`crate::send::draft_body::draft_markdown_to_html`] for drafts).
    /// When `None`, HTML is a minimal document derived from the normalized plain body (CLI ad-hoc send).
    pub html: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub ok: bool,
    #[serde(serialize_with = "crate::ids::serialize_string_id_for_json")]
    pub message_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smtp_response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
    /// When sending a reply/forward draft, nudges archiving the indexed source message.
    #[serde(default)]
    pub hints: Vec<String>,
}

fn generate_outbound_message_id(from_email: &str) -> String {
    let domain = from_email.split('@').nth(1).unwrap_or("localhost").trim();
    format!("<ripmail-{}@{}>", Uuid::new_v4(), domain)
}

/// Interprets JSON/shell-style backslash escapes in the plain body so recipients do not see
/// literal two-character `\n` sequences. `\\` becomes one backslash (so `\\n` stays a visible
/// `\` + `n` when that was intended).
fn normalize_smtp_plain_body(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut it = text.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.peek().copied() {
            Some('\\') => {
                it.next();
                out.push('\\');
            }
            Some('n') => {
                it.next();
                out.push('\n');
            }
            Some('r') => {
                it.next();
                out.push('\r');
            }
            Some('t') => {
                it.next();
                out.push('\t');
            }
            _ => out.push('\\'),
        }
    }
    out
}

fn parse_mailbox(addr: &str) -> Result<Mailbox, String> {
    let s = addr.trim();
    if s.is_empty() {
        return Err("empty address".into());
    }
    s.parse::<Mailbox>()
        .map_err(|e| format!("invalid address {addr:?}: {e}"))
}

fn smtp_endpoint_label(smtp: &ResolvedSmtp) -> String {
    format!("{}:{}", smtp.host, smtp.port)
}

fn build_smtp_transport_plain(
    smtp: &ResolvedSmtp,
    creds: Credentials,
) -> Result<SmtpTransport, lettre::transport::smtp::Error> {
    let builder = if smtp.secure {
        SmtpTransport::relay(&smtp.host)?
    } else {
        SmtpTransport::starttls_relay(&smtp.host)?
    };
    Ok(builder.credentials(creds).port(smtp.port).build())
}

fn build_smtp_transport_xoauth2(
    smtp: &ResolvedSmtp,
    creds: Credentials,
) -> Result<SmtpTransport, lettre::transport::smtp::Error> {
    let builder = if smtp.secure {
        SmtpTransport::relay(&smtp.host)?
    } else {
        SmtpTransport::starttls_relay(&smtp.host)?
    };
    Ok(builder
        .credentials(creds)
        .authentication(vec![Mechanism::Xoauth2])
        .port(smtp.port)
        .build())
}

/// Send a plain-text message via SMTP (same credentials as IMAP).
pub fn send_simple_message(
    cfg: &Config,
    fields: &SendSimpleFields,
    dry_run: bool,
) -> Result<SendResult, String> {
    let mut all_recipients: Vec<String> = Vec::new();
    all_recipients.extend(fields.to.clone());
    if let Some(cc) = &fields.cc {
        all_recipients.extend(cc.clone());
    }
    if let Some(bcc) = &fields.bcc {
        all_recipients.extend(bcc.clone());
    }
    assert_send_recipients_allowed(&all_recipients)?;

    let user = cfg.imap_user.trim();
    if dry_run {
        let from_for_id = if user.is_empty() {
            "dry-run@localhost"
        } else {
            user
        };
        let outbound_id = generate_outbound_message_id(from_for_id);
        return Ok(SendResult {
            ok: true,
            message_id: outbound_id,
            smtp_response: None,
            dry_run: Some(true),
            hints: vec![],
        });
    }

    if user.is_empty() {
        return Err("Missing imap.user in config".into());
    }
    if cfg.imap_auth == MailboxImapAuthKind::AppPassword && cfg.imap_password.is_empty() {
        return Err("Missing RIPMAIL_IMAP_PASSWORD / imap.password".into());
    }

    // Apple Mail–only: local index (read/inbox) works; inferred SMTP is localhost:587 with no
    // listener until the user adds a real IMAP/Gmail source or sets `smtp` in config.json.
    if cfg.imap_host.trim().eq_ignore_ascii_case("local.applemail") {
        let h = cfg.smtp.host.trim();
        if h.eq_ignore_ascii_case("localhost") || h == "127.0.0.1" {
            return Err(
                "Cannot send: ripmail is using the Apple Mail (local) source only, which has no SMTP server (defaults to localhost:587). \
Inbox/search can work from Apple Mail alone; outbound mail needs a Gmail or IMAP account in the same ripmail home (Brain mail onboarding / `ripmail setup`), or an explicit smtp.host in config.json."
                    .into(),
            );
        }
    }

    eprintln!(
        "ripmail send: building MIME (to={}, cc={:?}, bcc={:?}, subject_len={}, body_len={})",
        fields.to.len(),
        fields.cc.as_ref().map(Vec::len),
        fields.bcc.as_ref().map(Vec::len),
        fields.subject.len(),
        fields.text.len(),
    );

    let outbound_id = generate_outbound_message_id(user);

    let from_mb = parse_mailbox(user)?;
    let mut builder = Message::builder()
        .from(from_mb.clone())
        .message_id(Some(outbound_id.clone()));

    for t in &fields.to {
        builder = builder.to(parse_mailbox(t)?);
    }
    if let Some(cc) = &fields.cc {
        for a in cc {
            builder = builder.cc(parse_mailbox(a)?);
        }
    }
    if let Some(bcc) = &fields.bcc {
        for a in bcc {
            builder = builder.bcc(parse_mailbox(a)?);
        }
    }

    if let Some(ref irt) = fields.in_reply_to {
        let v = irt.trim();
        if !v.is_empty() {
            builder = builder.in_reply_to(v.to_string());
        }
    }
    if let Some(ref refs) = fields.references {
        let v = refs.trim();
        if !v.is_empty() {
            builder = builder.references(v.to_string());
        }
    }

    let plain_body = normalize_smtp_plain_body(&fields.text);
    let html_part = fields
        .html
        .as_ref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.as_str().to_string())
        .unwrap_or_else(|| plain_to_minimal_html(&plain_body));
    let alt = MultiPart::alternative_plain_html(plain_body, html_part);
    let email = builder
        .subject(&fields.subject)
        .multipart(alt)
        .map_err(|e| format!("message build: {e}"))?;

    // Gmail + OAuth: send via Gmail API (HTTPS :443). SMTP to smtp.gmail.com:587 is blocked on some hosts (e.g. DigitalOcean).
    if should_send_via_gmail_api(&cfg.imap_host, cfg.imap_auth) {
        eprintln!("ripmail send: fetching Google OAuth access token for Gmail API...");
        let env_file = crate::config::read_ripmail_env_file(&cfg.ripmail_home);
        let process_env: HashMap<String, String> = std::env::vars().collect();
        let tok =
            ensure_google_access_token(&cfg.ripmail_home, &cfg.source_id, &env_file, &process_env)
                .map_err(|e| format!("OAuth: {e}"))?;
        let raw = email.formatted();
        eprintln!("ripmail send: sending message via Gmail API (HTTPS, users.messages.send)...");
        let api_summary = send_raw_message_via_gmail_api(&tok, &raw)?;
        return Ok(SendResult {
            ok: true,
            message_id: outbound_id,
            smtp_response: Some(api_summary),
            dry_run: None,
            hints: vec![],
        });
    }

    let endpoint = smtp_endpoint_label(&cfg.smtp);
    eprintln!(
        "ripmail send: SMTP endpoint {} (implicit_tls={}, auth={:?})",
        endpoint, cfg.smtp.secure, cfg.imap_auth
    );

    let transport = match cfg.imap_auth {
        MailboxImapAuthKind::AppPassword => {
            eprintln!("ripmail send: constructing SMTP transport (app password)...");
            let creds = Credentials::new(user.to_string(), cfg.imap_password.clone());
            build_smtp_transport_plain(&cfg.smtp, creds).map_err(|e| {
                format!(
                    "SMTP transport ({endpoint}, STARTTLS={}): {e}",
                    !cfg.smtp.secure
                )
            })?
        }
        MailboxImapAuthKind::GoogleOAuth => {
            eprintln!("ripmail send: fetching Google OAuth access token for SMTP...");
            let env_file = crate::config::read_ripmail_env_file(&cfg.ripmail_home);
            let process_env: HashMap<String, String> = std::env::vars().collect();
            let tok = ensure_google_access_token(
                &cfg.ripmail_home,
                &cfg.source_id,
                &env_file,
                &process_env,
            )
            .map_err(|e| format!("OAuth: {e}"))?;
            eprintln!("ripmail send: OAuth token received; constructing XOAUTH2 transport...");
            let creds = Credentials::new(user.to_string(), tok);
            build_smtp_transport_xoauth2(&cfg.smtp, creds).map_err(|e| {
                format!(
                    "SMTP transport ({endpoint}, STARTTLS={}): {e}",
                    !cfg.smtp.secure
                )
            })?
        }
    };

    eprintln!(
        "ripmail send: sending message via SMTP to {endpoint} (blocks until server responds)..."
    );
    let response = transport
        .send(&email)
        .map_err(|e| format!("SMTP send ({endpoint}): {e}"))?;

    Ok(SendResult {
        ok: true,
        message_id: outbound_id,
        smtp_response: Some(format!("{response:?}")),
        dry_run: None,
        hints: vec![],
    })
}

/// Decode the formatted wire message the same way recipients / `ripmail read` do (handles QP, etc.).
#[cfg(test)]
fn decoded_plain_body_from_formatted_message(raw: &[u8]) -> String {
    use mail_parser::MessageParser;
    let Some(parsed) = MessageParser::default().parse(raw) else {
        return String::from_utf8_lossy(raw).into_owned();
    };
    parsed
        .body_text(0)
        .map(|cow| cow.into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
fn decoded_html_body_from_formatted_message(raw: &[u8]) -> String {
    use mail_parser::MessageParser;
    let Some(parsed) = MessageParser::default().parse(raw) else {
        return String::new();
    };
    parsed
        .body_html(0)
        .map(|cow| cow.into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{resolve_smtp_settings, Config, MailboxImapAuthKind};
    use crate::send::draft_body::{draft_markdown_to_html, draft_markdown_to_plain_text};
    use lettre::message::header::ContentType;
    use lettre::message::SinglePart;

    fn test_config() -> Config {
        let smtp = resolve_smtp_settings("imap.gmail.com", None).unwrap();
        Config {
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            imap_user: "a@b.com".into(),
            imap_aliases: vec![],
            imap_password: "secret".into(),
            imap_auth: MailboxImapAuthKind::AppPassword,
            smtp,
            sync_default_since: "1y".into(),
            sync_mailbox: String::new(),
            sync_exclude_labels: vec![],
            attachments_cache_extracted_text: false,
            inbox_default_window: "24h".into(),
            inbox_bootstrap_archive_older_than: "1d".into(),
            mailbox_management_enabled: false,
            mailbox_management_allow_archive: false,
            ripmail_home: std::path::PathBuf::from("/tmp"),
            data_dir: std::path::PathBuf::from("/tmp"),
            db_path: std::path::PathBuf::from("/tmp/z.db"),
            maildir_path: std::path::PathBuf::from("/tmp/m"),
            message_path_root: std::path::PathBuf::from("/tmp"),
            source_id: "a_b_com".into(),
            resolved_sources: vec![],
        }
    }

    /// `multipart/alternative` with markdown-derived plain+HTML round-trips through `mail_parser`.
    #[test]
    fn formatted_multipart_alternative_plain_and_html() {
        let from_mb: Mailbox = "sender@example.com".parse().unwrap();
        let to_mb: Mailbox = "recipient@example.com".parse().unwrap();
        let body_md = "Hi [link](https://a.test/v)\n\nSecond paragraph.";
        let plain = draft_markdown_to_plain_text(body_md);
        let html = draft_markdown_to_html(body_md);
        let email = Message::builder()
            .from(from_mb)
            .to(to_mb)
            .message_id(Some("<multipart-alternative-roundtrip@example.com>".into()))
            .subject("multipart test")
            .multipart(MultiPart::alternative_plain_html(plain.clone(), html))
            .expect("build message");
        let raw = email.formatted();
        let raw_str = String::from_utf8_lossy(&raw);
        assert!(
            raw_str
                .to_ascii_lowercase()
                .contains("multipart/alternative"),
            "expected multipart; got: {}",
            raw_str.lines().take(20).collect::<Vec<_>>().join("\n")
        );
        let dec_plain = super::decoded_plain_body_from_formatted_message(&raw);
        let dec_html = super::decoded_html_body_from_formatted_message(&raw);
        let dec_plain_lf = dec_plain.replace("\r\n", "\n").trim().to_string();
        assert_eq!(dec_plain_lf, plain, "plain part round-trip");
        assert!(
            dec_html.contains("https://a.test/v") && dec_html.contains("<a "),
            "html part; got: {}",
            &dec_html[..dec_html.len().min(500)]
        );
    }

    #[test]
    fn dry_run_no_network() {
        let cfg = test_config();
        let r = send_simple_message(
            &cfg,
            &SendSimpleFields {
                to: vec!["x@y.com".into()],
                cc: None,
                bcc: None,
                subject: "s".into(),
                text: "t".into(),
                html: None,
                in_reply_to: None,
                references: None,
            },
            true,
        )
        .unwrap();
        assert!(r.ok);
        assert!(r.message_id.starts_with("<ripmail-"));
        assert_eq!(r.dry_run, Some(true));
    }

    #[test]
    fn applemail_only_inferred_smtp_fails_fast_with_clear_error() {
        let mut cfg = test_config();
        cfg.imap_host = "local.applemail".into();
        cfg.smtp = resolve_smtp_settings("local.applemail", None).unwrap();
        let r = send_simple_message(
            &cfg,
            &SendSimpleFields {
                to: vec!["x@y.com".into()],
                cc: None,
                bcc: None,
                subject: "s".into(),
                text: "t".into(),
                html: None,
                in_reply_to: None,
                references: None,
            },
            false,
        );
        let msg = r.expect_err("expected Apple Mail–only send to be rejected");
        assert!(
            msg.contains("Apple Mail") && msg.contains("localhost"),
            "unexpected message: {msg}"
        );
    }

    #[test]
    fn normalize_plain_body_turns_literal_backslash_n_into_newlines() {
        let s = normalize_smtp_plain_body(r"Hi,\n\nThanks.");
        assert_eq!(s, "Hi,\n\nThanks.");
        assert!(!s.contains("\\n"));
    }

    #[test]
    fn normalize_double_backslash_before_n_keeps_visible_backslash_n() {
        // `\\n` in the wire string → one backslash + letter n (intentional literal)
        let s = normalize_smtp_plain_body(r"type \\n for newline");
        assert_eq!(s, "type \\n for newline");
    }

    #[test]
    fn normalize_backslash_t_and_r() {
        assert_eq!(normalize_smtp_plain_body(r"a\tb"), "a\tb");
        assert_eq!(normalize_smtp_plain_body(r"a\rb"), "a\rb");
    }

    #[test]
    fn normalize_trailing_backslash_preserved() {
        assert_eq!(normalize_smtp_plain_body("foo\\"), "foo\\");
    }

    /// Long plain-text bodies use quoted-printable; soft line breaks must not swallow intentional
    /// blank lines between paragraphs (regression: `CLI.A second` with no newline).
    #[test]
    fn formatted_plain_body_preserves_paragraph_newlines_after_qp() {
        let plain = normalize_smtp_plain_body(
            "This is a short test message drafted with ripmail for self-delivery. It exists only to confirm that the local draft flow works end to end from the CLI.\n\nA second paragraph adds a bit more text so the message feels like a real note rather than a single line. Nothing here is confidential; you can delete it whenever you like.\n\nFinally, a third paragraph wraps things up. If you see this in your drafts folder or after a send, the pipeline did its job.",
        );
        let from_mb: Mailbox = "sender@example.com".parse().unwrap();
        let to_mb: Mailbox = "recipient@example.com".parse().unwrap();
        let email = Message::builder()
            .from(from_mb)
            .to(to_mb)
            .message_id(Some("<smtp-qp-newline-test@example.com>".into()))
            .subject("Test subject — ripmail")
            .singlepart(
                SinglePart::builder()
                    .header(ContentType::TEXT_PLAIN)
                    .body(plain.clone()),
            )
            .expect("build message");

        let raw = email.formatted();
        let raw_str = String::from_utf8_lossy(&raw);
        assert!(
            raw_str.contains("Content-Transfer-Encoding: quoted-printable"),
            "this regression targets QP-wrapped bodies; got headers: {}",
            raw_str.lines().take(25).collect::<Vec<_>>().join("\n")
        );
        assert!(
            !raw_str.contains("CLI=\r\n.A"),
            "QP must not soft-wrap between `CLI` and `.` — decoders join `=\\r\\n` and merge `CLI` + `.A` into one line, destroying the paragraph break"
        );

        let decoded = super::decoded_plain_body_from_formatted_message(&raw);
        let decoded_lf = decoded.replace("\r\n", "\n");
        assert!(
            !decoded_lf.contains("CLI.A second"),
            "paragraph boundary incorrectly merged (soft QP break); decoded body: {decoded:?}"
        );
        assert!(
            decoded_lf.contains("from the CLI.\n\nA second"),
            "expected blank line between first and second paragraph; decoded body: {decoded:?}"
        );
        assert!(
            decoded_lf.contains("like.\n\nFinally"),
            "expected blank line between second and third paragraph; decoded body: {decoded:?}"
        );
        assert_eq!(
            decoded_lf.trim_end_matches(['\r', '\n']),
            plain,
            "round-trip through lettre format + mail-parser decode must preserve plain text (incl. paragraph breaks)"
        );
    }

    /// BUG-041: draft/LLM sometimes leaves two-character `\n` in the string. Normalization must run
    /// before MIME; quoted-printable round-trip must still preserve the resulting real paragraphs.
    #[test]
    fn formatted_body_round_trips_literal_backslash_n_then_qp() {
        let first = format!(
            "This paragraph is padded so the message body uses quoted-printable (long ASCII line). {}",
            "x".repeat(96)
        );
        // Two-char `\` `n` sequences, not U+000A — typical JSON/shell artifact from upstream draft text.
        let wire_style = format!("{first}\\n\\nSecond paragraph after BUG-041-style escapes.");
        let plain = normalize_smtp_plain_body(&wire_style);
        assert!(
            !plain.contains("\\n"),
            "normalized body must not contain the two-char sequence backslash-n; got: {plain:?}"
        );
        assert!(
            plain.contains("\n\nSecond paragraph"),
            "expected real blank line before second paragraph; got: {plain:?}"
        );

        let from_mb: Mailbox = "sender@example.com".parse().unwrap();
        let to_mb: Mailbox = "recipient@example.com".parse().unwrap();
        let email = Message::builder()
            .from(from_mb)
            .to(to_mb)
            .message_id(Some("<smtp-bug041-qp-roundtrip@example.com>".into()))
            .subject("BUG-041 + QP regression")
            .singlepart(
                SinglePart::builder()
                    .header(ContentType::TEXT_PLAIN)
                    .body(plain.clone()),
            )
            .expect("build message");

        let raw = email.formatted();
        let raw_str = String::from_utf8_lossy(&raw);
        assert!(
            raw_str.contains("Content-Transfer-Encoding: quoted-printable"),
            "expected QP body for long ASCII; headers: {}",
            raw_str.lines().take(22).collect::<Vec<_>>().join("\n")
        );

        let decoded = super::decoded_plain_body_from_formatted_message(&raw);
        let decoded_lf = decoded.replace("\r\n", "\n");
        assert_eq!(
            decoded_lf.trim_end_matches(['\r', '\n']),
            plain,
            "BUG-041 normalize + QP encode + mail-parser decode must round-trip"
        );
    }
}
