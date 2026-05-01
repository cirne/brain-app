//! Local filesystem reads: `ripmail read <path>` and [`super::local_dir`](crate::sources::local_dir).
//!
//! Avoids dumping binary garbage via `utf8_lossy` and surfaces structured status for image-heavy PDFs.

use serde::Serialize;

use super::extract_attachment;

/// Align with brain-app Node `RIPMAIL_READ_MAX_BUFFER_BYTES` — do not read larger files into memory.
pub const MAX_LOCAL_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// Truncate extracted text for agent context (characters, not bytes) when
/// [`LocalFileReadOptions::truncate_extracted`] is true (default).
pub(crate) const MAX_BODY_TEXT_CHARS: usize = 50_000;

const IMAGE_HEAVY_PDF_HINT: &str = "Scanned PDFs are not readable as text yet. Ask the user to open the file locally or describe what they need. Future: multimodal/vision support.";

fn mime_is_application_pdf(mime: &str) -> bool {
    mime.split(';')
        .next()
        .map(|s| s.trim().eq_ignore_ascii_case("application/pdf"))
        .unwrap_or(false)
}

fn attachment_is_pdf(mime: &str, filename: &str) -> bool {
    mime_is_application_pdf(mime) || filename.to_lowercase().ends_with(".pdf")
}

/// Meaningful extracted text must exceed this (Unicode chars after trim).
fn negligible_text(s: &str) -> bool {
    s.trim().chars().count() < 48
}

fn truncate_body(s: String) -> String {
    if s.chars().count() <= MAX_BODY_TEXT_CHARS {
        return s;
    }
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i >= MAX_BODY_TEXT_CHARS {
            break;
        }
        out.push(ch);
    }
    out.push_str("\n\n[Truncated: content exceeded maximum length for agent context.]");
    out
}

/// Controls extraction behavior for `ripmail read <path>` (not mailbox Message-IDs).
#[derive(Debug, Clone, Copy)]
pub struct LocalFileReadOptions {
    /// When true (default), cap extracted text at [`MAX_BODY_TEXT_CHARS`]. When false, return the
    /// full extracted/plain UTF-8 (still subject to [`MAX_LOCAL_FILE_BYTES`] for reading bytes off disk).
    pub truncate_extracted: bool,
}

impl Default for LocalFileReadOptions {
    fn default() -> Self {
        Self {
            truncate_extracted: true,
        }
    }
}

fn format_pdf_local(filename: &str, body: &str) -> String {
    format!("## {}\n\n{}", filename, body.trim())
}

fn pdf_unusable_body(size_bytes: u64) -> String {
    let mb = size_bytes as f64 / (1024.0 * 1024.0);
    if mb >= 0.05 {
        format!(
            "Large PDF ({:.1} MB); extracted text is empty or negligible—likely scanned pages or image-only content. Not suitable as text for the model; see hint.",
            mb
        )
    } else {
        "PDF has no extractable text or too little text for this file size—likely scanned or image-only content. Not suitable as text for the model; see hint.".to_string()
    }
}

fn binary_stub_body(filename: &str, size_bytes: u64) -> String {
    let size_mb = size_bytes as f64 / (1024.0 * 1024.0);
    format!(
        "[Binary file: {filename}, {:.2} MB — no text extraction available; see hint.]",
        size_mb
    )
}

const BINARY_HINT: &str = "This file is not suitable as plain text. Ask the user to open it locally or use a format-specific tool.";

fn too_large_body(size_mb: f64) -> String {
    format!(
        "File exceeds maximum read size ({size_mb:.1} MB). Not read into memory; open locally or split the file."
    )
}

/// Sample up to 64 KiB for NUL / control-byte heuristics.
fn is_probably_binary(bytes: &[u8]) -> bool {
    if bytes.len() >= 4 && bytes[0..4] == *b"%PDF" {
        return false;
    }
    if bytes.contains(&0) {
        return true;
    }
    let n = bytes.len().min(64 * 1024);
    if n == 0 {
        return false;
    }
    let chunk = &bytes[..n];
    // Invalid UTF-8 in the sample (e.g. 0xFF runs) → treat as binary before ASCII-only heuristics.
    if std::str::from_utf8(chunk).is_err() {
        return true;
    }
    let mut ctrl = 0usize;
    for &b in chunk {
        if b.is_ascii_control() && b != b'\n' && b != b'\r' && b != b'\t' {
            ctrl += 1;
        }
    }
    // >30% control characters in sample → binary
    ctrl * 10 > chunk.len() * 3
}

