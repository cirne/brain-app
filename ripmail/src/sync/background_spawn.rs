//! Detached `ripmail sync` child process (same behavior as CLI background sync).

use std::path::Path;
use std::process::Stdio;

use std::collections::HashMap;

use crate::config::{resolve_mailbox_spec, Config, MailboxImapAuthKind};
use crate::db;
use crate::status::print_status_text;
use crate::sync::{
    connect_imap_for_resolved_mailbox, is_sync_lock_held, sync_log_path, SyncLockRow,
};

fn imap_probe_session(
    cfg: &Config,
    mailbox: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &cfg.ripmail_home;
    let env_file = crate::config::read_ripmail_env_file(home);
    let process_env: HashMap<String, String> = std::env::vars().collect();

    let mb = if let Some(spec) = mailbox.map(str::trim).filter(|s| !s.is_empty()) {
        resolve_mailbox_spec(&cfg.resolved_mailboxes, spec).ok_or_else(|| {
            format!(
                "Unknown mailbox {spec:?}. Configured: {}",
                cfg.resolved_mailboxes
                    .iter()
                    .map(|x| x.email.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?
    } else {
        cfg.resolved_mailboxes
            .first()
            .ok_or_else(|| "No mailboxes configured. Run `ripmail setup`.".to_string())?
    };

    if mb.apple_mail_root.is_some() {
        return Ok(());
    }

    if mb.imap_user.trim().is_empty() {
        return Err("IMAP user required for this mailbox. Run `ripmail setup`.".into());
    }
    match mb.imap_auth {
        MailboxImapAuthKind::AppPassword if mb.imap_password.trim().is_empty() => {
            return Err("IMAP password required for this mailbox. Run `ripmail setup`.".into());
        }
        MailboxImapAuthKind::GoogleOAuth
            if !crate::oauth::google_oauth_credentials_present(home, &mb.id) =>
        {
            return Err(
                "Google OAuth token missing for this mailbox. Run `ripmail setup --google-oauth`."
                    .into(),
            );
        }
        _ => {}
    }

    let mut auth = connect_imap_for_resolved_mailbox(home, mb, &env_file, &process_env)
        .map_err(|e| e.to_string())?;
    let _ = auth.logout();
    Ok(())
}

/// Run `ripmail refresh --foreground --since …` in the foreground (same binary; blocks until done).
pub fn run_refresh_foreground_subprocess(
    home: &Path,
    since: &str,
    mailbox: Option<&str>,
    verbose: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = std::process::Command::new(std::env::current_exe()?);
    cmd.env("RIPMAIL_HOME", home);
    cmd.arg("refresh")
        .arg("--foreground")
        .arg("--since")
        .arg(since);
    if verbose {
        cmd.arg("--verbose");
    }
    if let Some(m) = mailbox.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.arg("--mailbox").arg(m);
    }
    let status = cmd.status()?;
    if !status.success() {
        return Err(format!("refresh exited with status {status}").into());
    }
    Ok(())
}

/// Spawn the current binary with `refresh --foreground [--since …] [--mailbox …]` in the background (Node `detached: true`).
pub fn spawn_sync_background_detached(
    home: &Path,
    cfg: &Config,
    since_override: Option<&str>,
    mailbox: Option<&str>,
    verbose: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let conn = db::open_file(cfg.db_path())?;
    let lock_row: Option<SyncLockRow> = conn
        .query_row(
            "SELECT is_running, owner_pid, sync_lock_started_at FROM sync_summary WHERE id = 1",
            [],
            |row| {
                Ok(SyncLockRow {
                    is_running: row.get(0)?,
                    owner_pid: row.get(1)?,
                    sync_lock_started_at: row.get(2)?,
                })
            },
        )
        .ok();
    if is_sync_lock_held(lock_row.as_ref()) {
        println!(
            "Sync already running (PID: {:?})\n",
            lock_row.and_then(|r| r.owner_pid)
        );
        print_status_text(&conn, cfg)?;
        return Ok(());
    }
    drop(conn);

    imap_probe_session(cfg, mailbox)?;

    let exe = std::env::current_exe()?;
    let mut cmd = std::process::Command::new(&exe);
    cmd.env("RIPMAIL_HOME", home);
    cmd.arg("refresh").arg("--foreground");
    if let Some(s) = since_override {
        if !s.is_empty() {
            cmd.arg("--since").arg(s);
        }
    }
    if let Some(m) = mailbox.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.arg("--mailbox").arg(m);
    }
    if verbose {
        cmd.arg("--verbose");
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    let pid = {
        let child = cmd.spawn()?;
        child.id()
    };

    let log = sync_log_path(home);
    let empty_index: i64 = {
        let c = db::open_file(cfg.db_path())?;
        c.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?
    };

    println!();
    println!("Sync running in background.");
    println!("  PID:    {pid}");
    println!("  Log:    {}", log.display());
    println!("  Status: ripmail status");
    if empty_index == 0 {
        println!();
        println!("Initial sync can take a while — tail the log or run `ripmail status`.");
        println!("When messages appear, try: ripmail search \"invoice\"  |  ripmail who \"name\"");
    }
    Ok(())
}
