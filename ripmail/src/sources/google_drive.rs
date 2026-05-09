//! Google Drive v3 sync into `document_index` + `cloud_file_meta` ([OPP-045](../../../docs/opportunities/OPP-045-google-drive.md)).

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::Instant;

use globset::GlobSet;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::attachments::local_file_read_outcome;
use crate::config::{FileSourceConfigJson, FileSourceRoot, ResolvedMailbox, SourceKind};
use crate::oauth::ensure_google_access_token;
use crate::sources::file_filter;
use crate::sync::run::SyncResult;

const DRIVE_FILES: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_CHANGES: &str = "https://www.googleapis.com/drive/v3/changes";
const DRIVE_START: &str = "https://www.googleapis.com/drive/v3/changes/startPageToken";

const MIME_FOLDER: &str = "application/vnd.google-apps.folder";
const MIME_DOC: &str = "application/vnd.google-apps.document";
const MIME_SHEET: &str = "application/vnd.google-apps.spreadsheet";
const MIME_SLIDE: &str = "application/vnd.google-apps.presentation";

/// Relative cache path under `RIPMAIL_HOME/<source-id>/`.
pub fn drive_cache_rel_path(remote_id: &str) -> String {
    format!("cache/{remote_id}.md")
}

pub fn content_fingerprint(md5_opt: Option<&str>, export_bytes: &[u8]) -> String {
    if let Some(m) = md5_opt {
        let t = m.trim();
        if !t.is_empty() {
            return format!("md5:{t}");
        }
    }
    let mut h = Sha256::new();
    h.update(export_bytes);
    let d = h.finalize();
    let hex_s: String = d.iter().map(|b| format!("{b:02x}")).collect();
    format!("sha256:{hex_s}")
}

fn drive_get(token: &str, url: &str) -> Result<ureq::Response, Box<dyn std::error::Error>> {
    let resp = ureq::get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    Ok(resp)
}

fn drive_json(token: &str, url: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let resp = drive_get(token, url)?;
    let status = resp.status();
    let body = resp.into_string().unwrap_or_default();
    if status == 429 {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let resp2 = drive_get(token, url)?;
        let status2 = resp2.status();
        let body2 = resp2.into_string().unwrap_or_default();
        if !(200..300).contains(&status2) {
            return Err(format!("Drive API HTTP {status2}: {body2}").into());
        }
        return Ok(serde_json::from_str(&body2)?);
    }
    if !(200..300).contains(&status) {
        return Err(format!("Drive API HTTP {status}: {body}").into());
    }
    Ok(serde_json::from_str(&body)?)
}

fn drive_bytes(token: &str, url: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let resp = drive_get(token, url)?;
    let status = resp.status();
    if !(200..300).contains(&status) {
        let body = resp.into_string().unwrap_or_default();
        return Err(format!("Drive API HTTP {status}: {body}").into());
    }
    let mut reader = resp.into_reader();
    let mut out = Vec::new();
    std::io::copy(&mut reader, &mut out)?;
    Ok(out)
}

fn build_files_q_for_parents(parent_ids: &[String]) -> String {
    let mut parts = vec![
        "trashed = false".to_string(),
        format!("mimeType != '{MIME_FOLDER}'"),
    ];
    let parents: Vec<String> = parent_ids
        .iter()
        .map(|id| format!("'{id}' in parents"))
        .collect();
    parts.push(format!("({})", parents.join(" or ")));
    parts.join(" and ")
}

