pub mod contacts;
pub mod cursor;
pub mod edits_window;
pub mod imessage;
pub mod keychain;
pub mod scheduler;
pub mod uploader;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("SQLite error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("keychain error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("{0}")]
    Message(String),
}

pub type BridgeResult<T> = Result<T, BridgeError>;
