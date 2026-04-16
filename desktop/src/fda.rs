//! Full Disk Access probe (macOS): read a TCC-protected path; success implies FDA granted.
//!
//! We try several known TCC-protected locations (see BUG-004). If `com.apple.stocks` does not
//! exist yet (ENOENT), that is **not** proof of missing FDA — we fall through to other probes.
//! Only permission errors on an existing path indicate FDA is off.
use std::io::ErrorKind;
use std::path::PathBuf;

#[cfg(target_os = "macos")]
fn candidate_paths(home: &std::ffi::OsStr) -> [(&'static str, PathBuf); 3] {
    let base = PathBuf::from(home);
    [
        ("stocks", base.join("Library/Containers/com.apple.stocks")),
        ("safari", base.join("Library/Safari")),
        ("mail", base.join("Library/Mail")),
    ]
}

/// One-shot startup log (Tauri main process). Search Console / `log stream` for `[fda]`.
#[cfg(target_os = "macos")]
pub fn log_probe_diagnostics() {
    let Some(home) = std::env::var_os("HOME") else {
        log::info!("[fda] HOME unset — cannot probe FDA");
        return;
    };
    log::info!(
        "[fda] Rust probe pid={} HOME={}",
        std::process::id(),
        home.to_string_lossy()
    );
    for (label, path) in candidate_paths(&home) {
        match std::fs::read_dir(&path) {
            Ok(_) => {
                log::info!(
                    "[fda] [{}] path={} read_dir=OK (FDA probe passed for this path)",
                    label,
                    path.display()
                );
            }
            Err(e) if e.kind() == ErrorKind::NotFound => {
                log::info!(
                    "[fda] [{}] path={} read_dir=ENOENT (skip — path missing, not a permission verdict)",
                    label,
                    path.display()
                );
            }
            Err(e) => {
                log::info!(
                    "[fda] [{}] path={} read_dir=FAIL kind={:?} raw={}",
                    label,
                    path.display(),
                    e.kind(),
                    e
                );
            }
        }
    }
    log::info!(
        "[fda] Rust inferred granted={} (WebView gate uses this process)",
        is_fda_granted()
    );
}

#[cfg(not(target_os = "macos"))]
pub fn log_probe_diagnostics() {}

/// Returns whether Full Disk Access appears granted (probe-read of a protected path).
/// On non-macOS, always `true` (no FDA concept).
pub fn is_fda_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = std::env::var_os("HOME") else {
            return false;
        };
        for (_, path) in candidate_paths(&home) {
            match std::fs::read_dir(&path) {
                Ok(_) => return true,
                Err(e) if e.kind() == ErrorKind::NotFound => continue,
                Err(_) => return false,
            }
        }
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Opens System Settings → Privacy & Security → Full Disk Access.
pub fn open_fda_system_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = ();
    }
}

#[cfg(test)]
mod tests {
    use super::is_fda_granted;

    #[test]
    fn is_fda_granted_returns_bool_without_panicking() {
        let _ = is_fda_granted();
    }
}
