//! One-time migration from legacy single-mailbox layout (`data/ripmail.db`, `data/maildir/`, IMAP
//! password in root `~/.ripmail/.env`) to multi-inbox layout ([OPP-016](../docs/opportunities/archive/OPP-016-multi-inbox.md)):
//! `ripmail.db` at `RIPMAIL_HOME`, `<mailbox_id>/maildir/`, `<mailbox_id>/.env` for IMAP, root `.env`
//! for shared keys only.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::config::{derive_mailbox_id_from_email, ConfigJson};

/// Returns `true` when the home directory looks like a **legacy** install that should be
/// migrated: top-level `imap` user in `config.json`, **no** `sources` array yet, and a DB at
/// `data/ripmail.db`.
pub fn needs_legacy_layout_migration(home: &Path) -> bool {
    let cfg_path = home.join("config.json");
    if !cfg_path.is_file() {
        return false;
    }
    let Ok(raw) = fs::read_to_string(&cfg_path) else {
        return false;
    };
    let Ok(j) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    if j.get("sources")
        .and_then(|m| m.as_array())
        .map(|a| !a.is_empty())
        == Some(true)
    {
        return false;
    }
    let has_legacy_imap_user = j
        .get("imap")
        .and_then(|i| i.get("user"))
        .and_then(|u| u.as_str())
        .map(|s| !s.trim().is_empty())
        == Some(true);
    if !has_legacy_imap_user {
        return false;
    }
    home.join("data").join("ripmail.db").is_file()
}

/// Move legacy `data/` maildir + DB into multi-inbox layout and rewrite `config.json` + `.env`.
/// Idempotent: if `config.json` already lists non-empty `sources`, returns `Ok(())` immediately.
pub fn migrate_legacy_layout_to_multi_inbox(home: &Path) -> Result<(), MigrateLegacyError> {
    if !needs_legacy_layout_migration(home) {
        return Ok(());
    }

    let raw = fs::read_to_string(home.join("config.json"))?;
    let old: ConfigJson =
        serde_json::from_str(&raw).map_err(|e| MigrateLegacyError::Json(e.to_string()))?;
    let imap = old
        .imap
        .as_ref()
        .ok_or_else(|| MigrateLegacyError::Invariant("missing imap block".into()))?;
    let email = imap
        .user
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| MigrateLegacyError::Invariant("missing imap.user".into()))?
        .to_string();

    let mailbox_id = derive_mailbox_id_from_email(&email);
    let mb_dir = home.join(&mailbox_id);
    fs::create_dir_all(&mb_dir)?;

    let data_dir = home.join("data");
    let legacy_maildir = data_dir.join("maildir");
    let new_maildir = mb_dir.join("maildir");
    if legacy_maildir.is_dir() {
        if new_maildir.exists() {
            return Err(MigrateLegacyError::Invariant(format!(
                "target maildir already exists: {}",
                new_maildir.display()
            )));
        }
        fs::rename(&legacy_maildir, &new_maildir)?;
    }

    let legacy_db = data_dir.join("ripmail.db");
    let new_db = home.join("ripmail.db");
    if legacy_db.is_file() {
        rename_sqlite_bundle(&legacy_db, &new_db)?;
    }

    if new_db.is_file() {
        prefix_paths_in_database(&new_db, &mailbox_id)?;
    }

    let mut root_dotenv = parse_dotenv_map(&home.join(".env"));
    let imap_pw = root_dotenv
        .remove("RIPMAIL_IMAP_PASSWORD")
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            MigrateLegacyError::Invariant(
                "root .env missing RIPMAIL_IMAP_PASSWORD (cannot migrate IMAP secret)".into(),
            )
        })?;

    let mut mb_env = String::new();
    mb_env.push_str(&format!("RIPMAIL_IMAP_PASSWORD={imap_pw}\n"));
    fs::write(mb_dir.join(".env"), mb_env)?;

    write_root_dotenv_from_map(&home.join(".env"), &root_dotenv);

    let new_cfg = build_migrated_config_json(&old, &email, &mailbox_id)?;
    fs::write(
        home.join("config.json"),
        serde_json::to_string_pretty(&new_cfg)? + "\n",
    )?;

    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum MigrateLegacyError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(String),
    #[error("invariant: {0}")]
    Invariant(String),
}

impl From<serde_json::Error> for MigrateLegacyError {
    fn from(e: serde_json::Error) -> Self {
        MigrateLegacyError::Json(e.to_string())
    }
}