/// Expand configured roots to the set of folder ids whose direct children may contain files to index.
fn expand_index_folder_ids(
    token: &str,
    roots: &[FileSourceRoot],
    progress_stderr: bool,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    use std::collections::HashSet;
    use std::collections::VecDeque;

    let mut seen: HashSet<String> = HashSet::new();
    let mut ordered: Vec<String> = Vec::new();
    for root in roots {
        let rid = root.id.trim();
        if rid.is_empty() {
            continue;
        }
        if seen.insert(rid.to_string()) {
            ordered.push(rid.to_string());
        }
        if root.recursive {
            let mut q = VecDeque::new();
            q.push_back(rid.to_string());
            while let Some(fid) = q.pop_front() {
                match list_immediate_child_folders(token, &fid) {
                    Ok(children) => {
                        for (cid, _) in children {
                            if seen.insert(cid.clone()) {
                                ordered.push(cid.clone());
                                q.push_back(cid);
                            }
                        }
                    }
                    Err(e) if progress_stderr => {
                        eprintln!("ripmail: Drive list subfolders of {fid}: {e}");
                    }
                    Err(_) => {}
                }
            }
        }
    }
    Ok(ordered)
}

fn list_immediate_child_folders(
    token: &str,
    parent_id: &str,
) -> Result<Vec<(String, String)>, Box<dyn std::error::Error>> {
    let q = format!("'{parent_id}' in parents and mimeType = '{MIME_FOLDER}' and trashed = false");
    let fields = "nextPageToken,files(id,name)";
    let mut out = Vec::new();
    let mut page: Option<String> = None;
    loop {
        let mut url = format!(
            "{DRIVE_FILES}?q={}&fields={}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true",
            urlencoding::encode(&q),
            urlencoding::encode(fields)
        );
        if let Some(ref pt) = page {
            url.push_str(&format!("&pageToken={}", urlencoding::encode(pt)));
        }
        let v = drive_json(token, &url)?;
        if let Some(arr) = v.get("files").and_then(|x| x.as_array()) {
            for f in arr {
                let id = f
                    .get("id")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                if id.is_empty() {
                    continue;
                }
                let name = f
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("folder")
                    .to_string();
                out.push((id, name));
            }
        }
        if let Some(np) = v.get("nextPageToken").and_then(|x| x.as_str()) {
            page = Some(np.to_string());
        } else {
            break;
        }
    }
    Ok(out)
}

/// One folder row for hub / CLI folder picker (`ripmail sources browse-folders`).
#[derive(Debug, Clone, serde::Serialize)]
pub struct DriveBrowseFolderRow {
    pub id: String,
    pub name: String,
    /// True when this folder might contain subfolders (Drive: omitted extra query; treat as true).
    #[serde(rename = "hasChildren")]
    pub has_children: bool,
}

