//! Append-only sync file logger (`RIPMAIL_HOME/logs/sync.log` — mirrors Node `SYNC_LOG_PATH`).

use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::observability::nr_diagnostic_logs::{
    forward_sync_log_line, forward_sync_run_start, nr_diag_enabled_from_parts,
};

/// Fixed path segment under `RIPMAIL_HOME`.
pub fn sync_log_path(ripmail_home: &Path) -> PathBuf {
    ripmail_home.join("logs").join("sync.log")
}

/// Snapshot for optional New Relic Log API forwarding (no stdout/stderr).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncDiagForwardConfig {
    pub forward_nr: bool,
    pub tenant_user_id: Option<String>,
    pub workspace_handle: Option<String>,
}

fn trim_opt(s: Option<&str>) -> Option<String> {
    s.and_then(|t| {
        let t = t.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

/// Same rules as [`SyncFileLogger::open`] for tests without mutating process env.
pub fn sync_diag_forward_config_from_env_parts(
    license_key: Option<&str>,
    node_env: Option<&str>,
    ripmail_nr_diagnostics: Option<&str>,
    brain_tenant_user_id: Option<&str>,
    brain_workspace_handle: Option<&str>,
) -> SyncDiagForwardConfig {
    SyncDiagForwardConfig {
        forward_nr: nr_diag_enabled_from_parts(license_key, node_env, ripmail_nr_diagnostics),
        tenant_user_id: trim_opt(brain_tenant_user_id),
        workspace_handle: trim_opt(brain_workspace_handle),
    }
}

fn sync_diag_forward_config_from_process_env() -> SyncDiagForwardConfig {
    sync_diag_forward_config_from_env_parts(
        std::env::var("NEW_RELIC_LICENSE_KEY").ok().as_deref(),
        std::env::var("NODE_ENV").ok().as_deref(),
        std::env::var("RIPMAIL_NR_DIAGNOSTICS").ok().as_deref(),
        std::env::var("BRAIN_TENANT_USER_ID").ok().as_deref(),
        std::env::var("BRAIN_WORKSPACE_HANDLE").ok().as_deref(),
    )
}

pub struct SyncFileLogger {
    path: PathBuf,
    file: Mutex<std::fs::File>,
    forward_nr: bool,
    tenant_user_id: Option<String>,
    workspace_handle: Option<String>,
}

impl Clone for SyncFileLogger {
    fn clone(&self) -> Self {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .unwrap_or_else(|e| panic!("sync log reopen {}: {e}", self.path.display()));
        Self {
            path: self.path.clone(),
            file: Mutex::new(file),
            forward_nr: self.forward_nr,
            tenant_user_id: self.tenant_user_id.clone(),
            workspace_handle: self.workspace_handle.clone(),
        }
    }
}

impl SyncFileLogger {
    pub fn open(ripmail_home: &Path) -> std::io::Result<Self> {
        let cfg = sync_diag_forward_config_from_process_env();
        Self::open_with_diag_config(ripmail_home, cfg)
    }

    pub fn open_with_diag_config(
        ripmail_home: &Path,
        cfg: SyncDiagForwardConfig,
    ) -> std::io::Result<Self> {
        let dir = ripmail_home.join("logs");
        create_dir_all(&dir)?;
        let path = dir.join("sync.log");
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            path,
            file: Mutex::new(file),
            forward_nr: cfg.forward_nr,
            tenant_user_id: cfg.tenant_user_id,
            workspace_handle: cfg.workspace_handle,
        })
    }

    pub fn log_path(&self) -> &Path {
        &self.path
    }

    pub fn write_separator(&self, pid: u32) {
        let line = format!(
            "\n{} ===== ripmail sync run pid={} =====\n",
            chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ"),
            pid
        );
        let _ = self.write_line(&line);

        if self.forward_nr {
            forward_sync_run_start(
                pid,
                self.tenant_user_id.as_deref(),
                self.workspace_handle.as_deref(),
            );
        }
    }

    pub fn info(&self, msg: &str, data: Option<&str>) {
        self.log("INFO", msg, data);
    }

    pub fn debug(&self, msg: &str, data: Option<&str>) {
        self.log("DEBUG", msg, data);
    }

    pub fn warn(&self, msg: &str, data: Option<&str>) {
        self.log("WARN", msg, data);
    }

    pub fn error(&self, msg: &str, data: Option<&str>) {
        self.log("ERROR", msg, data);
    }

    fn log(&self, level: &str, msg: &str, data: Option<&str>) {
        let ts = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
        let line = match data {
            Some(d) => format!("[{ts}] {level} {msg} {d}\n"),
            None => format!("[{ts}] {level} {msg}\n"),
        };
        let _ = self.write_line(&line);

        if self.forward_nr {
            forward_sync_log_line(
                level,
                msg,
                data,
                self.tenant_user_id.as_deref(),
                self.workspace_handle.as_deref(),
            );
        }
    }

    fn write_line(&self, line: &str) -> std::io::Result<()> {
        let mut f = self
            .file
            .lock()
            .map_err(|e| std::io::Error::other(format!("log mutex: {e}")))?;
        f.write_all(line.as_bytes())?;
        f.flush()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_diag_forward_config_production_with_license() {
        let c = sync_diag_forward_config_from_env_parts(
            Some("lic"),
            Some("production"),
            None,
            None,
            None,
        );
        assert!(c.forward_nr);
        assert_eq!(c.tenant_user_id, None);
        assert_eq!(c.workspace_handle, None);
    }

    #[test]
    fn sync_diag_forward_config_non_prod_without_opt_in() {
        let c = sync_diag_forward_config_from_env_parts(
            Some("lic"),
            Some("development"),
            None,
            None,
            None,
        );
        assert!(!c.forward_nr);
        let c2 =
            sync_diag_forward_config_from_env_parts(None, Some("production"), None, None, None);
        assert!(!c2.forward_nr);
    }

    #[test]
    fn sync_diag_forward_config_opt_in_local() {
        let c = sync_diag_forward_config_from_env_parts(
            Some("lic"),
            Some("development"),
            Some("1"),
            None,
            None,
        );
        assert!(c.forward_nr);
    }

    #[test]
    fn sync_diag_forward_config_trims_tenant_fields() {
        let c = sync_diag_forward_config_from_env_parts(
            Some("lic"),
            Some("production"),
            None,
            Some("  usr_abc  "),
            Some(" handle-slug "),
        );
        assert!(c.forward_nr);
        assert_eq!(c.tenant_user_id.as_deref(), Some("usr_abc"));
        assert_eq!(c.workspace_handle.as_deref(), Some("handle-slug"));
    }

    #[test]
    fn sync_diag_forward_config_empty_strings_become_none() {
        let c = sync_diag_forward_config_from_env_parts(
            Some("lic"),
            Some("production"),
            Some(""),
            Some("   "),
            Some(""),
        );
        assert_eq!(c.tenant_user_id, None);
        assert_eq!(c.workspace_handle, None);
    }
}
