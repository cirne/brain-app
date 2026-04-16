//! Default data locations for the bundled Brain.app (macOS GUI — no shell `.env`).

use std::path::{Path, PathBuf};
use std::process::Command;

/// Wiki repo root: `~/Documents/Brain` (OPP-007).
/// Chat + onboarding: `~/Library/Application Support/Brain/data/chat`.
/// ripmail index: `~/Library/Application Support/Brain/ripmail`.
#[cfg(target_os = "macos")]
pub fn macos_paths_for_home(home: &str) -> (PathBuf, PathBuf, PathBuf) {
    let wiki = Path::new(home).join("Documents/Brain");
    let app_support = Path::new(home).join("Library/Application Support/Brain");
    let chat = app_support.join("data/chat");
    let rip = app_support.join("ripmail");
    (wiki, chat, rip)
}

#[cfg(target_os = "macos")]
pub fn ensure_dirs_and_apply_defaults(cmd: &mut Command, home: &str) {
    let (wiki, chat, rip) = macos_paths_for_home(home);
    let _ = std::fs::create_dir_all(&chat);
    let _ = std::fs::create_dir_all(&rip);
    let _ = std::fs::create_dir_all(&wiki);

    if std::env::var_os("WIKI_DIR").is_none() {
        cmd.env("WIKI_DIR", &wiki);
    }
    if std::env::var_os("CHAT_DATA_DIR").is_none() {
        cmd.env("CHAT_DATA_DIR", &chat);
    }
    if std::env::var_os("RIPMAIL_HOME").is_none() {
        cmd.env("RIPMAIL_HOME", &rip);
    }
}

/// Non-macOS `tauri build` (e.g. CI): keep data under `~/.brain/` and `~/Documents/Brain` wiki.
#[cfg(not(target_os = "macos"))]
pub fn ensure_dirs_and_apply_defaults(cmd: &mut Command, home: &str) {
    let base = Path::new(home).join(".brain");
    let wiki = Path::new(home).join("Documents/Brain");
    let chat = base.join("data/chat");
    let rip = base.join("ripmail");
    let _ = std::fs::create_dir_all(&chat);
    let _ = std::fs::create_dir_all(&rip);
    let _ = std::fs::create_dir_all(&wiki);

    if std::env::var_os("WIKI_DIR").is_none() {
        cmd.env("WIKI_DIR", &wiki);
    }
    if std::env::var_os("CHAT_DATA_DIR").is_none() {
        cmd.env("CHAT_DATA_DIR", &chat);
    }
    if std::env::var_os("RIPMAIL_HOME").is_none() {
        cmd.env("RIPMAIL_HOME", &rip);
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_paths_match_opp007_layout() {
        let (wiki, chat, rip) = super::macos_paths_for_home("/Users/x");
        assert_eq!(wiki.to_string_lossy(), "/Users/x/Documents/Brain");
        assert_eq!(
            chat.to_string_lossy(),
            "/Users/x/Library/Application Support/Brain/data/chat"
        );
        assert_eq!(
            rip.to_string_lossy(),
            "/Users/x/Library/Application Support/Brain/ripmail"
        );
    }
}
