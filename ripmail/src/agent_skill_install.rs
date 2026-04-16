//! Install the publishable `skills/ripmail` tree for Claude Code and OpenClaw.
//! Workspace installs (symlink/copy from repo) are used by `cargo install-local`.
//! Embedded installs copy the compile-time embed — used by `ripmail setup`, `ripmail wizard`, `ripmail skill install`.

use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use include_dir::{include_dir, Dir};

/// Compile-time embed of [`skills/ripmail`](../../skills/ripmail) (see include_dir `$CARGO_MANIFEST_DIR` docs).
static EMBEDDED_RIPMAIL_SKILL: Dir = include_dir!("$CARGO_MANIFEST_DIR/skills/ripmail");

/// Install from the workspace `skills/ripmail` directory (dev / `cargo install-local`).
pub fn install_skill_from_workspace(workspace_root: &Path) -> Result<(), String> {
    install_claude_skill_from_workspace(workspace_root)?;
    install_openclaw_skill_from_workspace(workspace_root, true)
}

/// Options for [`install_skill_from_embed_with_options`].
#[derive(Debug, Clone, Copy, Default)]
pub struct InstallSkillFromEmbedOptions {
    /// Install/update under the Claude Code skills path.
    pub claude: bool,
    /// Copy to `~/.openclaw/skills/ripmail` when that layout exists.
    pub openclaw: bool,
    /// Print success lines (same style as `cargo install-local`).
    pub verbose: bool,
}

/// Install from the embedded skill tree (prebuilt / no checkout).
///
/// When `verbose` is true, prints the same style of messages as `cargo install-local`.
pub fn install_skill_from_embed(verbose: bool) -> Result<(), String> {
    install_skill_from_embed_with_options(InstallSkillFromEmbedOptions {
        claude: true,
        openclaw: true,
        verbose,
    })
}

/// Install embedded skill for the selected targets (e.g. wizard may install only one).
pub fn install_skill_from_embed_with_options(
    opts: InstallSkillFromEmbedOptions,
) -> Result<(), String> {
    if opts.claude {
        install_claude_skill_from_embed(opts.verbose)?;
    }
    if opts.openclaw {
        install_openclaw_skill_from_embed(opts.verbose)?;
    }
    Ok(())
}

fn install_claude_skill_from_workspace(workspace_root: &Path) -> Result<(), String> {
    if skip_claude_skill_install() {
        println!("Skipping Claude skill install (RIPMAIL_SKIP_CLAUDE_SKILL is set).");
        return Ok(());
    }
    let src = workspace_root.join("skills/ripmail");
    if !src.is_dir() {
        return Err(format!(
            "publishable skill missing: {} (expected skills/ripmail under repo root)",
            src.display()
        ));
    }
    let dest = claude_skill_dest()?;
    let mode =
        parse_claude_skill_mode_str(&env::var("RIPMAIL_CLAUDE_SKILL_MODE").unwrap_or_default())?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let replaced = remove_path_for_replace(&dest)?;
    let src_abs = fs::canonicalize(&src).map_err(|e| format!("{}: {e}", src.display()))?;
    match mode {
        ClaudeSkillMode::Symlink => install_skill_symlink(&src_abs, &dest)?,
        ClaudeSkillMode::Copy => copy_dir_all(&src_abs, &dest).map_err(|e| e.to_string())?,
    }
    let verb = if replaced { "Updated" } else { "Installed" };
    println!(
        "{verb} ripmail skill for Claude Code ({mode}):\n  {}",
        dest.display()
    );
    println!("Start a new Claude Code session or reload skills so /ripmail is available.");
    Ok(())
}

fn install_claude_skill_from_embed(verbose: bool) -> Result<(), String> {
    if skip_claude_skill_install() {
        if verbose {
            println!("Skipping Claude skill install (RIPMAIL_SKIP_CLAUDE_SKILL is set).");
        }
        return Ok(());
    }
    let dest = claude_skill_dest()?;
    install_claude_embed_at_path(&dest, verbose)
}

