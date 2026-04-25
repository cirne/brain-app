//! MIME parse → structured message (mirrors `src/sync/parse-message.ts`).

use std::collections::HashSet;

use mail_parser::{Address, Message, MessageParser, MessagePart, MimeHeaders, PartType};
use serde::{Deserialize, Serialize};

use crate::mail_category::{
    is_default_excluded_category, CATEGORY_AUTOMATED, CATEGORY_BULK, CATEGORY_LIST, CATEGORY_SPAM,
};
use crate::mime_decode::decode_rfc2047_header_line;
use crate::search::normalize_address;

#[derive(Debug, Clone, Copy)]
pub struct ParseMessageOptions {
    /// When false, skip attachment collection entirely (fast index path).
    pub include_attachments: bool,
    /// When true, fill `ParsedAttachment::content` from MIME bodies. When false, only
    /// `filename`, `mime_type`, and `size` are set (sync / rebuild index metadata).
    pub include_attachment_bytes: bool,
}

impl Default for ParseMessageOptions {
    fn default() -> Self {
        Self {
            include_attachments: true,
            include_attachment_bytes: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParsedAttachment {
    pub filename: String,
    pub mime_type: String,
    pub size: usize,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedMessage {
    pub message_id: String,
    pub from_address: String,
    pub from_name: Option<String>,
    pub to_addresses: Vec<String>,
    pub cc_addresses: Vec<String>,
    /// To header entries with optional display names (indexed for `ripmail who`).
    pub to_recipients: Vec<MailboxEntry>,
    pub cc_recipients: Vec<MailboxEntry>,
    pub subject: String,
    pub date: String,
    pub body_text: String,
    pub body_html: Option<String>,
    pub attachments: Vec<ParsedAttachment>,
    pub category: Option<String>,
    /// True when `In-Reply-To` or `References` is present (new composition vs reply/forward chain).
    pub is_reply: bool,
    /// Distinct recipient addresses on To + Cc (for small-group detection).
    pub recipient_count: i32,
    /// Mailing-list / bulk-like (headers + category); used to deboost `who` / received counts.
    pub list_like: bool,
}

/// One mailbox for JSON / text read output (`name` + `address`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub address: String,
}

/// How `ripmail read` (and callers) choose between `text/plain` and `text/html` for the displayed body.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ReadBodyPreference {
    /// Prefer HTML→markdown when plain is empty, a short stub vs HTML, or a dense one-line “wall” (same heuristic as indexing).
    #[default]
    Auto,
    /// Prefer the MIME `text/plain` part whenever it is non-empty (after trim). Use for agents / CLI when HTML→markdown is noisy; falls back to HTML only when plain is empty.
    PlainText,
}

/// Full envelope + body for `ripmail read` (single parse of raw `.eml`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadForCli {
    pub message_id: String,
    pub from: MailboxEntry,
    pub subject: String,
    pub date: String,
    pub to: Vec<MailboxEntry>,
    pub cc: Vec<MailboxEntry>,
    pub bcc: Vec<MailboxEntry>,
    pub reply_to: Vec<MailboxEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_reply_to: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<String>,
    /// `false` when To, Cc, and Bcc are all empty (e.g. omitted by provider or BCC-only copy).
    pub recipients_disclosed: bool,
    #[serde(rename = "body")]
    pub body_text: String,
    /// Raw MIME `text/html` when present (same source as indexing); omitted when there is no HTML part.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_html: Option<String>,
}

/// Email addresses in the same order as `collect_address_entries`.
pub fn addresses_from_mailbox_entries(entries: &[MailboxEntry]) -> Vec<String> {
    entries.iter().map(|e| e.address.clone()).collect()
}

fn strip_id_token(s: &str) -> String {
    s.trim().trim_matches(|c| c == '<' || c == '>').to_string()
}

/// `multipart/alternative` often has an empty or stub `text/plain` while the real copy lives in
/// `text/html` (e.g. Shopify / receipt email). In that case we must index the HTML-derived text or
/// `search` / `document_index` miss phrases that are visible in a mail client.
fn should_prefer_html_for_body(plain_trimmed: &str, html: &str) -> bool {
    if html.trim().is_empty() {
        return false;
    }
    if plain_trimmed.is_empty() {
        return true;
    }
    if html.len() < 400 {
        return false;
    }
    if plain_trimmed.len() < 200 && html.len() > plain_trimmed.len().saturating_mul(6) {
        return true;
    }
    // Long text/plain with almost no line breaks is usually a useless "wall" while the HTML part
    // has real structure (marketing / notices). Prefer HTML→markdown when HTML is meaningfully larger.
    let newline_count = plain_trimmed
        .as_bytes()
        .iter()
        .filter(|&&b| b == b'\n')
        .count();
    if plain_trimmed.len() >= 400
        && newline_count * 800 < plain_trimmed.len()
        && html.len() > plain_trimmed.len().saturating_mul(4) / 3
    {
        return true;
    }
    false
}

/// Chooses `body_text` and preserves original `text/html` for consumers that need it (forward, debug).
fn indexable_bodies(plain: Option<String>, html: Option<String>) -> (String, Option<String>) {
    indexable_bodies_with_preference(plain, html, ReadBodyPreference::Auto)
}

fn indexable_bodies_with_preference(
    plain: Option<String>,
    html: Option<String>,
    pref: ReadBodyPreference,
) -> (String, Option<String>) {
    // `mail-parser` may yield `Some("")` for a text/plain-only message; treat as no HTML.
    let html = html.filter(|h| !h.trim().is_empty());
    let Some(html) = html else {
        return (plain.unwrap_or_default(), None);
    };
    let plain_trim = plain.as_deref().map(str::trim).unwrap_or("");
    if pref == ReadBodyPreference::PlainText && !plain_trim.is_empty() {
        return (plain.unwrap(), Some(html));
    }
    if should_prefer_html_for_body(plain_trim, &html) {
        let md = htmd::convert(&html).unwrap_or_else(|_| html.clone());
        return (md, Some(html));
    }
    if plain_trim.is_empty() {
        let md = htmd::convert(&html).unwrap_or_else(|_| html.clone());
        return (md, Some(html));
    }
    (plain.unwrap(), Some(html))
}

/// `mail-parser` can expose a synthetic `text/html` of the form
/// `<html><body>…</body></html>` for an otherwise `text/plain`-only message. That is not a
/// distinct MIME `text/html` alternative: omit it so `ReadForCli::body_html` / JSON `bodyHtml`
/// stay unset and consumers fall back to plain `body`.
fn html_is_synthetic_minimal_body_echo(plain: &str, html: &str) -> bool {
    let p = plain.trim();
    if p.is_empty() {
        return false;
    }
    let s = html.trim();
    if s.len() > 16 * 1024 {
        return false;
    }
    let lo = s.to_ascii_lowercase();
    if !lo.contains("<html") || !lo.contains("<body") || !lo.contains("</body>") {
        return false;
    }
    if lo.contains("href=") || lo.contains("<a ") || lo.contains("img") || lo.contains("style=") {
        return false;
    }
    let Some(body_inner) = first_html_body_inner(s) else {
        return false;
    };
    if body_inner.contains('<') {
        return false;
    }
    body_inner.trim() == p
}

fn first_html_body_inner(html: &str) -> Option<&str> {
    let lo = html.to_ascii_lowercase();
    let i = lo.find("<body")?;
    let after_tag = html.get(i..)?;
    let rel = after_tag.find('>')? + 1;
    let inner_start = i + rel;
    let after_open = html.get(inner_start..)?;
    let end = after_open.to_ascii_lowercase().find("</body>")?;
    html.get(inner_start..inner_start + end)
}

fn extract_threading_from_headers(msg: &Message<'_>) -> (Option<String>, Vec<String>) {
    let mut in_reply = None;
    let mut refs = Vec::new();
    for (name, value) in msg.headers_raw() {
        let n = name.to_lowercase();
        if n == "in-reply-to" {
            let s = strip_id_token(value);
            if !s.is_empty() {
                in_reply = Some(s);
            }
        } else if n == "references" {
            for part in value.split_whitespace() {
                let s = strip_id_token(part);
                if !s.is_empty() {
                    refs.push(s);
                }
            }
        }
    }
    (in_reply, refs)
}

fn collect_address_entries(addr: Option<&Address<'_>>) -> Vec<MailboxEntry> {
    let Some(a) = addr else {
        return Vec::new();
    };
    match a {
        Address::List(v) => v
            .iter()
            .filter_map(|x| {
                let address = x.address.as_ref().map(|c| c.to_string())?;
                if address.is_empty() {
                    return None;
                }
                Some(MailboxEntry {
                    name: x
                        .name
                        .as_ref()
                        .map(|s| s.to_string())
                        .filter(|s| !s.is_empty()),
                    address,
                })
            })
            .collect(),
        Address::Group(g) => g
            .iter()
            .flat_map(|gr| gr.addresses.iter())
            .filter_map(|x| {
                let address = x.address.as_ref().map(|c| c.to_string())?;
                if address.is_empty() {
                    return None;
                }
                Some(MailboxEntry {
                    name: x
                        .name
                        .as_ref()
                        .map(|s| s.to_string())
                        .filter(|s| !s.is_empty()),
                    address,
                })
            })
            .collect(),
    }
}

fn classify_category(msg: &Message<'_>) -> Option<String> {
    let mut has_list_unsubscribe = false;
    let mut has_list_id = false;
    for (name, value) in msg.headers_raw() {
        let name = name.to_lowercase();
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if name == "list-unsubscribe" {
            has_list_unsubscribe = true;
            continue;
        }
        if name == "list-id" {
            has_list_id = true;
            continue;
        }
        if name == "precedence" {
            let v = value.to_lowercase();
            if matches!(v.as_str(), "junk") {
                return Some(CATEGORY_SPAM.to_string());
            }
            if matches!(v.as_str(), "auto") {
                return Some(CATEGORY_AUTOMATED.to_string());
            }
            if matches!(v.as_str(), "bulk") {
                return Some(CATEGORY_BULK.to_string());
            }
            if matches!(v.as_str(), "list") {
                return Some(CATEGORY_LIST.to_string());
            }
        }
        if name == "x-auto-response-suppress" {
            return Some(CATEGORY_AUTOMATED.to_string());
        }
    }
    if has_list_id || has_list_unsubscribe {
        return Some(CATEGORY_LIST.to_string());
    }
    None
}

fn count_distinct_recipients(to: &[String], cc: &[String]) -> i32 {
    let mut s = HashSet::new();
    for a in to.iter().chain(cc.iter()) {
        let t = a.trim();
        if !t.is_empty() {
            s.insert(normalize_address(t));
        }
    }
    s.len() as i32
}

/// List/bulk-like for `who` deboost: category and/or classic list headers.
fn computed_list_like(msg: &Message<'_>, category: Option<&str>) -> bool {
    if is_default_excluded_category(category) {
        return true;
    }
    for (name, value) in msg.headers_raw() {
        let n = name.to_lowercase();
        let v = value.trim();
        if v.is_empty() {
            continue;
        }
        if n == "list-id" {
            return true;
        }
        if n == "list-post" || n == "list-unsubscribe" {
            return true;
        }
        if n == "precedence" {
            let low = v.to_lowercase();
            if low == "bulk" || low == "list" || low == "junk" {
                return true;
            }
        }
    }
    false
}

fn list_like_from_raw_head(raw: &[u8]) -> bool {
    let Ok(s) = std::str::from_utf8(raw) else {
        return false;
    };
    let header_end = s
        .find("\r\n\r\n")
        .or_else(|| s.find("\n\n"))
        .unwrap_or(s.len());
    let head = &s[..header_end];
    for line in head.lines() {
        let line = line.trim_end_matches('\r');
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("list-id:") {
            let v = line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("");
            if !v.is_empty() {
                return true;
            }
        }
        if lower.starts_with("list-unsubscribe:") || lower.starts_with("list-post:") {
            return true;
        }
        if lower.starts_with("precedence:") {
            let v = line
                .split_once(':')
                .map(|(_, v)| v.trim().to_lowercase())
                .unwrap_or_default();
            if v == "bulk" || v == "list" || v == "junk" {
                return true;
            }
        }
    }
    false
}

/// When `filename` / `name` are missing (common for `Content-Disposition: attachment` without
/// parameters), still surface the part so agents can read it — matches BUG-036 / Node fallback.
fn fallback_attachment_filename(mime_type: &str, attachment_index: usize) -> String {
    let sub = mime_type
        .split_once('/')
        .map(|(_, s)| s.to_ascii_lowercase())
        .unwrap_or_else(|| "octet-stream".to_string());
    let ext = match sub.as_str() {
        "pdf" => "pdf",
        "zip" => "zip",
        "gzip" => "gz",
        "msword" => "doc",
        "vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "csv" => "csv",
        "plain" => "txt",
        "html" => "html",
        "octet-stream" => "bin",
        s if s.len() <= 32
            && s.chars()
                .all(|c| c.is_alphanumeric() || c == '-' || c == '.') =>
        {
            let t = s.trim_matches('.');
            if t.is_empty() {
                "bin"
            } else {
                t
            }
        }
        _ => "bin",
    };
    format!("attachment-{}.{}", attachment_index + 1, ext)
}

fn parsed_attachment_from_part(
    part: &MessagePart<'_>,
    attachment_index: usize,
    include_bytes: bool,
) -> Option<ParsedAttachment> {
    if part
        .content_disposition()
        .map(|d| d.is_inline())
        .unwrap_or(false)
    {
        return None;
    }
    let mime_type = part
        .content_type()
        .map(|ct| {
            ct.c_subtype
                .as_ref()
                .map(|st| format!("{}/{}", ct.c_type, st))
                .unwrap_or_else(|| ct.c_type.to_string())
        })
        .unwrap_or_else(|| "application/octet-stream".into());
    let filename = part
        .attachment_name()
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_attachment_filename(&mime_type, attachment_index));
    let (size, content) = match &part.body {
        PartType::Text(t) => {
            let b = t.as_bytes();
            let size = b.len();
            let content = if include_bytes {
                b.to_vec()
            } else {
                Vec::new()
            };
            (size, content)
        }
        PartType::Html(h) => {
            let b = h.as_bytes();
            let size = b.len();
            let content = if include_bytes {
                b.to_vec()
            } else {
                Vec::new()
            };
            (size, content)
        }
        PartType::Binary(b) | PartType::InlineBinary(b) => {
            let size = b.len();
            let content = if include_bytes {
                b.to_vec()
            } else {
                Vec::new()
            };
            (size, content)
        }
        _ => return None,
    };
    Some(ParsedAttachment {
        filename,
        mime_type,
        size,
        content,
    })
}

