//! Default `BRAIN_HOME` for the bundled Braintunnel.app (macOS GUI — no shell `.env`).
//! Layout segments must match `shared/brain-layout.json` in the repo root.
//! Default home root segments must match `shared/bundle-defaults.json`.

use serde::Deserialize;
use std::fs;
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

#[derive(Deserialize)]
struct BundleDefaults {
    default_brain_home: DefaultBrainHomeRel,
    #[serde(default)]
    default_wiki_parent_darwin: Option<String>,
}

#[derive(Deserialize)]
struct DefaultBrainHomeRel {
    darwin: String,
    other: String,
}

static BUNDLE_DEFAULTS: OnceLock<BundleDefaults> = OnceLock::new();

fn bundle_defaults() -> &'static BundleDefaults {
    BUNDLE_DEFAULTS.get_or_init(|| {
        serde_json::from_str(include_str!("../../shared/bundle-defaults.json"))
            .expect("shared/bundle-defaults.json must be valid JSON")
    })
}

const BRAIN_HOME_DEFAULT_GITIGNORE: &str =
    include_str!("../../shared/brain-home-default.gitignore");

fn write_brain_home_gitignore_if_absent(brain: &Path) {
    let dest = brain.join(".gitignore");
    if dest.exists() {
        return;
    }
    if let Err(e) = fs::write(&dest, BRAIN_HOME_DEFAULT_GITIGNORE) {
        log::warn!("brain: could not write {}: {e}", dest.display());
    }
}

fn brain_home_default(home: &str) -> PathBuf {
    let rel = if cfg!(target_os = "macos") {
        &bundle_defaults().default_brain_home.darwin
    } else {
        &bundle_defaults().default_brain_home.other
    };
    Path::new(home).join(rel)
}

fn wiki_parent_default(home: &str) -> PathBuf {
    let rel = bundle_defaults()
        .default_wiki_parent_darwin
        .as_deref()
        .unwrap_or("Documents/Brain");
    Path::new(home).join(rel)
}

pub fn ensure_dirs_and_apply_defaults(cmd: &mut Command, home: &str) {
    let brain = brain_home_default(home);
    let wiki_parent = if cfg!(target_os = "macos") {
        wiki_parent_default(home)
    } else {
        brain.clone()
    };
    let wiki = wiki_parent.join(dir_segment("wiki"));
    let skills = brain.join(dir_segment("skills"));
    let chats = brain.join(dir_segment("chats"));
    let rip = brain.join(dir_segment("ripmail"));
    let cache = brain.join(dir_segment("cache"));
    let var_d = brain.join(dir_segment("var"));

    for d in [&wiki, &skills, &chats, &rip, &cache, &var_d] {
        let _ = std::fs::create_dir_all(d);
    }

    write_brain_home_gitignore_if_absent(&brain);

    if std::env::var_os("BRAIN_HOME").is_none() {
        cmd.env("BRAIN_HOME", &brain);
    }
    if std::env::var_os("BRAIN_WIKI_ROOT").is_none() {
        cmd.env("BRAIN_WIKI_ROOT", &wiki_parent);
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

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_wiki_lives_under_documents_brain() {
        let wiki = super::wiki_parent_default("/Users/x").join(super::dir_segment("wiki"));
        assert_eq!(wiki.to_string_lossy(), "/Users/x/Documents/Brain/wiki");
    }
}
