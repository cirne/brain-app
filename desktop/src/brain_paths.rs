//! Default `BRAIN_HOME` for the bundled Brain.app (macOS GUI — no shell `.env`).
//! Layout segments must match `shared/brain-layout.json` in the repo root.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

static LAYOUT: OnceLock<serde_json::Value> = OnceLock::new();

fn layout_json() -> &'static serde_json::Value {
    LAYOUT.get_or_init(|| {
        serde_json::from_str(include_str!("../../shared/brain-layout.json"))
            .expect("shared/brain-layout.json must be valid JSON")
    })
}

fn dir_segment(key: &str) -> String {
    layout_json()["directories"][key]
        .as_str()
        .unwrap_or_else(|| panic!("brain-layout.json missing directories.{key}"))
        .to_string()
}

fn brain_home_default(home: &str) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        Path::new(home).join("Library/Application Support/Brain")
    }
    #[cfg(not(target_os = "macos"))]
    {
        Path::new(home).join(".brain")
    }
}

pub fn ensure_dirs_and_apply_defaults(cmd: &mut Command, home: &str) {
    let brain = brain_home_default(home);
    let wiki = brain.join(dir_segment("wiki"));
    let skills = brain.join(dir_segment("skills"));
    let chats = brain.join(dir_segment("chats"));
    let rip = brain.join(dir_segment("ripmail"));
    let cache = brain.join(dir_segment("cache"));
    let var_d = brain.join(dir_segment("var"));

    for d in [&wiki, &skills, &chats, &rip, &cache, &var_d] {
        let _ = std::fs::create_dir_all(d);
    }

    if std::env::var_os("BRAIN_HOME").is_none() {
        cmd.env("BRAIN_HOME", &brain);
    }
    if std::env::var_os("RIPMAIL_HOME").is_none() {
        cmd.env("RIPMAIL_HOME", &rip);
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_brain_home_matches_layout() {
        let brain = super::brain_home_default("/Users/x");
        let rip = brain.join(super::dir_segment("ripmail"));
        assert_eq!(
            brain.to_string_lossy(),
            "/Users/x/Library/Application Support/Brain"
        );
        assert_eq!(
            rip.to_string_lossy(),
            "/Users/x/Library/Application Support/Brain/ripmail"
        );
    }
}