fn collect_attachments(msg: &Message<'_>, include_attachment_bytes: bool) -> Vec<ParsedAttachment> {
    let mut out = Vec::new();
    let mut seen_part_ids: HashSet<usize> = HashSet::new();

    for i in 0..msg.attachment_count() {
        let Some(part) = msg.attachment(i) else {
            continue;
        };
        seen_part_ids.insert(msg.attachments[i]);
        if let Some(pa) = parsed_attachment_from_part(part, i, include_attachment_bytes) {
            out.push(pa);
        }
    }

    // mail-parser sometimes omits parts from `attachments` (e.g. `Content-Disposition: attachment`
    // with no filename / name). Scan parts for explicit attachment dispositions.
    for (part_id, part) in msg.parts.iter().enumerate() {
        if seen_part_ids.contains(&part_id) {
            continue;
        }
        if part
            .content_disposition()
            .map(|d| d.is_inline())
            .unwrap_or(false)
        {
            continue;
        }
        let is_explicit_attachment = part
            .content_disposition()
            .map(|d| d.is_attachment())
            .unwrap_or(false);
        if !is_explicit_attachment {
            continue;
        }
        if !matches!(&part.body, PartType::Binary(_) | PartType::InlineBinary(_)) {
            continue;
        }
        if let Some(pa) = parsed_attachment_from_part(part, out.len(), include_attachment_bytes) {
            out.push(pa);
        }
    }

    out
}

