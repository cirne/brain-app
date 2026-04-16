//! Sync / IMAP errors.

use thiserror::Error;

/// Extra guidance for agents when IMAP drops mid-sync (BUG-051).
pub fn enrich_imap_disconnect_message(msg: &str) -> String {
    let lower = msg.to_lowercase();
    let looks_disconnect = lower.contains("connection")
        || lower.contains("not available")
        || lower.contains("broken pipe")
        || lower.contains("connection reset")
        || lower.contains("timed out")
        || lower.contains("closed");
    if looks_disconnect {
        format!(
            "{msg}\n\
             (Messages already downloaded are saved locally. Run `ripmail refresh` to resume.)"
        )
    } else {
        msg.to_string()
    }
}

#[derive(Debug, Error)]
pub enum RunSyncError {
    #[error("IMAP: {0}")]
    Imap(String),
    #[error("SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Config(String),
    #[error("fetchAll timed out after retries")]
    FetchTimeout,
}

#[cfg(test)]
mod tests {
    use super::enrich_imap_disconnect_message;

    #[test]
    fn enrich_appends_resume_hint_on_connection_errors() {
        let out = enrich_imap_disconnect_message("ERROR Connection not available");
        assert!(out.contains("Connection not available"));
        assert!(out.contains("refresh"));
    }

    #[test]
    fn enrich_passes_through_unrelated_errors() {
        let m = "BAD unknown command";
        assert_eq!(enrich_imap_disconnect_message(m), m);
    }
}