/// Install embedded skill to an explicit destination (used by tests to avoid `RIPMAIL_CLAUDE_SKILL_DIR` races).
pub(crate) fn install_claude_embed_at_path(dest: &Path, verbose: bool) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let replaced = remove_path_for_replace(dest)?;
    write_embedded_skill_to_dir(&EMBEDDED_RIPMAIL_SKILL, dest)?;
    if verbose {
        let verb = if replaced { "Updated" } else { "Installed" };
        println!(
            "{verb} ripmail skill for Claude Code:\n  {}",
            dest.display()
        );
        println!("Start a new Claude Code session or reload skills so /ripmail is available.");
    }
    Ok(())
}

/// Copy embedded skill to `~/.openclaw/skills/ripmail` when `~/.openclaw/skills` exists.
fn install_openclaw_skill_from_embed(verbose: bool) -> Result<(), String> {
    if skip_openclaw_skill_install() {
        if verbose {
            println!("Skipping OpenClaw skill install (RIPMAIL_SKIP_OPENCLAW_SKILL is set).");
        }
        return Ok(());
    }
    let home = dirs::home_dir()
        .ok_or_else(|| "cannot resolve home; set HOME for OpenClaw skill install".to_string())?;
    install_openclaw_skill_embed_at(home.as_path(), verbose)
}

/// When `verbose` is false, skips silently if `home/.openclaw/skills` is missing (no OpenClaw layout).
pub(crate) fn install_openclaw_skill_from_workspace(
    workspace_root: &Path,
    verbose: bool,
) -> Result<(), String> {
    if skip_openclaw_skill_install() {
        if verbose {
            println!("Skipping OpenClaw skill install (RIPMAIL_SKIP_OPENCLAW_SKILL is set).");
        }
        return Ok(());
    }
    let home = dirs::home_dir()
        .ok_or_else(|| "cannot resolve home; set HOME for OpenClaw skill install".to_string())?;
    install_openclaw_skill_workspace_at(workspace_root, home.as_path(), verbose)
}

/// When `verbose` is false, skips silently if `home/.openclaw/skills` is missing (no OpenClaw layout).
pub(crate) fn install_openclaw_skill_workspace_at(
    workspace_root: &Path,
    home: &Path,
    verbose: bool,
) -> Result<(), String> {
    let src = workspace_root.join("skills/ripmail");
    if !src.is_dir() {
        return Err(format!(
            "publishable skill missing: {} (expected skills/ripmail under repo root)",
            src.display()
        ));
    }
    let openclaw_skills = home.join(".openclaw/skills");
    if !openclaw_skills.is_dir() {
        return Ok(());
    }
    let dest = openclaw_skills.join("ripmail");
    let replaced = remove_path_for_replace(&dest)?;
    let src_abs = fs::canonicalize(&src).map_err(|e| format!("{}: {e}", src.display()))?;
    copy_dir_all(&src_abs, &dest).map_err(|e| e.to_string())?;
    if verbose {
        let verb = if replaced { "Updated" } else { "Installed" };
        println!(
            "{verb} ripmail skill for OpenClaw (copy):\n  {}",
            dest.display()
        );
        println!("Start a new OpenClaw session or restart the gateway so skills reload.");
    }
    Ok(())
}

fn install_openclaw_skill_embed_at(home: &Path, verbose: bool) -> Result<(), String> {
    let openclaw_skills = home.join(".openclaw/skills");
    if !openclaw_skills.is_dir() {
        return Ok(());
    }
    let dest = openclaw_skills.join("ripmail");
    let replaced = remove_path_for_replace(&dest)?;
    write_embedded_skill_to_dir(&EMBEDDED_RIPMAIL_SKILL, &dest)?;
    if verbose {
        let verb = if replaced { "Updated" } else { "Installed" };
        println!("{verb} ripmail skill for OpenClaw:\n  {}", dest.display());
        println!("Start a new OpenClaw session or restart the gateway so skills reload.");
    }
    Ok(())
}

