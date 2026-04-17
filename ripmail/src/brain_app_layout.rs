//! When Brain runs ripmail, it sets `RIPMAIL_HOME` to `$BRAIN_HOME/<ripmail>/`.
//! This parses `shared/brain-layout.json` at compile time so the directory name stays aligned with Node/Tauri.

use std::sync::OnceLock;

const BRAIN_LAYOUT_JSON: &str = include_str!("../../shared/brain-layout.json");

/// Subdirectory name under `BRAIN_HOME` for ripmail data (e.g. `"ripmail"`).
pub fn brain_ripmail_dir_name() -> &'static str {
    static SEG: OnceLock<&'static str> = OnceLock::new();
    SEG.get_or_init(|| {
        let v: serde_json::Value = serde_json::from_str(BRAIN_LAYOUT_JSON)
            .expect("shared/brain-layout.json must be valid JSON");
        let s = v["directories"]["ripmail"]
            .as_str()
            .expect("brain-layout.json must define directories.ripmail")
            .to_string();
        Box::leak(s.into_boxed_str())
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn ripmail_dir_matches_expected_segment() {
        assert_eq!(super::brain_ripmail_dir_name(), "ripmail");
    }
}