/// Parse raw RFC822 bytes.
pub fn parse_raw_message(raw: &[u8]) -> ParsedMessage {
    parse_raw_message_with_options(raw, ParseMessageOptions::default())
}

/// Parse raw RFC822 bytes with optional heavyweight extraction controls.
pub fn parse_raw_message_with_options(raw: &[u8], options: ParseMessageOptions) -> ParsedMessage {
    let Some(msg) = MessageParser::default()
        .with_mime_headers()
        .with_date_headers()
        .with_address_headers()
        .parse(raw)
    else {
        let (in_reply, refs) = extract_threading_from_raw_bytes(raw);
        let is_reply = in_reply.is_some() || !refs.is_empty();
        return ParsedMessage {
            message_id: format!("<fallback-{}@local>", chrono::Utc::now().timestamp_millis()),
            from_address: String::new(),
            from_name: None,
            to_addresses: Vec::new(),
            cc_addresses: Vec::new(),
            to_recipients: Vec::new(),
            cc_recipients: Vec::new(),
            subject: String::new(),
            date: chrono::Utc::now().to_rfc3339(),
            body_text: String::from_utf8_lossy(raw).into_owned(),
            body_html: None,
            attachments: Vec::new(),
            category: None,
            is_reply,
            recipient_count: 0,
            list_like: list_like_from_raw_head(raw),
        };
    };

    let message_id = msg
        .message_id()
        .map(str::to_string)
        .unwrap_or_else(|| format!("<unknown-{}@local>", chrono::Utc::now().timestamp_millis()));

    let min_ts = chrono::DateTime::parse_from_rfc3339("1980-01-01T00:00:00Z")
        .unwrap()
        .timestamp();
    let max_ts = chrono::Utc::now().timestamp() + 86400;
    let date = msg.date().map_or_else(
        || chrono::Utc::now().to_rfc3339(),
        |d| {
            let ts = d.to_timestamp();
            if ts < min_ts || ts > max_ts {
                chrono::Utc::now().to_rfc3339()
            } else {
                // RFC3339 from mail-parser DateTime
                let s = d.to_rfc3339();
                chrono::DateTime::parse_from_rfc3339(&s)
                    .map(|dt| dt.with_timezone(&chrono::Utc).to_rfc3339())
                    .unwrap_or(s)
            }
        },
    );

    let (body_text, body_html) = indexable_bodies(
        msg.body_text(0).map(|t| t.into_owned()),
        msg.body_html(0).map(|h| h.into_owned()),
    );

    let from_address = msg
        .from()
        .and_then(|a| match a {
            Address::List(v) => v.first(),
            Address::Group(g) => g.first().and_then(|gr| gr.addresses.first()),
        })
        .and_then(|addr| addr.address.as_ref().map(|s| s.to_string()))
        .unwrap_or_default();

    let from_name = msg
        .from()
        .and_then(|a| match a {
            Address::List(v) => v.first(),
            Address::Group(g) => g.first().and_then(|gr| gr.addresses.first()),
        })
        .and_then(|addr| addr.name.as_ref().map(|s| s.to_string()));

    let category = classify_category(&msg);

    let to_recipients = collect_address_entries(msg.to());
    let cc_recipients = collect_address_entries(msg.cc());
    let to_addresses = addresses_from_mailbox_entries(&to_recipients);
    let cc_addresses = addresses_from_mailbox_entries(&cc_recipients);

    let (in_reply, refs) = extract_threading_from_headers(&msg);
    let is_reply = in_reply.is_some() || !refs.is_empty();
    let recipient_count = count_distinct_recipients(&to_addresses, &cc_addresses);
    let list_like = computed_list_like(&msg, category.as_deref());

    ParsedMessage {
        message_id,
        from_address,
        from_name,
        to_addresses,
        cc_addresses,
        to_recipients,
        cc_recipients,
        subject: decode_rfc2047_header_line(msg.subject().unwrap_or("")),
        date,
        body_text,
        body_html,
        attachments: if options.include_attachments {
            collect_attachments(&msg, options.include_attachment_bytes)
        } else {
            Vec::new()
        },
        category,
        is_reply,
        recipient_count,
        list_like,
    }
}