/// List immediate child folders under `parent_id` (`None` or empty → `"root"` / My Drive).
pub fn browse_google_drive_folders(
    token: &str,
    parent_id: Option<&str>,
) -> Result<Vec<DriveBrowseFolderRow>, Box<dyn std::error::Error>> {
    let pid = parent_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("root");
    let raw = list_immediate_child_folders(token, pid)?;
    Ok(raw
        .into_iter()
        .map(|(id, name)| DriveBrowseFolderRow {
            id,
            name,
            has_children: true,
        })
        .collect())
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct DriveFileListItem {
    id: String,
    name: Option<String>,
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    #[serde(rename = "modifiedTime")]
    modified_time: Option<String>,
    size: Option<String>,
    #[serde(rename = "md5Checksum")]
    md5_checksum: Option<String>,
    #[serde(default)]
    parents: Option<Vec<String>>,
}

const PARENT_QUERY_CHUNK: usize = 40;

fn list_files_for_query(
    token: &str,
    q: &str,
    progress_stderr: bool,
    running_total: &mut usize,
) -> Result<Vec<DriveFileListItem>, Box<dyn std::error::Error>> {
    let fields = "nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum,parents)";
    let mut out = Vec::new();
    let mut page: Option<String> = None;
    loop {
        let mut url = format!(
            "{DRIVE_FILES}?q={}&fields={}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true",
            urlencoding::encode(q),
            urlencoding::encode(fields)
        );
        if let Some(ref pt) = page {
            url.push_str(&format!("&pageToken={}", urlencoding::encode(pt)));
        }
        let v = drive_json(token, &url)?;
        let mut page_add = 0usize;
        if let Some(arr) = v.get("files").and_then(|x| x.as_array()) {
            for f in arr {
                if let Ok(item) = serde_json::from_value::<DriveFileListItem>(f.clone()) {
                    if item.mime_type.as_deref() == Some(MIME_FOLDER) {
                        continue;
                    }
                    out.push(item);
                    page_add += 1;
                }
            }
        }
        *running_total += page_add;
        if let Some(np) = v.get("nextPageToken").and_then(|x| x.as_str()) {
            page = Some(np.to_string());
        } else {
            break;
        }
        if progress_stderr && (*running_total).is_multiple_of(500) && *running_total > 0 {
            eprintln!("ripmail: Drive list… {} file(s) so far", *running_total);
        }
    }
    Ok(out)
}

fn list_all_files_under_folders(
    token: &str,
    folder_ids: &[String],
    progress_stderr: bool,
) -> Result<Vec<DriveFileListItem>, Box<dyn std::error::Error>> {
    use std::collections::HashMap;
    let mut by_id: HashMap<String, DriveFileListItem> = HashMap::new();
    let mut running = 0usize;
    for chunk in folder_ids.chunks(PARENT_QUERY_CHUNK) {
        let q = build_files_q_for_parents(chunk);
        let batch = list_files_for_query(token, &q, progress_stderr, &mut running)?;
        for it in batch {
            by_id.insert(it.id.clone(), it);
        }
    }
    Ok(by_id.into_values().collect())
}

fn get_start_page_token(token: &str) -> Result<String, Box<dyn std::error::Error>> {
    let url = format!("{DRIVE_START}?supportsAllDrives=true");
    let v = drive_json(token, &url)?;
    v.get("startPageToken")
        .and_then(|x| x.as_str())
        .map(String::from)
        .ok_or_else(|| "Drive changes: missing startPageToken".into())
}

fn read_change_token(conn: &Connection, source_id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT change_page_token FROM google_drive_sync_state WHERE source_id = ?1",
        [source_id],
        |r| r.get(0),
    )
    .optional()
    .map(|o| o.flatten())
}

fn write_change_token(
    tx: &rusqlite::Transaction<'_>,
    source_id: &str,
    token: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO google_drive_sync_state (source_id, change_page_token, last_synced_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
         ON CONFLICT(source_id) DO UPDATE SET
           change_page_token = excluded.change_page_token,
           last_synced_at = excluded.last_synced_at",
        params![source_id, token],
    )?;
    Ok(())
}

fn meta_row(
    conn: &Connection,
    source_id: &str,
    remote_id: &str,
) -> rusqlite::Result<Option<(String, String)>> {
    conn.query_row(
        "SELECT content_hash, remote_mtime FROM cloud_file_meta WHERE source_id = ?1 AND remote_id = ?2",
        params![source_id, remote_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )
    .optional()
}

fn remove_drive_file(
    tx: &rusqlite::Transaction<'_>,
    source_home: &Path,
    source_id: &str,
    remote_id: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM document_index WHERE source_id = ?1 AND kind = 'googleDrive' AND ext_id = ?2",
        params![source_id, remote_id],
    )?;
    tx.execute(
        "DELETE FROM cloud_file_meta WHERE source_id = ?1 AND remote_id = ?2",
        params![source_id, remote_id],
    )?;
    let cache = source_home.join(drive_cache_rel_path(remote_id));
    let _ = fs::remove_file(cache);
    Ok(())
}

