//! Detached `ripmail sync` child process (same behavior as CLI background sync).

use std::path::Path;
use std::process::Stdio;

use std::collections::HashMap;

use crate::config::{resolve_mailbox_spec, Config, MailboxImapAuthKind, ResolvedMailbox};
use crate::db;
use crate::status::print_status_text;
use crate::sync::{
    connect_imap_for_resolved_mailbox, is_sync_lock_held, read_sync_lock_row_optional,
    sync_log_path, SyncKind,
};

/// Which mailbox to validate before spawning a background `backfill --foreground` child.
///
/// Non-mail sources (calendar, ICS, localDir, Google Drive) are skipped for IMAP precondition
/// checks; only [`ResolvedMailbox::is_mail`] targets need `imap_user` / OAuth probing.
fn mailbox_for_background_imap_probe<'a>(
    resolved: &'a [ResolvedMailbox],
    mailbox_filter: Option<&str>,
) -> Result<Option<&'a ResolvedMailbox>, Box<dyn std::error::Error>> {
    if resolved.is_empty() {
        return Err("No mailboxes configured. Run `ripmail setup`.".into());
    }
    Ok(
        if let Some(spec) = mailbox_filter.map(str::trim).filter(|s| !s.is_empty()) {
            let mb = resolve_mailbox_spec(resolved, spec).ok_or_else(|| {
                format!(
                    "Unknown mailbox {spec:?}. Configured: {}",
                    resolved
                        .iter()
                        .map(|x| x.email.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })?;
            if mb.is_mail() {
                Some(mb)
            } else {
                None
            }
        } else {
            resolved.iter().find(|m| m.is_mail())
        },
    )
}

fn imap_probe_session(
    cfg: &Config,
    mailbox: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let home = &cfg.ripmail_home;
    let env_file = crate::config::read_ripmail_env_file(home);
    let process_env: HashMap<String, String> = std::env::vars().collect();

    let Some(mb) = mailbox_for_background_imap_probe(cfg.resolved_mailboxes(), mailbox)? else {
        return Ok(());
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

/// Run `ripmail backfill --foreground --since …` in the foreground (same binary; blocks until done).
pub fn run_refresh_foreground_subprocess(
    home: &Path,
    since: &str,
    mailbox: Option<&str>,
    verbose: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = std::process::Command::new(std::env::current_exe()?);
    cmd.env("RIPMAIL_HOME", home);
    cmd.arg("backfill")
        .arg("--foreground")
        .arg("--since")
        .arg(since);
    if verbose {
        cmd.arg("--verbose");
    }
    if let Some(m) = mailbox.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.arg("--source").arg(m);
    }
    let status = cmd.status()?;
    if !status.success() {
        return Err(format!("backfill exited with status {status}").into());
    }
    Ok(())
}

/// Spawn the current binary with `backfill --foreground [--since …] [--source …]` in the background (Node `detached: true`).
pub fn spawn_sync_background_detached(
    home: &Path,
    cfg: &Config,
    since_override: Option<&str>,
    mailbox: Option<&str>,
    verbose: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let conn = db::open_file(cfg.db_path())?;
    let lock_row = read_sync_lock_row_optional(&conn, SyncKind::Backfill)?;
    if is_sync_lock_held(lock_row.as_ref()) {
        println!(
            "Backfill already running (PID: {:?})\n",
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
    cmd.arg("backfill").arg("--foreground");
    if let Some(s) = since_override {
        if !s.is_empty() {
            cmd.arg("--since").arg(s);
        }
    }
    if let Some(m) = mailbox.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.arg("--source").arg(m);
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

#[cfg(test)]
mod background_imap_probe_tests {
    use super::mailbox_for_background_imap_probe;
    use crate::config::{
        CalendarSourceResolved, MailboxImapAuthKind, ResolvedMailbox, ResolvedSource, SourceKind,
    };
    use std::path::PathBuf;

    fn base_maildir_stub() -> PathBuf {
        PathBuf::from("/tmp/ripmail-probe-test-maildir-stub")
    }

    fn ics_subscription(id: &str) -> ResolvedMailbox {
        ResolvedSource {
            id: id.to_string(),
            kind: SourceKind::IcsSubscription,
            email: String::new(),
            imap_host: String::new(),
            imap_port: 993,
            imap_user: String::new(),
            imap_aliases: Vec::new(),
            imap_password: String::new(),
            imap_auth: MailboxImapAuthKind::AppPassword,
            include_in_default: true,
            maildir_path: base_maildir_stub().join(id),
            apple_mail_root: None,
            file_source: None,
            calendar: Some(CalendarSourceResolved::IcsUrl {
                url: "https://example.invalid/cal.ics".into(),
            }),
            google_drive: None,
        }
    }

    fn google_calendar_stub(id: &str, email: &str) -> ResolvedMailbox {
        ResolvedSource {
            id: id.to_string(),
            kind: SourceKind::GoogleCalendar,
            email: email.to_string(),
            imap_host: String::new(),
            imap_port: 993,
            imap_user: email.to_string(),
            imap_aliases: Vec::new(),
            imap_password: String::new(),
            imap_auth: MailboxImapAuthKind::GoogleOAuth,
            include_in_default: true,
            maildir_path: base_maildir_stub().join(id),
            apple_mail_root: None,
            file_source: None,
            calendar: Some(CalendarSourceResolved::Google {
                email: email.to_string(),
                calendar_ids: vec!["primary".into()],
                token_mailbox_id: id.to_string(),
            }),
            google_drive: None,
        }
    }

    fn imap_mailbox_stub(id: &str, email: &str) -> ResolvedMailbox {
        ResolvedSource {
            id: id.to_string(),
            kind: SourceKind::Imap,
            email: email.to_string(),
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            imap_user: email.to_string(),
            imap_aliases: Vec::new(),
            imap_password: String::new(),
            imap_auth: MailboxImapAuthKind::GoogleOAuth,
            include_in_default: true,
            maildir_path: base_maildir_stub().join(id),
            apple_mail_root: None,
            file_source: None,
            calendar: None,
            google_drive: None,
        }
    }

    #[test]
    fn picker_skips_calendar_and_ics_to_find_first_imap_when_unfiltered() {
        let resolved = vec![
            ics_subscription("ics1"),
            google_calendar_stub("cal1", "cal@example.com"),
            imap_mailbox_stub("mb1", "user@gmail.com"),
        ];
        let picked = mailbox_for_background_imap_probe(&resolved, None)
            .expect("pick")
            .expect("Imap mailbox expected");
        assert_eq!(picked.id, "mb1");
        assert_eq!(picked.imap_user, "user@gmail.com");
    }

    #[test]
    fn picker_calendar_only_returns_none_when_unfiltered() {
        let resolved = vec![
            ics_subscription("ics1"),
            google_calendar_stub("cal1", "c@example.com"),
        ];
        assert!(mailbox_for_background_imap_probe(&resolved, None)
            .expect("pick ok")
            .is_none());
    }

    #[test]
    fn picker_explicit_calendar_resolves_but_skips_imap_validation() {
        let resolved = vec![
            imap_mailbox_stub("mb1", "user@gmail.com"),
            ics_subscription("ics1"),
        ];
        let picked =
            mailbox_for_background_imap_probe(&resolved, Some("ics1")).expect("resolve ics ok");
        assert!(
            picked.is_none(),
            "calendar/ICS `--source` should not trigger IMAP probe"
        );
    }

    #[test]
    fn picker_empty_config_errors() {
        assert!(mailbox_for_background_imap_probe(&[], None).is_err());
    }
}
