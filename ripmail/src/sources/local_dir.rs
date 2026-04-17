//! Index files from a `localDir` source into `files` + `document_index` (FTS).

use std::fs;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::WalkBuilder;
use rusqlite::{params, Connection};

use crate::attachments::local_file_read_outcome;
use crate::config::{ResolvedMailbox, SourceKind};
use crate::sync::run::SyncResult;

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, globset::Error> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        b.add(Glob::new(p)?);
    }
    Ok(Some(b.build()?))
}

fn rel_path_key(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let s = rel.to_string_lossy().replace('\\', "/");
    if s.is_empty() {
        None
    } else {
        Some(s)
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

/// Full re-index: clears prior `file` rows for this source, walks the tree, extracts text, inserts rows.
pub fn run_local_dir_sync(
    conn: &mut Connection,
    mb: &ResolvedMailbox,
    progress_stderr: bool,
) -> Result<SyncResult, Box<dyn std::error::Error>> {
    if mb.kind != SourceKind::LocalDir {
        return Err("run_local_dir_sync: not a localDir source".into());
    }
    let Some(ld) = mb.local_dir.as_ref() else {
        return Err("run_local_dir_sync: missing local_dir".into());
    };
    let root = &ld.root;
    if !root.is_dir() {
        return Err(format!("localDir root is not a directory: {}", root.display()).into());
    }

    let started = Instant::now();
    let include = build_globset(&ld.include)?;
    let ignore = build_globset(&ld.ignore)?;

    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM document_index WHERE source_id = ?1 AND kind = 'file'",
        [&mb.id],
    )?;
    tx.execute("DELETE FROM files WHERE source_id = ?1", [&mb.id])?;

    let mut insert_file = tx.prepare_cached(
        "INSERT INTO files (source_id, rel_path, abs_path, mtime, size, mime, title, body_text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    let mut insert_doc = tx.prepare_cached(
        "INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso)
         VALUES (?1, 'file', ?2, ?3, ?4, ?5)",
    )?;

    let mut wb = WalkBuilder::new(root);
    wb.hidden(false);
    wb.git_ignore(ld.respect_gitignore);
    wb.git_exclude(ld.respect_gitignore);
    wb.ignore(ld.respect_gitignore);
    wb.max_depth(Some(ld.max_depth as usize));
    wb.follow_links(false);

    let mut scanned: u32 = 0;
    let mut indexed: u32 = 0;
    let mut bytes_total: u64 = 0;

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
        let Some(rel_key) = rel_path_key(root, path) else {
            continue;
        };

        if let Some(ref inc) = include {
            if !inc.is_match(&rel_key) {
                continue;
            }
        }
        if let Some(ref ign) = ignore {
            if ign.is_match(&rel_key) {
                continue;
            }
        }

        let meta = match fs::metadata(path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let len = meta.len();
        if len > ld.max_file_bytes {
            if progress_stderr {
                eprintln!(
                    "ripmail: skipping {} ({} bytes > maxFileBytes {})",
                    path.display(),
                    len,
                    ld.max_file_bytes
                );
            }
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

        let bytes = match fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        bytes_total += bytes.len() as u64;

        // Same pipeline as `ripmail read <path>` — no `utf8_lossy` binary dumps into FTS.
        let body = local_file_read_outcome(&bytes, &mime, fname).body_text;
        let title = fname.to_string();

        insert_file.execute(params![
            &mb.id, &rel_key, &abs_s, mtime_unix, len as i64, &mime, &title, &body,
        ])?;
        insert_doc.execute(params![&mb.id, &rel_key, &title, &body, &date_iso,])?;
        indexed += 1;
    }

    drop(insert_file);
    drop(insert_doc);

    let inc = if mb.include_in_default { 1 } else { 0 };
    tx.execute(
        "INSERT INTO sources (id, kind, label, include_in_default, last_synced_at, doc_count)
         VALUES (?1, 'localDir', NULL, ?2, datetime('now'), ?3)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           include_in_default = excluded.include_in_default,
           last_synced_at = excluded.last_synced_at,
           doc_count = excluded.doc_count",
        params![&mb.id, inc, indexed as i64],
    )?;

    tx.commit()?;

    if progress_stderr {
        eprintln!(
            "ripmail: localDir indexed {} file(s) under {} (scanned {}).",
            indexed,
            root.display(),
            scanned
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
    fn rel_path_key_normalizes() {
        let root = Path::new("/a/b");
        let p = Path::new("/a/b/c/d.txt");
        assert_eq!(rel_path_key(root, p).as_deref(), Some("c/d.txt"));
    }
}
