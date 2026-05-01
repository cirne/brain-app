//! `ripmail sources` — list/add/edit/remove/status for `config.json` `sources[]`.

use crate::cli::util::{load_cfg, ripmail_home_path};
use crate::cli::CliResult;
use ripmail::browse_google_drive_folders;
use ripmail::config::{
    derive_mailbox_id_from_email, load_config_json, write_config_json, FileSourceConfigJson,
    FileSourceRoot, ImapJson, SourceConfigJson, SourceKind,
};
use ripmail::oauth::ensure_google_access_token;
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;

fn kind_label(k: SourceKind) -> &'static str {
    match k {
        SourceKind::Imap => "imap",
        SourceKind::AppleMail => "applemail",
        SourceKind::LocalDir => "localDir",
        SourceKind::GoogleCalendar => "googleCalendar",
        SourceKind::AppleCalendar => "appleCalendar",
        SourceKind::IcsSubscription => "icsSubscription",
        SourceKind::IcsFile => "icsFile",
        SourceKind::GoogleDrive => "googleDrive",
    }
}

fn parse_kind(s: &str) -> Result<SourceKind, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "imap" => Ok(SourceKind::Imap),
        "applemail" => Ok(SourceKind::AppleMail),
        "localdir" => Ok(SourceKind::LocalDir),
        "googlecalendar" => Ok(SourceKind::GoogleCalendar),
        "applecalendar" => Ok(SourceKind::AppleCalendar),
        "icssubscription" => Ok(SourceKind::IcsSubscription),
        "icsfile" => Ok(SourceKind::IcsFile),
        "googledrive" => Ok(SourceKind::GoogleDrive),
        _ => Err(format!(
            "unknown --kind {s:?}; expected imap | applemail | localDir | googleCalendar | appleCalendar | icsSubscription | icsFile | googleDrive"
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

fn source_kind_has_calendar_preferences(k: SourceKind) -> bool {
    matches!(
        k,
        SourceKind::GoogleCalendar
            | SourceKind::AppleCalendar
            | SourceKind::IcsSubscription
            | SourceKind::IcsFile
    )
}

fn source_json_for_sources_list(s: &SourceConfigJson) -> serde_json::Value {
    let mut v = serde_json::to_value(s).unwrap_or_else(|_| {
        serde_json::json!({
            "id": s.id,
            "kind": kind_label(s.kind),
        })
    });
    if source_kind_has_calendar_preferences(s.kind) {
        if let Some(obj) = v.as_object_mut() {
            use serde_json::json;
            obj.entry("calendarIds".to_string())
                .or_insert_with(|| json!([]));
            obj.entry("defaultCalendars".to_string())
                .or_insert_with(|| json!([]));
        }
    }
    v
}

pub(crate) fn run_sources(cmd: crate::cli::args::SourcesCmd) -> CliResult {
    use crate::cli::args::SourcesCmd;
    let home = ripmail_home_path();
    match cmd {
        SourcesCmd::List { json } => {
            let cfg = load_config_json(&home);
            let arr = cfg.sources.clone().unwrap_or_default();
            if json {
                let rows: Vec<serde_json::Value> =
                    arr.iter().map(source_json_for_sources_list).collect();
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({ "sources": rows }))?
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
            root_id,
            root_name,
            no_root_recursive,
            include_glob,
            ignore_glob,
            max_file_bytes,
            respect_gitignore,
            label,
            id,
            email,
            imap_host,
            imap_port,
            apple_mail_path,
            oauth_source_id,
            calendar,
            default_calendar,
            url,
            include_shared_with_me,
            json,
        } => {
            let kind = parse_kind(&kind)?;
            let mut cfg = load_config_json(&home);
            let mut sources = cfg.sources.take().unwrap_or_default();
            let rec = !no_root_recursive;
            let entry = match kind {
                SourceKind::LocalDir => {
                    let raw_ids: Vec<String> = if !root_id.is_empty() {
                        root_id
                    } else if let Some(p) = path.clone() {
                        vec![p]
                    } else {
                        return Err(
                            "localDir requires --root-id (repeatable) or a single --path folder"
                                .into(),
                        );
                    };
                    let mut roots: Vec<FileSourceRoot> = Vec::new();
                    for (i, path_s) in raw_ids.iter().enumerate() {
                        let root = expand_tilde_path(path_s);
                        let root = root
                            .canonicalize()
                            .map_err(|e| format!("localDir --root-id {}: {e}", path_s))?;
                        if !root.is_dir() {
                            return Err(format!(
                                "localDir --root-id is not a directory: {}",
                                root.display()
                            )
                            .into());
                        }
                        let name = root_name
                            .get(i)
                            .cloned()
                            .filter(|s| !s.trim().is_empty())
                            .or_else(|| {
                                root.file_name()
                                    .and_then(|s| s.to_str())
                                    .map(|s| s.to_string())
                            })
                            .unwrap_or_else(|| format!("root{}", i));
                        roots.push(FileSourceRoot {
                            id: root.to_string_lossy().to_string(),
                            name,
                            recursive: rec,
                        });
                    }
                    let source_id = id.unwrap_or_else(|| {
                        label
                            .as_ref()
                            .map(|l| derive_mailbox_id_from_email(&format!("x@{l}.local")))
                            .unwrap_or_else(|| {
                                let first = PathBuf::from(&roots[0].id);
                                let stem =
                                    first.file_name().and_then(|s| s.to_str()).unwrap_or("dir");
                                derive_mailbox_id_from_email(&format!("x@{stem}.local"))
                            })
                    });
                    SourceConfigJson {
                        id: source_id,
                        kind: SourceKind::LocalDir,
                        email: String::new(),
                        label,
                        imap: None,
                        imap_auth: None,
                        search: None,
                        identity: None,
                        apple_mail_path: None,
                        path: None,
                        file_source: Some(FileSourceConfigJson {
                            roots,
                            include_globs: include_glob,
                            ignore_globs: ignore_glob,
                            max_file_bytes: max_file_bytes.unwrap_or(10_000_000),
                            respect_gitignore: respect_gitignore.unwrap_or(true),
                        }),
                        include_shared_with_me: false,
                        oauth_source_id: None,
                        calendar_ids: None,
                        default_calendars: None,
                        ics_url: None,
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
                        file_source: None,
                        include_shared_with_me: false,
                        oauth_source_id: None,
                        calendar_ids: None,
                        default_calendars: None,
                        ics_url: None,
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
                        file_source: None,
                        include_shared_with_me: false,
                        oauth_source_id: None,
                        calendar_ids: None,
                        default_calendars: None,
                        ics_url: None,
                    }
                }
                SourceKind::GoogleCalendar => {
                    let email = email.ok_or("--email is required for --kind googleCalendar")?;
                    let id = id.unwrap_or_else(|| derive_mailbox_id_from_email(&email));
                    let calendar_ids = if calendar.is_empty() {
                        Some(vec!["primary".to_string()])
                    } else {
                        Some(calendar)
                    };
                    let default_calendars = if default_calendar.is_empty() {
                        None
                    } else {
                        Some(default_calendar)
                    };
                    SourceConfigJson {
                        id,
                        kind: SourceKind::GoogleCalendar,
                        email: email.clone(),
                        label,
                        imap: None,
                        imap_auth: None,
                        search: None,
                        identity: None,
                        apple_mail_path: None,
                        path: None,
                        file_source: None,
                        include_shared_with_me: false,
                        oauth_source_id: oauth_source_id
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty()),
                        calendar_ids,
                        default_calendars,
                        ics_url: None,
                    }
                }
                SourceKind::AppleCalendar => {
                    #[cfg(not(target_os = "macos"))]
                    {
                        return Err(
                            "appleCalendar sources are only supported on macOS (reads Calendar.app SQLite)."
                                .into(),
                        );
                    }
                    #[cfg(target_os = "macos")]
                    {
                        let id = id.unwrap_or_else(|| "apple-calendar".into());
                        SourceConfigJson {
                            id,
                            kind: SourceKind::AppleCalendar,
                            email: email.unwrap_or_default(),
                            label,
                            imap: None,
                            imap_auth: None,
                            search: None,
                            identity: None,
                            apple_mail_path: None,
                            path: None,
                            file_source: None,
                            include_shared_with_me: false,
                            oauth_source_id: None,
                            calendar_ids: None,
                            default_calendars: None,
                            ics_url: None,
                        }
                    }
                }
                SourceKind::IcsSubscription => {
                    let url_s = url.ok_or("--url is required for --kind icsSubscription")?;
                    let id = id.unwrap_or_else(|| {
                        let mut h = Sha256::new();
                        h.update(url_s.as_bytes());
                        let d = h.finalize();
                        let hex: String = d.iter().take(4).map(|b| format!("{:02x}", b)).collect();
                        format!("ics-{hex}")
                    });
                    SourceConfigJson {
                        id,
                        kind: SourceKind::IcsSubscription,
                        email: String::new(),
                        label,
                        imap: None,
                        imap_auth: None,
                        search: None,
                        identity: None,
                        apple_mail_path: None,
                        path: None,
                        file_source: None,
                        include_shared_with_me: false,
                        oauth_source_id: None,
                        calendar_ids: None,
                        default_calendars: None,
                        ics_url: Some(url_s),
                    }
                }
                SourceKind::IcsFile => {
                    let path_s = path.ok_or("--path is required for --kind icsFile")?;
                    let root = expand_tilde_path(&path_s);
                    let root = root
                        .canonicalize()
                        .map_err(|e| format!("icsFile --path {}: {e}", path_s))?;
                    if !root.is_file() {
                        return Err(
                            format!("icsFile --path is not a file: {}", root.display()).into()
                        );
                    }
                    let id = id.unwrap_or_else(|| {
                        root.file_stem()
                            .and_then(|s| s.to_str())
                            .map(|s| derive_mailbox_id_from_email(&format!("ics-{s}@local")))
                            .unwrap_or_else(|| "ics-file".into())
                    });
                    SourceConfigJson {
                        id,
                        kind: SourceKind::IcsFile,
                        email: String::new(),
                        label,
                        imap: None,
                        imap_auth: None,
                        search: None,
                        identity: None,
                        apple_mail_path: None,
                        path: Some(root.to_string_lossy().to_string()),
                        file_source: None,
                        include_shared_with_me: false,
                        oauth_source_id: None,
                        calendar_ids: None,
                        default_calendars: None,
                        ics_url: None,
                    }
                }
                SourceKind::GoogleDrive => {
                    let email = email.ok_or("--email is required for --kind googleDrive")?;
                    if root_id.is_empty() {
                        return Err(
                            "googleDrive requires at least one --root-id (Drive folder id)".into(),
                        );
                    }
                    let token_src = oauth_source_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .unwrap_or_else(|| derive_mailbox_id_from_email(&email));
                    let source_id = id.unwrap_or_else(|| {
                        let slug = derive_mailbox_id_from_email(&email);
                        format!("{slug}-drive")
                    });
                    let mut roots: Vec<FileSourceRoot> = Vec::new();
                    for (i, rid) in root_id.iter().enumerate() {
                        let id_trim = rid.trim().to_string();
                        if id_trim.is_empty() {
                            continue;
                        }
                        let name = root_name
                            .get(i)
                            .cloned()
                            .filter(|s| !s.trim().is_empty())
                            .unwrap_or_else(|| {
                                if id_trim.len() > 12 {
                                    format!("…{}", &id_trim[id_trim.len().saturating_sub(8)..])
                                } else {
                                    id_trim.clone()
                                }
                            });
                        roots.push(FileSourceRoot {
                            id: id_trim,
                            name,
                            recursive: rec,
                        });
                    }
                    if roots.is_empty() {
                        return Err("googleDrive: no valid --root-id values".into());
                    }
                    SourceConfigJson {
                        id: source_id,
                        kind: SourceKind::GoogleDrive,
                        email: email.clone(),
                        label,
                        imap: None,
                        imap_auth: None,
                        search: None,
                        identity: None,
                        apple_mail_path: None,
                        path: None,
                        file_source: Some(FileSourceConfigJson {
                            roots,
                            include_globs: include_glob,
                            ignore_globs: ignore_glob,
                            max_file_bytes: max_file_bytes.unwrap_or(10_000_000),
                            respect_gitignore: true,
                        }),
                        include_shared_with_me,
                        oauth_source_id: Some(token_src),
                        calendar_ids: None,
                        default_calendars: None,
                        ics_url: None,
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
            calendar,
            default_calendar,
            file_source_json,
            include_shared_with_me,
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
                if sources[pos].kind != SourceKind::LocalDir
                    && sources[pos].kind != SourceKind::IcsFile
                {
                    return Err("--path only applies to localDir and icsFile sources".into());
                }
                let root = expand_tilde_path(&p);
                let root = root.canonicalize().map_err(|e| format!("--path: {e}"))?;
                if sources[pos].kind == SourceKind::IcsFile && !root.is_file() {
                    return Err("--path must be an existing file for icsFile".into());
                }
                if sources[pos].kind == SourceKind::LocalDir && !root.is_dir() {
                    return Err("--path must be an existing directory for localDir".into());
                }
                sources[pos].path = Some(root.to_string_lossy().to_string());
            }
            if let Some(raw) = file_source_json {
                if sources[pos].kind != SourceKind::LocalDir
                    && sources[pos].kind != SourceKind::GoogleDrive
                {
                    return Err(
                        "--file-source-json only applies to localDir and googleDrive".into(),
                    );
                }
                let fsc: FileSourceConfigJson =
                    serde_json::from_str(&raw).map_err(|e| format!("--file-source-json: {e}"))?;
                sources[pos].file_source = Some(fsc);
            }
            if !calendar.is_empty() {
                if !matches!(
                    sources[pos].kind,
                    SourceKind::GoogleCalendar | SourceKind::AppleCalendar
                ) {
                    return Err(
                        "--calendar only applies to googleCalendar and appleCalendar sources"
                            .into(),
                    );
                }
                sources[pos].calendar_ids = Some(calendar);
            }
            if !default_calendar.is_empty() {
                if !matches!(
                    sources[pos].kind,
                    SourceKind::GoogleCalendar | SourceKind::AppleCalendar
                ) {
                    return Err(
                        "--default-calendar only applies to googleCalendar and appleCalendar sources"
                            .into(),
                    );
                }
                sources[pos].default_calendars = Some(default_calendar);
            }
            if let Some(shared) = include_shared_with_me {
                if sources[pos].kind != SourceKind::GoogleDrive {
                    return Err(
                        "--include-shared-with-me only applies to googleDrive sources".into(),
                    );
                }
                sources[pos].include_shared_with_me = shared;
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
        SourcesCmd::BrowseFolders {
            id,
            parent_id,
            json,
        } => {
            let cfg = load_config_json(&home);
            let sources = cfg.sources.as_ref().ok_or("no sources in config")?;
            let row = sources
                .iter()
                .find(|s| s.id == id)
                .ok_or_else(|| format!("unknown source id {id:?}"))?;
            let folders: Vec<serde_json::Value> = match row.kind {
                SourceKind::LocalDir => {
                    let base = parent_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty());
                    let scan = if let Some(p) = base {
                        expand_tilde_path(p)
                            .canonicalize()
                            .map_err(|e| format!("parent-id: {e}"))?
                    } else if let Some(h) = dirs::home_dir() {
                        h
                    } else {
                        return Err("browse-folders: cannot resolve home directory".into());
                    };
                    if !scan.is_dir() {
                        return Err(format!("not a directory: {}", scan.display()).into());
                    }
                    let mut out = Vec::new();
                    for ent in std::fs::read_dir(&scan).map_err(|e| e.to_string())? {
                        let ent = ent.map_err(|e| e.to_string())?;
                        let ty = ent.file_type().map_err(|e| e.to_string())?;
                        if ty.is_dir() {
                            let p = ent.path();
                            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("dir");
                            let id_str = p.to_string_lossy().to_string();
                            let mut has_children = false;
                            if let Ok(rd) = std::fs::read_dir(&p) {
                                has_children = rd
                                    .flatten()
                                    .any(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false));
                            }
                            out.push(serde_json::json!({
                                "id": id_str,
                                "name": name,
                                "hasChildren": has_children,
                            }));
                        }
                    }
                    out.sort_by(|a, b| {
                        let na = a["name"].as_str().unwrap_or("");
                        let nb = b["name"].as_str().unwrap_or("");
                        na.cmp(nb)
                    });
                    out
                }
                SourceKind::GoogleDrive => {
                    let token_src = row
                        .oauth_source_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .unwrap_or_else(|| row.id.clone());
                    let env_file = ripmail::config::read_ripmail_env_file(&home);
                    let process_env: HashMap<String, String> = std::env::vars().collect();
                    let token =
                        ensure_google_access_token(&home, &token_src, &env_file, &process_env)
                            .map_err(|e| e.to_string())?;
                    let rows = browse_google_drive_folders(&token, parent_id.as_deref())?;
                    rows.into_iter()
                        .map(|r| {
                            serde_json::json!({
                                "id": r.id,
                                "name": r.name,
                                "hasChildren": r.has_children,
                            })
                        })
                        .collect()
                }
                _ => {
                    return Err(
                        "browse-folders supports only localDir and googleDrive sources".into(),
                    );
                }
            };
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({ "folders": folders }))?
                );
            } else {
                for f in folders {
                    println!("{}", serde_json::to_string(&f)?);
                }
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
                let (doc_count, cal_count, last) = if let Some(ref conn) = conn_opt {
                    let doc_count: i64 = conn
                        .query_row(
                            "SELECT COUNT(*) FROM document_index WHERE source_id = ?1",
                            [&s.id],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    let cal_count: i64 = conn
                        .query_row(
                            "SELECT COUNT(*) FROM calendar_events WHERE source_id = ?1",
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
                    (doc_count, cal_count, last)
                } else {
                    (0i64, 0i64, None)
                };
                rows.push(serde_json::json!({
                    "id": s.id,
                    "kind": kind_label(s.kind),
                    "documentIndexRows": doc_count,
                    "calendarEventRows": cal_count,
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
