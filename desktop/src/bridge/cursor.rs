use std::fs;
use std::path::PathBuf;

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

use crate::bridge::{BridgeError, BridgeResult};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ImessageCursorState {
    pub last_rowid: i64,
    pub last_sync_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BridgeCursorState {
    pub imessage: ImessageCursorState,
}

pub fn state_path() -> BridgeResult<PathBuf> {
    let dirs = ProjectDirs::from("com", "cirne", "Braintunnel").ok_or_else(|| {
        BridgeError::Message("Could not resolve app config directory".to_string())
    })?;
    Ok(dirs.config_dir().join("agent").join("state.json"))
}

pub fn load_state() -> BridgeResult<BridgeCursorState> {
    let path = state_path()?;
    if !path.exists() {
        return Ok(BridgeCursorState::default());
    }
    let raw = fs::read_to_string(path)?;
    let state = serde_json::from_str::<BridgeCursorState>(&raw)?;
    Ok(state)
}

pub fn save_state(state: &BridgeCursorState) -> BridgeResult<()> {
    let path = state_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(state)?;
    fs::write(path, body)?;
    Ok(())
}

pub fn imessage_last_rowid() -> BridgeResult<i64> {
    let s = load_state()?;
    Ok(s.imessage.last_rowid)
}

pub fn advance_imessage_cursor(last_rowid: i64, synced_at_ms: i64) -> BridgeResult<()> {
    let mut s = load_state()?;
    s.imessage.last_rowid = last_rowid;
    s.imessage.last_sync_ms = synced_at_ms;
    save_state(&s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scoped_tmp_home() -> String {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bridge-cursor-home-{nonce}"));
        fs::create_dir_all(&dir).expect("mkdir");
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn round_trip_cursor_state() {
        let home = scoped_tmp_home();
        let old_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home);
        let now = 1_714_000_000_000i64;
        advance_imessage_cursor(42, now).expect("advance");
        let loaded = load_state().expect("load");
        assert_eq!(loaded.imessage.last_rowid, 42);
        assert_eq!(loaded.imessage.last_sync_ms, now);
        if let Some(prev) = old_home {
            std::env::set_var("HOME", prev);
        } else {
            std::env::remove_var("HOME");
        }
    }
}