fn rename_sqlite_bundle(from: &Path, to: &Path) -> Result<(), io::Error> {
    if to.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("destination db exists: {}", to.display()),
        ));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(from, to)?;
    for suffix in ["-wal", "-shm"] {
        let mut from_s = from.as_os_str().to_os_string();
        from_s.push(suffix);
        let from_p = PathBuf::from(from_s);
        if from_p.is_file() {
            let mut to_s = to.as_os_str().to_os_string();
            to_s.push(suffix);
            let _ = fs::rename(from_p, PathBuf::from(to_s));
        }
    }
    Ok(())
}

fn prefix_paths_in_database(db_path: &Path, mailbox_id: &str) -> Result<(), rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         BEGIN IMMEDIATE;",
    )?;
    let prefix = format!("{mailbox_id}/");
    conn.execute(
        "UPDATE messages SET raw_path = ?1 || raw_path WHERE raw_path NOT LIKE ?2",
        rusqlite::params![&prefix, format!("{mailbox_id}/%")],
    )?;
    conn.execute(
        "UPDATE attachments SET stored_path = ?1 || stored_path
         WHERE stored_path NOT LIKE ?2 AND trim(stored_path) != ''",
        rusqlite::params![&prefix, format!("{mailbox_id}/%")],
    )?;
    conn.execute_batch("COMMIT;")?;
    Ok(())
}

fn parse_dotenv_map(path: &Path) -> std::collections::HashMap<String, String> {
    let Ok(content) = fs::read_to_string(path) else {
        return std::collections::HashMap::new();
    };
    let mut map = std::collections::HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            map.insert(k.trim().to_string(), v.to_string());
        }
    }
    map
}

fn write_root_dotenv_from_map(path: &Path, map: &std::collections::HashMap<String, String>) {
    let mut out = String::new();
    for key in ["RIPMAIL_OPENAI_API_KEY", "OPENAI_API_KEY"] {
        if let Some(v) = map.get(key) {
            if !v.trim().is_empty() {
                out.push_str(key);
                out.push('=');
                out.push_str(v);
                out.push('\n');
            }
        }
    }
    if out.is_empty() {
        let _ = fs::remove_file(path);
    } else {
        let _ = fs::write(path, out);
    }
}

fn build_migrated_config_json(
    old: &ConfigJson,
    email: &str,
    mailbox_id: &str,
) -> Result<serde_json::Value, MigrateLegacyError> {
    let imap_host = old
        .imap
        .as_ref()
        .and_then(|i| i.host.clone())
        .unwrap_or_else(|| "imap.gmail.com".into());
    let imap_port = old.imap.as_ref().and_then(|i| i.port).unwrap_or(993);
    let aliases = old.imap.as_ref().and_then(|i| i.aliases.clone());

    let mut v = serde_json::to_value(old).map_err(|e| MigrateLegacyError::Json(e.to_string()))?;
    if let serde_json::Value::Object(ref mut m) = v {
        m.remove("imap");
        m.insert(
            "sources".into(),
            serde_json::json!([{
                "id": mailbox_id,
                "kind": "imap",
                "email": email,
                "imap": {
                    "host": imap_host,
                    "port": imap_port,
                    "aliases": aliases,
                }
            }]),
        );
    }
    Ok(v)
}

fn first_mailbox_id_in_config(home: &Path) -> Option<String> {
    let raw = fs::read_to_string(home.join("config.json")).ok()?;
    let cfg: ConfigJson = serde_json::from_str(&raw).ok()?;
    let id = cfg.sources.as_ref()?.first()?.id.trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

fn dir_is_empty(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut rd| rd.next().is_none())
        .unwrap_or(false)
}

fn can_deferred_move_maildir(home: &Path, mailbox_id: &str) -> bool {
    let legacy = home.join("data").join("maildir");
    let new_maildir = home.join(mailbox_id).join("maildir");
    if !legacy.is_dir() {
        return false;
    }
    !new_maildir.exists() || (new_maildir.is_dir() && dir_is_empty(&new_maildir))
}

fn can_deferred_move_db(home: &Path) -> bool {
    let legacy = home.join("data").join("ripmail.db");
    let new_db = home.join("ripmail.db");
    legacy.is_file() && !new_db.is_file()
}