/// Parse only the fields needed for rebuild/search indexing.
pub fn parse_index_message(raw: &[u8]) -> ParsedMessage {
    parse_raw_message_with_options(
        raw,
        ParseMessageOptions {
            include_attachments: false,
            ..Default::default()
        },
    )
}

fn extract_threading_from_raw_bytes(raw: &[u8]) -> (Option<String>, Vec<String>) {
    let Ok(s) = std::str::from_utf8(raw) else {
        return (None, Vec::new());
    };
    let header_end = s
        .find("\r\n\r\n")
        .or_else(|| s.find("\n\n"))
        .unwrap_or(s.len());
    let head = &s[..header_end];
    let mut in_reply = None;
    let mut refs = Vec::new();
    for line in head.lines() {
        let line = line.trim_end_matches('\r');
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("in-reply-to:") {
            let v = line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("");
            let t = strip_id_token(v);
            if !t.is_empty() {
                in_reply = Some(t);
            }
        } else if lower.starts_with("references:") {
            let v = line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("");
            for part in v.split_whitespace() {
                let t = strip_id_token(part);
                if !t.is_empty() {
                    refs.push(t);
                }
            }
        }
    }
    (in_reply, refs)
}

/// Single-parse path for `ripmail read`: body plus To/Cc/Bcc/Reply-To and threading headers.
pub fn parse_read_full(raw: &[u8]) -> ReadForCli {
    parse_read_full_with_body_preference(raw, ReadBodyPreference::default())
}

