//! Index files from a `localDir` source into `files` + `document_index` (FTS).

use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use ignore::WalkBuilder;
use rusqlite::{params, Connection, OptionalExtension};

use crate::attachments::local_file_read_outcome;
use crate::config::{FileSourceRoot, ResolvedMailbox, SourceKind};
use crate::sources::file_filter;
use crate::sync::run::SyncResult;

fn rel_path_under_root(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let s = rel.to_string_lossy().replace('\\', "/");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn root_slug(root: &FileSourceRoot, index: usize) -> String {
    let n = root.name.trim();
    if n.is_empty() {
        format!("root{}", index)
    } else {
        n.chars()
            .map(|c| if c == '/' || c == '\\' { '_' } else { c })
            .collect()
    }
}

fn db_rel_key(
    root: &FileSourceRoot,
    root_index: usize,
    rel_under: &str,
    multi_root: bool,
) -> String {
    if !multi_root {
        rel_under.to_string()
    } else {
        format!("{}/{}", root_slug(root, root_index), rel_under)
    }
}

fn iso_from_mtime(st: SystemTime) -> String {
    let Ok(dur) = st.duration_since(UNIX_EPOCH) else {
        return String::new();
    };
    chrono::DateTime::from_timestamp(dur.as_secs() as i64, dur.subsec_nanos())
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

/// Incremental index: walk each configured root; skip files whose `mtime` + `size` match `files`; remove stale paths.
pub fn run_local_dir_sync(
    conn: &mut Connection,
    mb: &ResolvedMailbox,
    progress_stderr: bool,
) -> Result<SyncResult, Box<dyn std::error::Error>> {
    if mb.kind != SourceKind::LocalDir {
        return Err("run_local_dir_sync: not a localDir".into());
    }
    let Some(fs) = mb.file_source.as_ref() else {
        return Err("run_local_dir_sync: missing fileSource".into());
    };
    if fs.roots.is_empty() {
        return Err("run_localDir sync: no folder roots configured (add fileSource.roots)".into());
    }

    let started = Instant::now();
    let include = file_filter::build_globset(&fs.include_globs)?;
    let ignore = file_filter::build_globset(&fs.ignore_globs)?;
    let multi_root = fs.roots.len() > 1;

    let tx = conn.transaction()?;

    let mut insert_file = tx.prepare_cached(
        "INSERT INTO files (source_id, rel_path, abs_path, mtime, size, mime, title, body_text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    let mut insert_doc = tx.prepare_cached(
        "INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso)
         VALUES (?1, 'file', ?2, ?3, ?4, ?5)",
    )?;

    let mut visited: HashSet<String> = HashSet::new();
    let mut scanned: u32 = 0;
    let mut indexed: u32 = 0;
    let mut skipped_unchanged: u32 = 0;
    let mut bytes_total: u64 = 0;

    for (root_idx, root) in fs.roots.iter().enumerate() {
        let root_path = Path::new(root.id.trim());
        if !root_path.is_dir() {
            return Err(
                format!("localDir root is not a directory: {}", root_path.display()).into(),
            );
        }

        let mut wb = WalkBuilder::new(root_path);
        wb.hidden(false);
        wb.git_ignore(fs.respect_gitignore);
        wb.git_exclude(fs.respect_gitignore);
        wb.ignore(fs.respect_gitignore);
        wb.max_depth(if root.recursive { None } else { Some(1usize) });
        wb.follow_links(false);

        for ent in wb.build() {
            let ent = match ent {
                Ok(e) => e,
                Err(e) => {
                    if progress_stderr {
                        eprintln!("ripmail: localDir walk: {e}");
                    }
                    continue;
                }
            };
            if !ent.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let path = ent.path();
            let Some(rel_under) = rel_path_under_root(root_path, path) else {
                continue;
            };
            let rel_key = db_rel_key(root, root_idx, &rel_under, multi_root);

            if !file_filter::path_allowed(&rel_key, &include, &ignore) {
                continue;
            }

            visited.insert(rel_key.clone());

            let meta = match fs::metadata(path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let len = meta.len();
            if len > fs.max_file_bytes {
                if progress_stderr {
                    eprintln!(
                        "ripmail: skipping {} ({} bytes > maxFileBytes {})",
                        path.display(),
                        len,
                        fs.max_file_bytes
                    );
                }
                tx.execute(
                    "DELETE FROM document_index WHERE source_id = ?1 AND kind = 'file' AND ext_id = ?2",
                    params![&mb.id, &rel_key],
                )?;
                tx.execute(
                    "DELETE FROM files WHERE source_id = ?1 AND rel_path = ?2",
                    params![&mb.id, &rel_key],
                )?;
                continue;
            }

            scanned += 1;
            let mtime = meta.modified().unwrap_or_else(|_| SystemTime::now());
            let mtime_unix = mtime
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let date_iso = iso_from_mtime(mtime);

            let abs_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
            let abs_s = abs_path.to_string_lossy().to_string();
            let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("file");
            let mime = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();

            let unchanged: bool = tx
                .query_row(
                    "SELECT mtime, size FROM files WHERE source_id = ?1 AND rel_path = ?2",
                    params![&mb.id, &rel_key],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
                )
                .optional()?
                .map(|(om, osz)| om == mtime_unix && osz == len as i64)
                .unwrap_or(false);

            if unchanged {
                skipped_unchanged += 1;
                continue;
            }

            let bytes = match fs::read(path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            bytes_total += bytes.len() as u64;

            let body = local_file_read_outcome(&bytes, &mime, fname).body_text;
            let title = fname.to_string();

            tx.execute(
                "DELETE FROM document_index WHERE source_id = ?1 AND kind = 'file' AND ext_id = ?2",
                params![&mb.id, &rel_key],
            )?;
            tx.execute(
                "DELETE FROM files WHERE source_id = ?1 AND rel_path = ?2",
                params![&mb.id, &rel_key],
            )?;

            insert_file.execute(params![
                &mb.id, &rel_key, &abs_s, mtime_unix, len as i64, &mime, &title, &body,
            ])?;
            insert_doc.execute(params![&mb.id, &rel_key, &title, &body, &date_iso,])?;
            indexed += 1;
        }
    }

    let mut stale_del = tx.prepare_cached("SELECT rel_path FROM files WHERE source_id = ?1")?;
    let existing: Vec<String> = stale_del
        .query_map([&mb.id], |r| r.get(0))?
        .filter_map(|x| x.ok())
        .collect();
    drop(stale_del);

    for rel_path in existing {
        if visited.contains(&rel_path) {
            continue;
        }
        tx.execute(
            "DELETE FROM document_index WHERE source_id = ?1 AND kind = 'file' AND ext_id = ?2",
            params![&mb.id, &rel_path],
        )?;
        tx.execute(
            "DELETE FROM files WHERE source_id = ?1 AND rel_path = ?2",
            params![&mb.id, &rel_path],
        )?;
    }

    drop(insert_file);
    drop(insert_doc);

    let inc = if mb.include_in_default { 1 } else { 0 };
    let doc_count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM files WHERE source_id = ?1",
        [&mb.id],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO sources (id, kind, label, include_in_default, last_synced_at, doc_count)
         VALUES (?1, 'localDir', NULL, ?2, datetime('now'), ?3)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           include_in_default = excluded.include_in_default,
           last_synced_at = excluded.last_synced_at,
           doc_count = excluded.doc_count",
        params![&mb.id, inc, doc_count],
    )?;

    tx.commit()?;

    if progress_stderr {
        eprintln!(
            "ripmail: localDir indexed {} new/changed file(s), skipped {} unchanged, scanned {} ({} root(s)).",
            indexed,
            skipped_unchanged,
            scanned,
            fs.roots.len(),
        );
    }

    let duration_ms = started.elapsed().as_millis() as u64;
    Ok(SyncResult {
        synced: indexed,
        messages_fetched: scanned,
        bytes_downloaded: bytes_total,
        duration_ms,
        bandwidth_bytes_per_sec: 0.0,
        messages_per_minute: 0.0,
        log_path: String::new(),
        early_exit: None,
        new_message_ids: None,
        mailboxes: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rel_path_under_root_normalizes() {
        let root = Path::new("/a/b");
        let p = Path::new("/a/b/c/d.txt");
        assert_eq!(rel_path_under_root(root, p).as_deref(), Some("c/d.txt"));
    }
}