/// `true` when `sources[]` is already present but legacy `data/maildir` or `data/ripmail.db`
/// still need moving into the multi-inbox layout (e.g. after `ripmail setup` wrote `sources`
/// before the automatic migration could run).
pub fn needs_deferred_legacy_data_migration(home: &Path) -> bool {
    if needs_legacy_layout_migration(home) {
        return false;
    }
    let Some(id) = first_mailbox_id_in_config(home) else {
        return false;
    };
    can_deferred_move_db(home) || can_deferred_move_maildir(home, &id)
}

/// Move legacy `data/maildir` and `data/ripmail.db` using **rename only** (no copying). Updates
/// path prefixes in SQLite when the DB is present at `RIPMAIL_HOME/ripmail.db`.
fn migrate_deferred_legacy_data_impl(home: &Path) -> Result<bool, MigrateLegacyError> {
    if needs_legacy_layout_migration(home) {
        return Ok(false);
    }
    let Some(mailbox_id) = first_mailbox_id_in_config(home) else {
        return Ok(false);
    };

    let data_dir = home.join("data");
    let legacy_maildir = data_dir.join("maildir");
    let legacy_db = data_dir.join("ripmail.db");
    let new_db = home.join("ripmail.db");
    let new_maildir = home.join(&mailbox_id).join("maildir");

    let mut maildir_moved = false;
    let mut db_moved = false;

    if legacy_maildir.is_dir() {
        if new_maildir.exists() {
            if new_maildir.is_dir() && dir_is_empty(&new_maildir) {
                fs::remove_dir(&new_maildir)?;
            } else {
                eprintln!(
                    "ripmail: cannot move {} to {} (target exists); remove or merge manually",
                    legacy_maildir.display(),
                    new_maildir.display()
                );
            }
        }
        if !new_maildir.exists() {
            if let Some(parent) = new_maildir.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(&legacy_maildir, &new_maildir)?;
            maildir_moved = true;
        }
    }

    if legacy_db.is_file() {
        if new_db.is_file() {
            eprintln!(
                "ripmail: skipping legacy {} ({} already exists)",
                legacy_db.display(),
                new_db.display()
            );
        } else {
            rename_sqlite_bundle(&legacy_db, &new_db)?;
            db_moved = true;
        }
    }

    if (maildir_moved || db_moved) && new_db.is_file() {
        prefix_paths_in_database(&new_db, &mailbox_id)?;
    }

    Ok(maildir_moved || db_moved)
}

/// Run deferred data migration when needed (optional tooling/tests; not run automatically).
pub fn migrate_deferred_legacy_data_if_needed(home: &Path) {
    if !needs_deferred_legacy_data_migration(home) {
        return;
    }
    match migrate_deferred_legacy_data_impl(home) {
        Ok(true) => {
            eprintln!(
                "Migrated legacy data/ into multi-inbox layout: {}",
                home.display()
            );
        }
        Ok(false) => {}
        Err(e) => {
            eprintln!(
                "ripmail: deferred data migration failed ({}); fix or remove ~/.ripmail and re-run setup.",
                e
            );
        }
    }
}

/// `RIPMAIL_HOME` for a database path (`…/ripmail.db` or legacy `…/data/ripmail.db`).
pub fn ripmail_home_from_db_path(db_path: &Path) -> PathBuf {
    let Some(parent) = db_path.parent() else {
        return PathBuf::from(".");
    };
    let file_name = db_path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if parent.file_name().and_then(|s| s.to_str()) == Some("data") && file_name == "ripmail.db" {
        parent.parent().unwrap_or(parent).to_path_buf()
    } else {
        parent.to_path_buf()
    }
}

/// Same as [`migrate_deferred_legacy_data_if_needed`], using the DB path to infer `RIPMAIL_HOME`.
pub fn migrate_deferred_legacy_data_if_needed_for_db_path(db_path: &Path) {
    migrate_deferred_legacy_data_if_needed(&ripmail_home_from_db_path(db_path));
}

