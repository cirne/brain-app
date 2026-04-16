//! Apple Mail `.emlx` — first line is decimal byte length of the following RFC822/MIME block, then optional plist.

use std::io::{self, Read};
use std::path::Path;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum EmlxError {
    #[error("empty .emlx file")]
    Empty,
    #[error("invalid first line (expected decimal byte count): {0}")]
    BadLengthLine(String),
    #[error("declared MIME length {declared} exceeds remaining file bytes ({available})")]
    TruncatedMime { declared: usize, available: usize },
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
}

/// Strip Apple Mail preamble and return raw MIME/RFC822 bytes (what `.eml` would contain).
pub fn extract_mime_from_emlx_bytes(file_bytes: &[u8]) -> Result<Vec<u8>, EmlxError> {
    if file_bytes.is_empty() {
        return Err(EmlxError::Empty);
    }
    let mut iter = file_bytes.splitn(2, |b| *b == b'\n');
    let first = iter.next().ok_or(EmlxError::Empty)?;
    let rest = iter.next().ok_or(EmlxError::Empty)?;
    // Apple Mail often space-pads the length (e.g. `12235     \n`).
    let line = std::str::from_utf8(first)
        .map_err(|_| EmlxError::BadLengthLine("non-utf8 first line".into()))?
        .trim();
    let n: usize = line
        .parse()
        .map_err(|_| EmlxError::BadLengthLine(line.to_string()))?;
    if n > rest.len() {
        return Err(EmlxError::TruncatedMime {
            declared: n,
            available: rest.len(),
        });
    }
    // `rest` may include trailing plist after the MIME block; take exactly `n` bytes.
    Ok(rest[..n].to_vec())
}

/// Read a mail file: if path ends with `.emlx`, extract inner MIME; otherwise return file bytes as-is.
pub fn read_mail_file_bytes(path: &Path) -> io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    std::fs::File::open(path)?.read_to_end(&mut buf)?;
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("emlx"))
        .unwrap_or(false)
    {
        extract_mime_from_emlx_bytes(&buf)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    } else {
        Ok(buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_mime_from_emlx_roundtrip() {
        let mime = b"From: a@b\r\nSubject: hi\r\n\r\nbody";
        let mut file = Vec::new();
        file.extend_from_slice(format!("{}\n", mime.len()).as_bytes());
        file.extend_from_slice(mime);
        file.extend_from_slice(b"<plist></plist>"); // ignored junk after MIME block
        let out = extract_mime_from_emlx_bytes(&file).unwrap();
        assert_eq!(out.as_slice(), mime);
    }

    #[test]
    fn extract_rejects_truncated() {
        let file = b"5\nabc";
        assert!(extract_mime_from_emlx_bytes(file).is_err());
    }

    #[test]
    fn extract_mime_accepts_space_padded_length_line() {
        let mime = b"From: a@b\n";
        let mut file = Vec::new();
        file.extend_from_slice(format!("{}     \n", mime.len()).as_bytes());
        file.extend_from_slice(mime);
        let out = extract_mime_from_emlx_bytes(&file).unwrap();
        assert_eq!(out.as_slice(), mime);
    }
}