/// Same as [`parse_read_full`], but controls plain vs HTML body selection (e.g. `--plain-body` for agents).
pub fn parse_read_full_with_body_preference(
    raw: &[u8],
    body_pref: ReadBodyPreference,
) -> ReadForCli {
    let Some(msg) = MessageParser::default()
        .with_mime_headers()
        .with_date_headers()
        .with_address_headers()
        .parse(raw)
    else {
        let p = parse_raw_message(raw);
        let (in_reply_to, references) = extract_threading_from_raw_bytes(raw);
        let to = p
            .to_addresses
            .iter()
            .map(|a| MailboxEntry {
                name: None,
                address: a.clone(),
            })
            .collect();
        let cc = p
            .cc_addresses
            .iter()
            .map(|a| MailboxEntry {
                name: None,
                address: a.clone(),
            })
            .collect();
        let recipients_disclosed = !p.to_addresses.is_empty() || !p.cc_addresses.is_empty();
        return ReadForCli {
            message_id: p.message_id,
            from: MailboxEntry {
                name: p.from_name,
                address: p.from_address,
            },
            subject: decode_rfc2047_header_line(&p.subject),
            date: p.date,
            to,
            cc,
            bcc: Vec::new(),
            reply_to: Vec::new(),
            in_reply_to,
            references,
            recipients_disclosed,
            body_text: p.body_text,
            body_html: p.body_html,
        };
    };

    let message_id = msg
        .message_id()
        .map(str::to_string)
        .unwrap_or_else(|| format!("<unknown-{}@local>", chrono::Utc::now().timestamp_millis()));

    let min_ts = chrono::DateTime::parse_from_rfc3339("1980-01-01T00:00:00Z")
        .unwrap()
        .timestamp();
    let max_ts = chrono::Utc::now().timestamp() + 86400;
    let date = msg.date().map_or_else(
        || chrono::Utc::now().to_rfc3339(),
        |d| {
            let ts = d.to_timestamp();
            if ts < min_ts || ts > max_ts {
                chrono::Utc::now().to_rfc3339()
            } else {
                let s = d.to_rfc3339();
                chrono::DateTime::parse_from_rfc3339(&s)
                    .map(|dt| dt.with_timezone(&chrono::Utc).to_rfc3339())
                    .unwrap_or(s)
            }
        },
    );

    let (body_text, body_html) = indexable_bodies_with_preference(
        msg.body_text(0).map(|t| t.into_owned()),
        msg.body_html(0).map(|h| h.into_owned()),
        body_pref,
    );

    read_for_cli_from_parsed_headers(&msg, message_id, date, body_text, body_html)
}