fn is_printable_utf8_text(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() {
        return false;
    }
    let total = t.chars().count();
    let bad = t
        .chars()
        .filter(|c| c.is_control() && !c.is_whitespace())
        .count();
    bad * 20 < total
}

fn extension_suggests_plain_text(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".md")
        || n.ends_with(".mdx")
        || n.ends_with(".json")
        || n.ends_with(".jsonc")
        || n.ends_with(".ts")
        || n.ends_with(".tsx")
        || n.ends_with(".js")
        || n.ends_with(".jsx")
        || n.ends_with(".mjs")
        || n.ends_with(".cjs")
        || n.ends_with(".css")
        || n.ends_with(".scss")
        || n.ends_with(".html")
        || n.ends_with(".htm")
        || n.ends_with(".xml")
        || n.ends_with(".svg")
        || n.ends_with(".yaml")
        || n.ends_with(".yml")
        || n.ends_with(".toml")
        || n.ends_with(".rs")
        || n.ends_with(".py")
        || n.ends_with(".go")
        || n.ends_with(".swift")
        || n.ends_with(".kt")
        || n.ends_with(".java")
        || n.ends_with(".c")
        || n.ends_with(".h")
        || n.ends_with(".cpp")
        || n.ends_with(".hpp")
        || n.ends_with(".sh")
        || n.ends_with(".bash")
        || n.ends_with(".zsh")
        || n.ends_with(".env")
        || n.ends_with(".gitignore")
}

/// Result of reading a local file for agents / FTS (single source of truth).
#[derive(Debug, Clone)]
pub struct LocalFileReadOutcome {
    pub read_status: &'static str,
    pub body_text: String,
    pub hint: Option<String>,
    pub size_bytes: u64,
    pub mime: String,
    pub filename: String,
}