fn write_embedded_skill_to_dir(dir: &Dir, dest_root: &Path) -> Result<(), String> {
    fs::create_dir_all(dest_root).map_err(|e| e.to_string())?;
    for file in dir.files() {
        let rel = file.path();
        let out = dest_root.join(rel);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&out, file.contents()).map_err(|e| format!("{}: {e}", out.display()))?;
    }
    Ok(())
}

/// Remove `dest` if present so a fresh install can be written. Handles symlinks (including
/// dangling symlinks): [`Path::exists`] is false for a dangling symlink, which previously left
/// the path in place and caused `EEXIST` when creating the destination directory.
///
/// Returns `true` if something was removed (an existing install was replaced).
fn remove_path_for_replace(dest: &Path) -> Result<bool, String> {
    let meta = match fs::symlink_metadata(dest) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    };
    if meta.is_dir() {
        fs::remove_dir_all(dest).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(dest).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

pub(crate) fn skip_claude_skill_install() -> bool {
    let Some(v) = env::var("RIPMAIL_SKIP_CLAUDE_SKILL").ok() else {
        return false;
    };
    let v = v.trim();
    v == "1" || v.eq_ignore_ascii_case("true")
}

pub(crate) fn skip_openclaw_skill_install() -> bool {
    let Some(v) = env::var("RIPMAIL_SKIP_OPENCLAW_SKILL").ok() else {
        return false;
    };
    let v = v.trim();
    v == "1" || v.eq_ignore_ascii_case("true")
}

/// Resolved destination for the Claude Code skill directory (`.../ripmail`).
pub fn claude_skill_dest() -> Result<PathBuf, String> {
    if let Some(p) = env::var("RIPMAIL_CLAUDE_SKILL_DIR")
        .ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
    {
        return Ok(PathBuf::from(p));
    }
    let home = dirs::home_dir()
        .ok_or_else(|| "cannot resolve home; set RIPMAIL_CLAUDE_SKILL_DIR".to_string())?;
    Ok(home.join(".claude/skills/ripmail"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ClaudeSkillMode {
    Symlink,
    Copy,
}

impl std::fmt::Display for ClaudeSkillMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClaudeSkillMode::Symlink => write!(f, "symlink"),
            ClaudeSkillMode::Copy => write!(f, "copy"),
        }
    }
}

pub(crate) fn parse_claude_skill_mode_str(raw: &str) -> Result<ClaudeSkillMode, String> {
    let raw = raw.trim().to_lowercase();
    if raw.is_empty() || raw == "symlink" {
        return Ok(ClaudeSkillMode::Symlink);
    }
    if raw == "copy" {
        return Ok(ClaudeSkillMode::Copy);
    }
    Err(format!(
        "RIPMAIL_CLAUDE_SKILL_MODE must be copy or symlink (got: {raw})"
    ))
}

fn install_skill_symlink(src_abs: &Path, dest: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        symlink(src_abs, dest).map_err(|e| {
            format!(
                "symlink {} → {}: {e} (try RIPMAIL_CLAUDE_SKILL_MODE=copy)",
                src_abs.display(),
                dest.display()
            )
        })
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::symlink_dir;
        symlink_dir(src_abs, dest).map_err(|e| {
            format!(
                "symlink {} → {}: {e} (try RIPMAIL_CLAUDE_SKILL_MODE=copy)",
                src_abs.display(),
                dest.display()
            )
        })
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err("symlink not supported on this platform; use RIPMAIL_CLAUDE_SKILL_MODE=copy".into())
    }
}