fn read_for_cli_from_parsed_headers<'m>(
    msg: &'m Message<'m>,
    message_id: String,
    date: String,
    body_text: String,
    body_html: Option<String>,
) -> ReadForCli {
    let from_address = msg
        .from()
        .and_then(|a| match a {
            Address::List(v) => v.first(),
            Address::Group(g) => g.first().and_then(|gr| gr.addresses.first()),
        })
        .and_then(|addr| addr.address.as_ref().map(|s| s.to_string()))
        .unwrap_or_default();

    let from_name = msg
        .from()
        .and_then(|a| match a {
            Address::List(v) => v.first(),
            Address::Group(g) => g.first().and_then(|gr| gr.addresses.first()),
        })
        .and_then(|addr| addr.name.as_ref().map(|s| s.to_string()));

    let to = collect_address_entries(msg.to());
    let cc = collect_address_entries(msg.cc());
    let bcc = collect_address_entries(msg.bcc());
    let reply_to = collect_address_entries(msg.reply_to());
    let (in_reply_to, references) = extract_threading_from_headers(msg);
    let recipients_disclosed = !to.is_empty() || !cc.is_empty() || !bcc.is_empty();

    let body_html = body_html.filter(|h| !html_is_synthetic_minimal_body_echo(&body_text, h));

    ReadForCli {
        message_id,
        from: MailboxEntry {
            name: from_name,
            address: from_address,
        },
        subject: decode_rfc2047_header_line(msg.subject().unwrap_or("")),
        date,
        to,
        cc,
        bcc,
        reply_to,
        in_reply_to,
        references,
        recipients_disclosed,
        body_text,
        body_html,
    }
}