impl LocalFileReadOutcome {
    /// JSON line for `ripmail read <path> --json` (camelCase).
    pub fn to_json(&self, path: String) -> LocalFileReadJson {
        LocalFileReadJson {
            source_id: String::new(),
            source_kind: "localDir".to_string(),
            path,
            body_text: self.body_text.clone(),
            read_status: self.read_status.to_string(),
            size_bytes: self.size_bytes,
            mime: self.mime.clone(),
            filename: self.filename.clone(),
            hint: self.hint.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileReadJson {
    pub source_id: String,
    pub source_kind: String,
    pub path: String,
    pub body_text: String,
    pub read_status: String,
    pub size_bytes: u64,
    pub mime: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

/// When `stat` shows the file exceeds [`MAX_LOCAL_FILE_BYTES`], do not read bytes.
pub fn local_file_skipped_too_large(
    size_bytes: u64,
    mime: &str,
    filename: &str,
) -> LocalFileReadOutcome {
    let mb = size_bytes as f64 / (1024.0 * 1024.0);
    LocalFileReadOutcome {
        read_status: "too_large",
        body_text: too_large_body(mb),
        hint: Some(
            "File is larger than the maximum read size. The user can open it locally or split it."
                .to_string(),
        ),
        size_bytes,
        mime: mime.to_string(),
        filename: filename.to_string(),
    }
}

/// Full read pipeline: extraction, PDF image-heavy detection, binary heuristics, UTF-8 text fallback.
pub fn local_file_read_outcome(bytes: &[u8], mime: &str, filename: &str) -> LocalFileReadOutcome {
    local_file_read_outcome_with_options(bytes, mime, filename, LocalFileReadOptions::default())
}

fn maybe_truncate(s: String, options: LocalFileReadOptions) -> String {
    if !options.truncate_extracted {
        return s;
    }
    truncate_body(s)
}

/// Like [`local_file_read_outcome`], with control over the 50k extracted-text cap (for `--full-body`).
pub fn local_file_read_outcome_with_options(
    bytes: &[u8],
    mime: &str,
    filename: &str,
    options: LocalFileReadOptions,
) -> LocalFileReadOutcome {
    let size_bytes = bytes.len() as u64;

    // --- PDF ---
    if attachment_is_pdf(mime, filename) {
        let extracted = extract_attachment(bytes, mime, filename);
        match extracted {
            Some(text) if !negligible_text(&text) => LocalFileReadOutcome {
                read_status: "ok",
                body_text: maybe_truncate(format_pdf_local(filename, &text), options),
                hint: None,
                size_bytes,
                mime: mime.to_string(),
                filename: filename.to_string(),
            },
            _ => LocalFileReadOutcome {
                read_status: "image_heavy_pdf",
                body_text: pdf_unusable_body(size_bytes),
                hint: Some(IMAGE_HEAVY_PDF_HINT.to_string()),
                size_bytes,
                mime: mime.to_string(),
                filename: filename.to_string(),
            },
        }
    } else {
        // --- Structured extraction (Office, HTML, CSV, …) ---
        if let Some(text) = extract_attachment(bytes, mime, filename) {
            return LocalFileReadOutcome {
                read_status: "ok",
                body_text: maybe_truncate(text, options),
                hint: None,
                size_bytes,
                mime: mime.to_string(),
                filename: filename.to_string(),
            };
        }

        if is_probably_binary(bytes) {
            return LocalFileReadOutcome {
                read_status: "binary",
                body_text: binary_stub_body(filename, size_bytes),
                hint: Some(BINARY_HINT.to_string()),
                size_bytes,
                mime: mime.to_string(),
                filename: filename.to_string(),
            };
        }

        if let Ok(s) = std::str::from_utf8(bytes) {
            if is_printable_utf8_text(s) {
                return LocalFileReadOutcome {
                    read_status: "ok",
                    body_text: maybe_truncate(s.to_string(), options),
                    hint: None,
                    size_bytes,
                    mime: mime.to_string(),
                    filename: filename.to_string(),
                };
            }
        }

        if extension_suggests_plain_text(filename) {
            let lossy = String::from_utf8_lossy(bytes);
            if !lossy.chars().any(|c| c == '\u{FFFD}') || lossy.len() < 200 {
                let s = lossy.into_owned();
                if is_printable_utf8_text(&s) {
                    return LocalFileReadOutcome {
                        read_status: "ok",
                        body_text: maybe_truncate(s, options),
                        hint: None,
                        size_bytes,
                        mime: mime.to_string(),
                        filename: filename.to_string(),
                    };
                }
            }
        }

        LocalFileReadOutcome {
            read_status: "unsupported",
            body_text: binary_stub_body(filename, size_bytes),
            hint: Some(BINARY_HINT.to_string()),
            size_bytes,
            mime: mime.to_string(),
            filename: filename.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdf_empty_bytes_image_heavy() {
        let o = local_file_read_outcome(b"", "application/pdf", "x.pdf");
        assert_eq!(o.read_status, "image_heavy_pdf");
        assert!(o.body_text.contains("PDF"));
        assert!(o.hint.is_some());
    }

    #[test]
    fn markdown_ok() {
        let bytes = b"# Hello\n\nworld";
        let o = local_file_read_outcome(bytes, "application/octet-stream", "note.md");
        assert_eq!(o.read_status, "ok");
        assert!(o.body_text.contains("Hello"));
    }

    #[test]
    fn binary_nul() {
        let mut v = vec![0u8; 256];
        v[0] = b'x';
        let o = local_file_read_outcome(&v, "application/octet-stream", "f.bin");
        assert_eq!(o.read_status, "binary");
        assert!(o.body_text.contains("Binary file"));
    }

    #[test]
    fn too_large_skipped() {
        let o = local_file_skipped_too_large(25 * 1024 * 1024, "application/pdf", "huge.pdf");
        assert_eq!(o.read_status, "too_large");
        assert!(o.body_text.contains("maximum read size"));
    }

    #[test]
    fn default_truncate_caps_very_long_utf8_file() {
        let n = super::MAX_BODY_TEXT_CHARS + 50;
        let s = "x".repeat(n);
        let o = local_file_read_outcome(s.as_bytes(), "text/plain", "long.txt");
        assert_eq!(o.read_status, "ok");
        assert!(o.body_text.contains("Truncated"));
        // Capped to MAX chars plus a short suffix, well under the original n.
        assert!(o.body_text.chars().count() <= super::MAX_BODY_TEXT_CHARS + 120);
    }

    #[test]
    fn full_body_returns_entire_extracted_text() {
        let n = super::MAX_BODY_TEXT_CHARS + 50;
        let s = "x".repeat(n);
        let o = local_file_read_outcome_with_options(
            s.as_bytes(),
            "text/plain",
            "long.txt",
            super::LocalFileReadOptions {
                truncate_extracted: false,
            },
        );
        assert_eq!(o.read_status, "ok");
        assert!(!o.body_text.contains("Truncated"));
        assert_eq!(o.body_text.chars().count(), n);
    }
}