pub(crate) fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let dst_join = dst.join(&name);
        if path.metadata()?.is_dir() {
            copy_dir_all(&path, &dst_join)?;
        } else {
            fs::copy(&path, &dst_join)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::tempdir;

    static SKILL_ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn claude_skill_mode_parses() {
        assert!(matches!(
            parse_claude_skill_mode_str("").unwrap(),
            ClaudeSkillMode::Symlink
        ));
        assert!(matches!(
            parse_claude_skill_mode_str("  Symlink ").unwrap(),
            ClaudeSkillMode::Symlink
        ));
        assert!(matches!(
            parse_claude_skill_mode_str("copy").unwrap(),
            ClaudeSkillMode::Copy
        ));
        assert!(parse_claude_skill_mode_str("oops").is_err());
    }

    #[test]
    fn openclaw_skill_copies_when_skills_dir_exists() {
        let tmp = tempdir().unwrap();
        let home = tmp.path();
        let ws = tmp.path().join("ws");
        let skill = ws.join("skills/ripmail");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), b"name: ripmail\n").unwrap();
        fs::create_dir_all(home.join(".openclaw/skills")).unwrap();

        install_openclaw_skill_workspace_at(&ws, home, false).unwrap();

        assert!(home.join(".openclaw/skills/ripmail/SKILL.md").is_file());
    }

    #[test]
    fn openclaw_skill_noop_when_openclaw_skills_missing() {
        let tmp = tempdir().unwrap();
        let home = tmp.path();
        let ws = tmp.path().join("ws");
        let skill = ws.join("skills/ripmail");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), b"x").unwrap();

        install_openclaw_skill_workspace_at(&ws, home, false).unwrap();

        assert!(!home.join(".openclaw/skills").exists());
    }

    #[test]
    fn embed_writes_skill_md_to_custom_claude_dest() {
        let _g = SKILL_ENV_LOCK.lock().unwrap();
        let tmp = tempdir().unwrap();
        let dest = tmp.path().join("out/ripmail");
        install_claude_embed_at_path(&dest, false).unwrap();
        let skill_md = dest.join("SKILL.md");
        assert!(skill_md.is_file());
        let text = fs::read_to_string(&skill_md).unwrap();
        assert!(text.contains("name:") || text.contains("ripmail"));
    }

    #[test]
    fn embed_replaces_existing_directory() {
        let _g = SKILL_ENV_LOCK.lock().unwrap();
        let tmp = tempdir().unwrap();
        let dest = tmp.path().join("out/ripmail");
        install_claude_embed_at_path(&dest, false).unwrap();
        install_claude_embed_at_path(&dest, false).unwrap();
        assert!(dest.join("SKILL.md").is_file());
    }

    /// Dangling symlinks report `exists() == false` but still occupy the path and make
    /// `create_dir_all` fail with EEXIST without removal.
    #[cfg(unix)]
    #[test]
    fn embed_replaces_dangling_symlink_at_dest() {
        use std::os::unix::fs::symlink;
        let _g = SKILL_ENV_LOCK.lock().unwrap();
        let tmp = tempdir().unwrap();
        let dest = tmp.path().join("out/ripmail");
        let missing = tmp.path().join("nope");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        symlink(&missing, &dest).unwrap();
        install_claude_embed_at_path(&dest, false).unwrap();
        assert!(dest.join("SKILL.md").is_file());
    }

    #[test]
    fn embed_skip_claude_skips_write() {
        let _g = SKILL_ENV_LOCK.lock().unwrap();
        let tmp = tempdir().unwrap();
        let dest = tmp.path().join("out/ripmail");
        std::env::set_var("RIPMAIL_CLAUDE_SKILL_DIR", &dest);
        std::env::set_var("RIPMAIL_SKIP_CLAUDE_SKILL", "1");
        install_claude_skill_from_embed(false).unwrap();
        std::env::remove_var("RIPMAIL_CLAUDE_SKILL_DIR");
        std::env::remove_var("RIPMAIL_SKIP_CLAUDE_SKILL");
        assert!(!dest.exists());
    }

    #[test]
    fn embed_openclaw_copies_when_layout_exists() {
        let _g = SKILL_ENV_LOCK.lock().unwrap();
        let tmp = tempdir().unwrap();
        let home = tmp.path();
        fs::create_dir_all(home.join(".openclaw/skills")).unwrap();
        let old_home = std::env::var_os("HOME");
        std::env::set_var("HOME", home);
        std::env::remove_var("RIPMAIL_SKIP_OPENCLAW_SKILL");
        let r = install_openclaw_skill_embed_at(home, false);
        match &old_home {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
        r.unwrap();
        assert!(home.join(".openclaw/skills/ripmail/SKILL.md").is_file());
    }
}