fn fetch_file_body(
    token: &str,
    item: &DriveFileListItem,
    max_bytes: u64,
) -> Result<(Vec<u8>, String, String), Box<dyn std::error::Error>> {
    let mime = item
        .mime_type
        .as_deref()
        .unwrap_or("application/octet-stream");
    let _name = item.name.as_deref().unwrap_or("file");
    let modified = item.modified_time.as_deref().unwrap_or("").to_string();

    let size_u64 = item
        .size
        .as_deref()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    if size_u64 > max_bytes && !mime.starts_with("application/vnd.google-apps.") {
        return Err(format!(
            "file {} too large ({} > max {})",
            item.id, size_u64, max_bytes
        )
        .into());
    }

    let (bytes, fp) = if mime == MIME_DOC {
        let export = format!(
            "{DRIVE_FILES}/{}/export?mimeType={}&supportsAllDrives=true",
            urlencoding::encode(&item.id),
            urlencoding::encode("text/plain")
        );
        let b = drive_bytes(token, &export)?;
        let fp = content_fingerprint(None, &b);
        (b, fp)
    } else if mime == MIME_SHEET {
        let export = format!(
            "{DRIVE_FILES}/{}/export?mimeType={}&supportsAllDrives=true",
            urlencoding::encode(&item.id),
            urlencoding::encode("text/csv")
        );
        let b = drive_bytes(token, &export)?;
        let fp = content_fingerprint(None, &b);
        (b, fp)
    } else if mime == MIME_SLIDE {
        let export = format!(
            "{DRIVE_FILES}/{}/export?mimeType={}&supportsAllDrives=true",
            urlencoding::encode(&item.id),
            urlencoding::encode("text/plain")
        );
        let b = drive_bytes(token, &export)?;
        let fp = content_fingerprint(None, &b);
        (b, fp)
    } else {
        let u = format!(
            "{DRIVE_FILES}/{}?alt=media&supportsAllDrives=true",
            urlencoding::encode(&item.id)
        );
        let b = drive_bytes(token, &u)?;
        let fp = content_fingerprint(item.md5_checksum.as_deref(), &b);
        (b, fp)
    };

    Ok((bytes, fp, modified))
}

fn body_text_from_bytes(bytes: &[u8], mime: &str, fname: &str) -> String {
    local_file_read_outcome(bytes, mime, fname).body_text
}

#[allow(clippy::too_many_arguments)]
fn upsert_drive_indexed_file(
    tx: &rusqlite::Transaction<'_>,
    source_id: &str,
    source_home: &Path,
    remote_id: &str,
    title: &str,
    body: &str,
    date_iso: &str,
    content_hash: &str,
    remote_mtime: &str,
) -> rusqlite::Result<()> {
    fs::create_dir_all(source_home.join("cache")).ok();
    let rel = drive_cache_rel_path(remote_id);
    let abs = source_home.join(&rel);
    let mut f =
        fs::File::create(&abs).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    f.write_all(body.as_bytes())
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    tx.execute(
        "DELETE FROM document_index WHERE source_id = ?1 AND kind = 'googleDrive' AND ext_id = ?2",
        params![source_id, remote_id],
    )?;
    tx.execute(
        "INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso)
         VALUES (?1, 'googleDrive', ?2, ?3, ?4, ?5)",
        params![source_id, remote_id, title, body, date_iso],
    )?;
    tx.execute(
        "INSERT INTO cloud_file_meta (source_id, remote_id, content_hash, remote_mtime, cached_md_path)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(source_id, remote_id) DO UPDATE SET
           content_hash = excluded.content_hash,
           remote_mtime = excluded.remote_mtime,
           cached_md_path = excluded.cached_md_path",
        params![source_id, remote_id, content_hash, remote_mtime, rel],
    )?;
    Ok(())
}

fn fetch_file_parents(
    token: &str,
    file_id: &str,
) -> Result<Option<Vec<String>>, Box<dyn std::error::Error>> {
    let url = format!(
        "{DRIVE_FILES}/{}?fields=parents&supportsAllDrives=true",
        urlencoding::encode(file_id)
    );
    let v = drive_json(token, &url)?;
    Ok(v.get("parents")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p.as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        .filter(|p| !p.is_empty()))
}

fn file_in_allowed_folders(
    item: &DriveFileListItem,
    allowed: &std::collections::HashSet<String>,
) -> bool {
    item.parents
        .as_ref()
        .map(|p| p.iter().any(|x| allowed.contains(x)))
        .unwrap_or(false)
}