#[cfg(test)]
mod indexable_body_tests {
    use super::{
        indexable_bodies, parse_raw_message, parse_read_full_with_body_preference,
        should_prefer_html_for_body, ReadBodyPreference,
    };

    #[test]
    fn should_prefer_empty_plain_uses_rich_html() {
        let html = format!("<p>{}</p>", "x".repeat(500));
        assert!(should_prefer_html_for_body("", &html));
        let short_plain = "View in your browser";
        assert!(should_prefer_html_for_body(short_plain, &html));
    }

    #[test]
    fn should_keep_long_plain_when_html_only_slightly_larger() {
        let plain = "a".repeat(500);
        let html = format!("<p>{}</p>", "b".repeat(600));
        assert!(!should_prefer_html_for_body(&plain, &html));
    }

    #[test]
    fn should_prefer_html_when_plain_is_long_with_almost_no_line_breaks() {
        let plain = "Payment notice ".repeat(40).trim_end().to_string();
        assert!(
            plain.len() >= 500 && plain.as_bytes().iter().filter(|&&b| b == b'\n').count() == 0
        );
        let html = format!(
            "<html><body><p>{}</p><p>Second block with more text.</p></body></html>",
            "x".repeat(900)
        );
        assert!(
            should_prefer_html_for_body(&plain, &html),
            "expected HTML-derived body for dense one-line plain"
        );
    }

