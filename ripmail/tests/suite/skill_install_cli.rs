//! `ripmail skill install` with isolated `RIPMAIL_CLAUDE_SKILL_DIR`.

use std::fs;
use std::process::Command;

#[test]
fn skill_install_writes_skill_md_to_custom_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("skills/ripmail");
    let st = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", tmp.path())
        .env("RIPMAIL_CLAUDE_SKILL_DIR", &dest)
        .args(["skill", "install"])
        .status()
        .expect("spawn ripmail");
    assert!(st.success(), "ripmail skill install should exit 0");
    let skill_md = dest.join("SKILL.md");
    assert!(
        skill_md.is_file(),
        "expected SKILL.md at {}",
        skill_md.display()
    );
    let text = fs::read_to_string(&skill_md).expect("read SKILL.md");
    assert!(
        text.contains("name:") || text.contains("ripmail"),
        "SKILL.md should look like the publishable skill"
    );
}

#[test]
fn skill_install_twice_replaces_existing() {
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("skills/ripmail");
    for _ in 0..2 {
        let st = Command::new(env!("CARGO_BIN_EXE_ripmail"))
            .env("RIPMAIL_HOME", tmp.path())
            .env("RIPMAIL_CLAUDE_SKILL_DIR", &dest)
            .args(["skill", "install"])
            .status()
            .expect("spawn ripmail");
        assert!(
            st.success(),
            "ripmail skill install should exit 0 when replacing an existing skill"
        );
    }
    assert!(dest.join("SKILL.md").is_file());
}