#[allow(clippy::too_many_arguments)]
fn index_one_file(
    conn: &mut Connection,
    token: &str,
    source_id: &str,
    source_home: &Path,
    item: &DriveFileListItem,
    max_file_bytes: u64,
    include: &Option<GlobSet>,
    ignore: &Option<GlobSet>,
    progress_stderr: bool,
) -> Result<(bool, u64), Box<dyn std::error::Error>> {
    if item.mime_type.as_deref() == Some(MIME_FOLDER) {
        return Ok((false, 0));
    }
    let fname = item.name.as_deref().unwrap_or("file");
    if !file_filter::path_allowed(fname, include, ignore) {
        return Ok((false, 0));
    }
    let modified = item.modified_time.clone().unwrap_or_default();
    let mime = item.mime_type.as_deref().unwrap_or("");

    if let Some((h_stored, m_stored)) = meta_row(conn, source_id, &item.id)? {
        if m_stored == modified {
            if mime == MIME_DOC || mime == MIME_SHEET || mime == MIME_SLIDE {
                return Ok((false, 0));
            }
            if let Some(md5) = item.md5_checksum.as_deref() {
                if !md5.is_empty() && h_stored == format!("md5:{md5}") {
                    return Ok((false, 0));
                }
            }
        }
    }

    let size_u64 = item
        .size
        .as_deref()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    if !mime.starts_with("application/vnd.google-apps.") && size_u64 > max_file_bytes {
        if progress_stderr {
            eprintln!(
                "ripmail: skip Drive file {} ({} bytes > maxFileBytes {})",
                item.id, size_u64, max_file_bytes
            );
        }
        return Ok((false, 0));
    }

    let (bytes, content_hash, mtime_used) = match fetch_file_body(token, item, max_file_bytes) {
        Ok(x) => x,
        Err(e) => {
            if progress_stderr {
                eprintln!("ripmail: Drive fetch {}: {}", item.id, e);
            }
            return Ok((false, 0));
        }
    };
    let body = body_text_from_bytes(&bytes, mime, fname);
    let title = fname.to_string();
    let fetched = bytes.len() as u64;

    let tx = conn.transaction()?;
    upsert_drive_indexed_file(
        &tx,
        source_id,
        source_home,
        &item.id,
        &title,
        &body,
        if mtime_used.is_empty() {
            &modified
        } else {
            &mtime_used
        },
        &content_hash,
        if mtime_used.is_empty() {
            &modified
        } else {
            &mtime_used
        },
    )?;
    tx.commit()?;
    Ok((true, fetched))
}