/// Infer maildir root for rebuild when the DB lives at `RIPMAIL_HOME/ripmail.db` (multi-inbox) or
/// legacy `data/ripmail.db`.
pub fn infer_maildir_root_for_db_path(db_path: &Path) -> PathBuf {
    let Some(parent) = db_path.parent() else {
        return PathBuf::from("maildir");
    };
    let legacy = parent.join("maildir");
    if legacy.is_dir() {
        return legacy;
    }
    let cfg_path = parent.join("config.json");
    if let Ok(raw) = fs::read_to_string(cfg_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(arr) = v.get("sources").and_then(|m| m.as_array()) {
                if let Some(first) = arr.first() {
                    if let Some(id) = first.get("id").and_then(|x| x.as_str()) {
                        return parent.join(id).join("maildir");
                    }
                }
            }
        }
    }
    parent.join("data").join("maildir")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::derive_mailbox_id_from_email;

    #[test]
    fn derive_id_gmail() {
        assert_eq!(
            derive_mailbox_id_from_email("User@gmail.com"),
            "user_gmail_com"
        );
    }

    #[test]
    fn migrate_moves_db_and_maildir_and_updates_paths() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();

        fs::create_dir_all(home.join("data/maildir/cur")).unwrap();
        fs::write(home.join("data/maildir/cur/a.eml"), b"x").unwrap();

        let cfg = serde_json::json!({
            "imap": { "host": "imap.gmail.com", "port": 993, "user": "a@b.com" },
            "sync": { "defaultSince": "1y", "mailbox": "", "excludeLabels": ["Trash", "Spam"] }
        });
        fs::write(
            home.join("config.json"),
            serde_json::to_string(&cfg).unwrap(),
        )
        .unwrap();
        fs::write(
            home.join(".env"),
            "RIPMAIL_IMAP_PASSWORD=secret\nRIPMAIL_OPENAI_API_KEY=sk-x\n",
        )
        .unwrap();

        let db_path = home.join("data/ripmail.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE messages (
                    message_id TEXT PRIMARY KEY,
                    raw_path TEXT NOT NULL
                );
                CREATE TABLE attachments (
                    message_id TEXT,
                    stored_path TEXT
                );
                INSERT INTO messages (message_id, raw_path) VALUES ('<m>', 'maildir/cur/a.eml');",
        )
        .unwrap();
        drop(conn);

        migrate_legacy_layout_to_multi_inbox(home).unwrap();

        let id = derive_mailbox_id_from_email("a@b.com");
        assert!(home.join("ripmail.db").is_file());
        assert!(home.join(&id).join("maildir/cur/a.eml").is_file());
        assert!(!home.join("data/maildir").exists());

        let conn = Connection::open(home.join("ripmail.db")).unwrap();
        let raw: String = conn
            .query_row("SELECT raw_path FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, format!("{id}/maildir/cur/a.eml"));
        drop(conn);

        let root_env = fs::read_to_string(home.join(".env")).unwrap();
        assert!(root_env.contains("RIPMAIL_OPENAI_API_KEY"));
        assert!(!root_env.contains("RIPMAIL_IMAP_PASSWORD"));

        let mb_env = fs::read_to_string(home.join(&id).join(".env")).unwrap();
        assert!(mb_env.contains("RIPMAIL_IMAP_PASSWORD=secret"));

        let new_cfg: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(home.join("config.json")).unwrap()).unwrap();
        assert!(!new_cfg
            .get("sources")
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn deferred_migrate_renames_when_mailboxes_already_present() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let id = derive_mailbox_id_from_email("a@b.com");

        fs::create_dir_all(home.join("data/maildir/cur")).unwrap();
        fs::write(home.join("data/maildir/cur/a.eml"), b"x").unwrap();

        let cfg = serde_json::json!({
            "sources": [{
                "id": id,
                "kind": "imap",
                "email": "a@b.com",
                "imap": { "host": "imap.gmail.com", "port": 993 }
            }],
            "sync": { "defaultSince": "1y", "mailbox": "", "excludeLabels": ["Trash", "Spam"] }
        });
        fs::write(
            home.join("config.json"),
            serde_json::to_string(&cfg).unwrap(),
        )
        .unwrap();

        let db_path = home.join("data/ripmail.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE messages (
                    message_id TEXT PRIMARY KEY,
                    raw_path TEXT NOT NULL
                );
                CREATE TABLE attachments (message_id TEXT, stored_path TEXT);
                INSERT INTO messages (message_id, raw_path) VALUES ('<m>', 'maildir/cur/a.eml');",
        )
        .unwrap();
        drop(conn);

        fs::create_dir_all(home.join(&id)).unwrap();

        assert!(needs_deferred_legacy_data_migration(home));
        migrate_deferred_legacy_data_if_needed(home);
        assert!(!needs_deferred_legacy_data_migration(home));

        assert!(home.join("ripmail.db").is_file());
        assert!(home.join(&id).join("maildir/cur/a.eml").is_file());
        assert!(!home.join("data/maildir").exists());

        let conn = Connection::open(home.join("ripmail.db")).unwrap();
        let raw: String = conn
            .query_row("SELECT raw_path FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, format!("{id}/maildir/cur/a.eml"));
    }
}