    #[test]
    fn plain_body_preference_keeps_dense_plain_instead_of_html() {
        let wall = "Payment notice ".repeat(40).trim_end().to_string();
        let html_inner = format!(
            "<html><body><p>{}</p><p>Second</p></body></html>",
            "x".repeat(900)
        );
        let eml = format!(
            "From: a@b\r\n\
             To: c@b\r\n\
             Subject: t\r\n\
             Message-ID: <plain-pref-test@local>\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: multipart/alternative; boundary=\"bnd\"\r\n\
             \r\n\
             --bnd\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\
             \r\n\
             {wall}\r\n\
             --bnd\r\n\
             Content-Type: text/html; charset=utf-8\r\n\
             \r\n\
             {html_inner}\r\n\
             --bnd--\r\n"
        );
        let auto = parse_read_full_with_body_preference(eml.as_bytes(), ReadBodyPreference::Auto);
        let plain_pref =
            parse_read_full_with_body_preference(eml.as_bytes(), ReadBodyPreference::PlainText);
        assert_ne!(
            auto.body_text, plain_pref.body_text,
            "auto should use HTML-derived body, plain pref should keep text/plain"
        );
        assert!(
            plain_pref.body_text.contains("Payment notice"),
            "plain body lost: {:?}",
            plain_pref.body_text
        );
        assert!(
            !plain_pref.body_text.contains("Second"),
            "plain pref should not use HTML paragraphs: {:?}",
            plain_pref.body_text
        );
    }

    #[test]
    fn indexable_bodies_merges_order_number_from_html_when_plain_empty() {
        let p = indexable_bodies(
            Some(String::new()),
            Some(
                "<html><body>Thanks! Order <b>#ORD-42</b> — Madison Beer Store</body></html>"
                    .into(),
            ),
        );
        let body = p.0.to_lowercase();
        assert!(
            body.contains("ord-42") && body.contains("madison"),
            "body was: {:?}",
            p.0
        );
    }

    #[test]
    fn parse_receipt_multipart_prefer_html_for_searchable_body() {
        let eml = concat!(
            "From: noreply@ceremonyofroses.com\r\n",
            "To: u@example.com\r\n",
            "Subject: Shipping update #MB12869\r\n",
            "Message-ID: <receipt-idx-1@local>\r\n",
            "MIME-Version: 1.0\r\n",
            "Content-Type: multipart/alternative; boundary=\"bnd\"\r\n",
            "\r\n",
            "--bnd\r\n",
            "Content-Type: text/plain; charset=\"utf-8\"\r\n",
            "\r\n",
            "\r\n",
            "--bnd\r\n",
            "Content-Type: text/html; charset=\"utf-8\"\r\n",
            "\r\n",
            "<html><body>Thank you for your purchase. Order #MB12869 confirmed. Madison Beer Official Store</body></html>\r\n",
            "--bnd--\r\n"
        );
        let msg = parse_raw_message(eml.as_bytes());
        assert!(msg.body_text.to_lowercase().contains("mb12869"));
        assert!(msg
            .body_text
            .to_lowercase()
            .contains("thank you for your purchase"));
    }
}

#[cfg(test)]
mod synthetic_minimal_html_tests {
    use super::html_is_synthetic_minimal_body_echo;

    #[test]
    fn detect_mail_parser_xhtml_body_echo() {
        assert!(html_is_synthetic_minimal_body_echo(
            "Hello.",
            "<html><body>Hello.</body></html>"
        ));
    }

    #[test]
    fn distinct_plain_and_html_not_synthetic() {
        assert!(!html_is_synthetic_minimal_body_echo(
            "Hello plain.",
            "<html><body>Hello.</body></html>"
        ));
    }

    #[test]
    fn html_with_link_is_not_synthetic() {
        assert!(!html_is_synthetic_minimal_body_echo(
            "x",
            "<html><body><a href=\"https://a.com/\">x</a></body></html>"
        ));
    }
}