#[allow(clippy::too_many_arguments)]
fn apply_changes_list(
    conn: &mut Connection,
    token: &str,
    mb: &ResolvedMailbox,
    fs: &FileSourceConfigJson,
    allowed_parent_ids: &std::collections::HashSet<String>,
    include: &Option<GlobSet>,
    ignore: &Option<GlobSet>,
    start_token: &str,
    source_home: &Path,
    progress_stderr: bool,
) -> Result<(u32, u64, bool), Box<dyn std::error::Error>> {
    let mut indexed: u32 = 0;
    let mut bytes_dl: u64 = 0;
    let mut page_token = start_token.to_string();
    let mut new_start: Option<String> = None;
    let mut reset_full = false;

    loop {
        let url = format!(
            "{DRIVE_CHANGES}?pageToken={}&fields={}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&includeRemoved=true",
            urlencoding::encode(&page_token),
            urlencoding::encode(
                "newStartPageToken,nextPageToken,changes(file(id,name,mimeType,modifiedTime,size,md5Checksum,trashed,parents),fileId,removed)"
            )
        );
        let v = match drive_json(token, &url) {
            Ok(x) => x,
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("410") {
                    reset_full = true;
                    break;
                }
                return Err(e);
            }
        };

        if let Some(arr) = v.get("changes").and_then(|x| x.as_array()) {
            for ch in arr {
                let removed = ch.get("removed").and_then(|x| x.as_bool()).unwrap_or(false);
                let file_id = ch.get("fileId").and_then(|x| x.as_str()).map(String::from);
                if removed {
                    if let Some(ref fid) = file_id {
                        let tx = conn.transaction()?;
                        remove_drive_file(&tx, source_home, &mb.id, fid)?;
                        tx.commit()?;
                    }
                    continue;
                }
                if let Some(file) = ch.get("file") {
                    if let Ok(mut item) = serde_json::from_value::<DriveFileListItem>(file.clone())
                    {
                        if item.mime_type.as_deref() == Some(MIME_FOLDER) {
                            continue;
                        }
                        if ch
                            .get("file")
                            .and_then(|f| f.get("trashed"))
                            .and_then(|x| x.as_bool())
                            .unwrap_or(false)
                        {
                            let tx = conn.transaction()?;
                            remove_drive_file(&tx, source_home, &mb.id, &item.id)?;
                            tx.commit()?;
                            continue;
                        }
                        if item.parents.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
                            item.parents = fetch_file_parents(token, &item.id)?;
                        }
                        if !file_in_allowed_folders(&item, allowed_parent_ids) {
                            continue;
                        }
                        match index_one_file(
                            conn,
                            token,
                            &mb.id,
                            source_home,
                            &item,
                            fs.max_file_bytes,
                            include,
                            ignore,
                            progress_stderr,
                        ) {
                            Ok((did, b)) => {
                                bytes_dl += b;
                                if did {
                                    indexed += 1;
                                }
                            }
                            Err(e) => {
                                if progress_stderr {
                                    eprintln!("ripmail: Drive change index {}: {}", item.id, e);
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(nst) = v.get("newStartPageToken").and_then(|x| x.as_str()) {
            new_start = Some(nst.to_string());
        }
        if let Some(np) = v.get("nextPageToken").and_then(|x| x.as_str()) {
            page_token = np.to_string();
        } else {
            break;
        }
    }

    if reset_full {
        return Ok((indexed, bytes_dl, true));
    }

    if let Some(ref nst) = new_start {
        let tx = conn.transaction()?;
        write_change_token(&tx, &mb.id, nst)?;
        tx.commit()?;
    }

    Ok((indexed, bytes_dl, false))
}

/// Full list + optional incremental; updates `google_drive_sync_state` and `sources` row.
pub fn run_google_drive_sync(
    conn: &mut Connection,
    mb: &ResolvedMailbox,
    home: &Path,
    env_file: &HashMap<String, String>,
    process_env: &HashMap<String, String>,
    progress_stderr: bool,
) -> Result<SyncResult, Box<dyn std::error::Error>> {
    if mb.kind != SourceKind::GoogleDrive {
        return Err("run_google_drive_sync: not googleDrive".into());
    }
    let Some(ref gd) = mb.google_drive else {
        return Err("run_google_drive_sync: missing google_drive (OAuth identity)".into());
    };
    let Some(ref fsc) = mb.file_source else {
        return Err("run_google_drive_sync: missing fileSource".into());
    };
    if fsc.roots.is_empty() {
        return Err(
            "googleDrive sync: add at least one folder to fileSource.roots (entire-Drive sync is disabled)"
                .into(),
        );
    }

    let started = Instant::now();
    let access = ensure_google_access_token(home, &gd.token_mailbox_id, env_file, process_env)
        .map_err(|e| -> Box<dyn std::error::Error> { e.to_string().into() })?;

    let include = file_filter::build_globset(&fsc.include_globs)?;
    let ignore = file_filter::build_globset(&fsc.ignore_globs)?;
    let folder_ids = expand_index_folder_ids(&access, &fsc.roots, progress_stderr)?;
    let allowed_parents: std::collections::HashSet<String> = folder_ids.iter().cloned().collect();

    let source_home = home.join(&mb.id);
    fs::create_dir_all(source_home.join("cache"))?;

    let mut total_indexed: u32 = 0;
    let mut total_bytes: u64 = 0;

    let stored_token = read_change_token(conn, &mb.id)?;
    let mut need_full_resync = stored_token.is_none();
    if let Some(ref tok) = stored_token {
        let (n, b, reset) = apply_changes_list(
            conn,
            &access,
            mb,
            fsc,
            &allowed_parents,
            &include,
            &ignore,
            tok,
            &source_home,
            progress_stderr,
        )?;
        total_indexed += n;
        total_bytes += b;
        need_full_resync = reset;
    }

    if need_full_resync {
        if progress_stderr {
            eprintln!("ripmail: Drive full file list for source {}…", mb.id);
        }
        conn.execute(
            "DELETE FROM document_index WHERE source_id = ?1 AND kind = 'googleDrive'",
            [&mb.id],
        )?;
        conn.execute("DELETE FROM cloud_file_meta WHERE source_id = ?1", [&mb.id])?;
        let _ = fs::remove_dir_all(source_home.join("cache"));
        fs::create_dir_all(source_home.join("cache"))?;
        conn.execute(
            "DELETE FROM google_drive_sync_state WHERE source_id = ?1",
            [&mb.id],
        )?;
        let files = list_all_files_under_folders(&access, &folder_ids, progress_stderr)?;
        for item in &files {
            match index_one_file(
                conn,
                &access,
                &mb.id,
                &source_home,
                item,
                fsc.max_file_bytes,
                &include,
                &ignore,
                progress_stderr,
            ) {
                Ok((did, b)) => {
                    total_bytes += b;
                    if did {
                        total_indexed += 1;
                    }
                }
                Err(e) => {
                    if progress_stderr {
                        eprintln!("ripmail: Drive index {}: {}", item.id, e);
                    }
                }
            }
        }
        let start = get_start_page_token(&access)?;
        let tx = conn.transaction()?;
        write_change_token(&tx, &mb.id, &start)?;
        tx.commit()?;
    }

    let doc_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM document_index WHERE source_id = ?1 AND kind = 'googleDrive'",
        [&mb.id],
        |r| r.get(0),
    )?;

    let inc = if mb.include_in_default { 1 } else { 0 };
    conn.execute(
        "INSERT INTO sources (id, kind, label, include_in_default, last_synced_at, doc_count)
         VALUES (?1, 'googleDrive', NULL, ?2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?3)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           include_in_default = excluded.include_in_default,
           last_synced_at = excluded.last_synced_at,
           doc_count = excluded.doc_count",
        params![&mb.id, inc, doc_count],
    )?;

    if progress_stderr {
        eprintln!(
            "ripmail: googleDrive source {} — indexed {} file(s) this run ({} total in index).",
            mb.id, total_indexed, doc_count
        );
    }

    let duration_ms = started.elapsed().as_millis() as u64;
    Ok(SyncResult {
        synced: total_indexed,
        messages_fetched: total_indexed,
        bytes_downloaded: total_bytes,
        duration_ms,
        bandwidth_bytes_per_sec: 0.0,
        messages_per_minute: 0.0,
        log_path: String::new(),
        early_exit: None,
        gmail_api_partial: None,
        new_message_ids: None,
        mailboxes: None,
    })
}

/// Resolve `ripmail read <driveFileId>` when `document_index` has a matching `googleDrive` row.
/// Returns `(body, title, source_id)` when the cached export exists.
pub fn try_read_google_drive_cached_body(
    conn: &Connection,
    home: &Path,
    file_id: &str,
) -> rusqlite::Result<Option<(String, String, String)>> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT source_id, title FROM document_index WHERE kind = 'googleDrive' AND ext_id = ?1 LIMIT 1",
            [file_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((source_id, title)) = row else {
        return Ok(None);
    };
    let rel: Option<String> = conn
        .query_row(
            "SELECT cached_md_path FROM cloud_file_meta WHERE source_id = ?1 AND remote_id = ?2",
            params![source_id, file_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(rel_path) = rel else {
        return Ok(None);
    };
    let abs = home.join(&source_id).join(&rel_path);
    if abs.is_file() {
        let body = fs::read_to_string(abs).unwrap_or_default();
        return Ok(Some((body, title, source_id)));
    }
    Ok(None)
}
