//! `ripmail sources` — list/add/edit/remove/status for `config.json` `sources[]`.

use crate::cli::util::{load_cfg, ripmail_home_path};
use crate::cli::CliResult;
use ripmail::config::{
    derive_mailbox_id_from_email, load_config_json, write_config_json, ImapJson, LocalDirJson,
    SourceConfigJson, SourceKind,
};
use rusqlite::{Connection, OptionalExtension};
use std::path::PathBuf;

fn kind_label(k: SourceKind) -> &'static str {
    match k {
        SourceKind::Imap => "imap",
        SourceKind::AppleMail => "applemail",
        SourceKind::LocalDir => "localDir",
    }
}

fn parse_kind(s: &str) -> Result<SourceKind, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "imap" => Ok(SourceKind::Imap),
        "applemail" => Ok(SourceKind::AppleMail),
        "localdir" => Ok(SourceKind::LocalDir),
        _ => Err(format!(
            "unknown --kind {s:?}; expected imap | applemail | localDir"
        )),
    }
}

fn expand_tilde_path(s: &str) -> PathBuf {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(h) = dirs::home_dir() {
            return h.join(rest);
        }
    }
    PathBuf::from(s)
}

fn default_local_dir() -> LocalDirJson {
    LocalDirJson::default()
}

pub(crate) fn run_sources(cmd: crate::cli::args::SourcesCmd) -> CliResult {
    use crate::cli::args::SourcesCmd;
    let home = ripmail_home_path();
    match cmd {
        SourcesCmd::List { json } => {
            let cfg = load_config_json(&home);
            let arr = cfg.sources.clone().unwrap_or_default();
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({ "sources": arr }))?
                );
            } else if arr.is_empty() {
                println!("(no sources in config.json)");
            } else {
                for s in &arr {
                    println!("{}  kind={}  email={}", s.id, kind_label(s.kind), s.email);
                }
            }
            Ok(())
        }
        SourcesCmd::Add {
            kind,
            path,
            label,
            id,
            email,
            imap_host,
            imap_port,
            apple_mail_path,
            json,
        } => {
            let kind = parse_kind(&kind)?;
            let mut cfg = load_config_json(&home);
            let mut sources = cfg.sources.take().unwrap_or_default();
            let entry = match kind {
                SourceKind::LocalDir => {
                    let path_s = path.ok_or("--path is required for --kind localDir")?;
                    let root = expand_tilde_path(&path_s);
                    let root = root
                        .canonicalize()
                        .map_err(|e| format!("localDir --path {}: {e}", path_s))?;
                    if !root.is_dir() {
                        return Err(format!(
                            "localDir --path is not a directory: {}",
                            root.display()
                        )
                        .into());
                    }
                    let id = id.unwrap_or_else(|| {
                        label
                            .as_ref()
                            .map(|l| derive_mailbox_id_from_email(&format!("x@{l}.local")))
                            .unwrap_or_else(|| {
                                let stem =
                                    root.file_name().and_then(|s| s.to_str()).unwrap_or("dir");
                                derive_mailbox_id_from_email(&format!("x@{stem}.local"))
                            })
                    });
                    SourceConfigJson {
                        id,
                        kind: SourceKind::LocalDir,
                        email: String::new(),
                        label,
                        imap: None,
                        imap_auth: None,
                        search: None,
                        identity: None,
                        apple_mail_path: None,
                        path: Some(root.to_string_lossy().to_string()),
                        local_dir: Some(default_local_dir()),
                    }
                }
                SourceKind::Imap => {
                    let email = email.ok_or("--email is required for --kind imap")?;
                    let id = id.unwrap_or_else(|| derive_mailbox_id_from_email(&email));
                    let host = imap_host.unwrap_or_else(|| "imap.gmail.com".into());
                    let port = imap_port.unwrap_or(993);
                    SourceConfigJson {
                        id,
                        kind: SourceKind::Imap,
                        email: email.clone(),
                        label,
                        imap: Some(ImapJson {
                            host: Some(host),
                            port: Some(port),
                            user: Some(email),
                            aliases: None,
                            imap_auth: None,
                        }),
                        imap_auth: None,
                        search: None,
                        identity: None,
                        apple_mail_path: None,
                        path: None,
                        local_dir: None,
                    }
                }
                SourceKind::AppleMail => {
                    let id = id.unwrap_or_else(|| "applemail".into());
                    SourceConfigJson {
                        id,
                        kind: SourceKind::AppleMail,
                        email: email.unwrap_or_else(|| "applemail@local".into()),
                        label,
                        imap: None,
                        imap_auth: None,
                        search: None,
                        identity: None,
                        apple_mail_path,
                        path: None,
                        local_dir: None,
                    }
                }
            };
            if sources.iter().any(|s| s.id == entry.id) {
                return Err(format!("source id `{}` already exists", entry.id).into());
            }
            let new_id = entry.id.clone();
            sources.push(entry);
            cfg.sources = Some(sources);
            write_config_json(&home, &cfg)?;
            if json {
                println!("{}", serde_json::json!({ "id": new_id }));
            } else {
                println!("Added source id={new_id}");
            }
            Ok(())
        }
        SourcesCmd::Edit {
            id,
            label,
            path,
            json,
        } => {
            let mut cfg = load_config_json(&home);
            let mut sources = cfg.sources.take().unwrap_or_default();
            let pos = sources
                .iter()
                .position(|s| s.id == id)
                .ok_or_else(|| format!("unknown source id {id:?}"))?;
            if let Some(l) = label {
                sources[pos].label = Some(l);
            }
            if let Some(p) = path {
                if sources[pos].kind != SourceKind::LocalDir {
                    return Err("--path only applies to localDir sources".into());
                }
                let root = expand_tilde_path(&p);
                let root = root.canonicalize().map_err(|e| format!("--path: {e}"))?;
                sources[pos].path = Some(root.to_string_lossy().to_string());
            }
            cfg.sources = Some(sources);
            write_config_json(&home, &cfg)?;
            if json {
                println!("{}", serde_json::json!({ "ok": true, "id": id }));
            } else {
                println!("Updated source {id}");
            }
            Ok(())
        }
        SourcesCmd::Remove { id, json } => {
            let mut cfg = load_config_json(&home);
            let mut sources = cfg.sources.take().unwrap_or_default();
            let before = sources.len();
            sources.retain(|s| s.id != id);
            if sources.len() == before {
                return Err(format!("unknown source id {id:?}").into());
            }
            cfg.sources = Some(sources);
            write_config_json(&home, &cfg)?;
            if json {
                println!("{}", serde_json::json!({ "ok": true, "removed": id }));
            } else {
                println!("Removed source {id}");
            }
            Ok(())
        }
        SourcesCmd::Status { json } => {
            let cfg = load_config_json(&home);
            let loaded = load_cfg();
            let db_path = loaded.db_path().to_path_buf();
            let sources_cfg = cfg.sources.clone().unwrap_or_default();
            let conn_opt = if db_path.is_file() {
                Some(Connection::open(&db_path).map_err(|e| e.to_string())?)
            } else {
                None
            };
            let mut rows: Vec<serde_json::Value> = Vec::new();
            for s in &sources_cfg {
                let (doc_count, last) = if let Some(ref conn) = conn_opt {
                    let doc_count: i64 = conn
                        .query_row(
                            "SELECT COUNT(*) FROM document_index WHERE source_id = ?1",
                            [&s.id],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    let last: Option<String> = conn
                        .query_row(
                            "SELECT last_synced_at FROM sources WHERE id = ?1",
                            [&s.id],
                            |r| r.get(0),
                        )
                        .optional()
                        .map_err(|e| e.to_string())?;
                    (doc_count, last)
                } else {
                    (0i64, None)
                };
                rows.push(serde_json::json!({
                    "id": s.id,
                    "kind": kind_label(s.kind),
                    "documentIndexRows": doc_count,
                    "lastSyncedAt": last,
                }));
            }
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({ "sources": rows }))?
                );
            } else if rows.is_empty() {
                println!("(no sources in config.json)");
            } else {
                for r in &rows {
                    println!("{}", serde_json::to_string(r)?);
                }
            }
            Ok(())
        }
    }
}
