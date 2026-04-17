//! Resolve `.emlx` paths under `~/Library/Mail/V*` using Mail’s on-disk layout and optional `mailboxes.url`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::envelope_index::EnvelopeMessageRow;

/// How `resolve_emlx_path_with_diag` found (or failed to find) a file.
#[derive(Debug, Clone)]
pub enum PathResolveMethod {
    /// `mailboxes.url` + `…/Data/…/Messages/<rowid>.emlx` (direct probe, no full scan).
    MailboxUrl,
    /// One-time scan of that mailbox’s on-disk tree → `HashMap` lookup (see [`ApplemailEmlxCache`]).
    MailboxIndex {
        /// Number of `.emlx` files indexed for this mailbox (cost of the one-time scan).
        files_indexed: usize,
    },
    /// One-time scan of the entire mail library root (messages with no resolvable mailbox path).
    GlobalIndex { files_indexed: usize },
    /// No file found after URL probe and relevant index(es).
    NotFound,
}

#[derive(Debug, Clone)]
pub struct PathResolveDiag {
    pub method: PathResolveMethod,
    /// `messages.mailbox` → `mailboxes.ROWID` when present.
    pub mailbox_rowid: Option<i64>,
}

/// Lazily built maps from on-disk `.emlx` stem id (`remote_id`, or `ROWID` fallback) → path.
#[derive(Debug, Default)]
pub struct ApplemailEmlxCache {
    /// `mailboxes.ROWID` → (emlx stem id → path under that mailbox’s URL tree).
    per_mailbox: HashMap<i64, HashMap<i64, PathBuf>>,
    global: Option<HashMap<i64, PathBuf>>,
}

impl ApplemailEmlxCache {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Convert `file:///path` / `file://localhost/path` to a filesystem path (macOS).
pub fn file_url_to_path(url: &str) -> Option<PathBuf> {
    let u = url.trim();
    let rest = u.strip_prefix("file://")?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    if rest.starts_with('/') {
        Some(PathBuf::from(rest))
    } else {
        None
    }
}

/// Convert `imap://{UUID}/{folder}` to filesystem path under the mail library root.
///
/// Apple Mail V10 stores IMAP accounts under `~/Library/Mail/V10/{UUID}/{folder}.mbox`.
/// The `mailboxes.url` column contains `imap://{UUID}/{folder}` (percent-encoded).
pub fn imap_url_to_mbox_path(url: &str, mail_library_root: &Path) -> Option<PathBuf> {
    let u = url.trim();
    let rest = u.strip_prefix("imap://")?;
    let (uuid, folder) = rest.split_once('/')?;
    if uuid.is_empty() || folder.is_empty() {
        return None;
    }
    let folder_decoded = urlencoding::decode(folder).ok()?.into_owned();
    let mbox_name = format!("{folder_decoded}.mbox");
    Some(mail_library_root.join(uuid).join(mbox_name))
}

/// Apple Mail V10+ shards `Data` under digit dirs derived from `(ROWID / 1000)` reversed
/// (e.g. ROWID 253118 → …/Data/3/5/2/Messages/253118.emlx).
///
/// `data_dir` is the `…/Data` directory (inside the store UUID under the `.mbox` bundle).
#[must_use]
pub fn emlx_shard_path(data_dir: &Path, rowid: i64) -> PathBuf {
    let mut path = data_dir.to_path_buf();
    let prefix = rowid / 1000;
    if prefix > 0 {
        for ch in prefix.to_string().chars().rev() {
            path.push(ch.to_string());
        }
    }
    path.join("Messages").join(format!("{rowid}.emlx"))
}

/// Discover the per-mailbox store directory (UUID) under a `.mbox` bundle: `{mbox}/<uuid>/Data/…`.
#[must_use]
pub fn discover_store_root(mbox_path: &Path) -> Option<PathBuf> {
    let rd = std::fs::read_dir(mbox_path).ok()?;
    for ent in rd.flatten() {
        let p = ent.path();
        if !p.is_dir() {
            continue;
        }
        let name = p.file_name().and_then(|n| n.to_str())?;
        if name.eq_ignore_ascii_case("data") {
            continue;
        }
        if !uuid_like_dir_name(name) {
            continue;
        }
        let data = p.join("Data");
        if data.is_dir() {
            return Some(p);
        }
    }
    None
}

fn uuid_like_dir_name(name: &str) -> bool {
    // 8-4-4-4-12 hex (Apple uses uppercase UUIDs)
    let parts: Vec<&str> = name.split('-').collect();
    if parts.len() != 5 {
        return false;
    }
    let lens = [8, 4, 4, 4, 12];
    parts
        .iter()
        .zip(lens.iter())
        .all(|(p, &len)| p.len() == len && p.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Prefer deterministic `…/Data/…/Messages/{stem}.emlx` (or `.partial.emlx`); fall back to BFS scan.
///
/// Tries **`rowid`** (Envelope `messages` SQLite `ROWID`) first, then **`remote_id`** when it
/// differs — on-disk filenames often use IMAP UID / `remote_id`, not `ROWID`.
pub fn resolve_emlx_deterministic_then_scan(
    mail_library_root: &Path,
    envelope: &Connection,
    mailbox_rowid: i64,
    rowid: i64,
    remote_id: Option<i64>,
    cache: &mut ApplemailEmlxCache,
) -> (Option<PathBuf>, PathResolveDiag) {
    let mut stems: Vec<i64> = vec![rowid];
    if let Some(r) = remote_id {
        if r != rowid {
            stems.push(r);
        }
    }
    let mut last = PathResolveDiag {
        mailbox_rowid: Some(mailbox_rowid),
        method: PathResolveMethod::NotFound,
    };
    for stem in stems {
        let (opt, diag) = resolve_emlx_deterministic_then_scan_one_stem(
            mail_library_root,
            envelope,
            mailbox_rowid,
            stem,
            cache,
        );
        last = diag;
        if opt.is_some() {
            return (opt, last);
        }
    }
    (None, last)
}

fn resolve_emlx_deterministic_then_scan_one_stem(
    mail_library_root: &Path,
    envelope: &Connection,
    mailbox_rowid: i64,
    stem: i64,
    cache: &mut ApplemailEmlxCache,
) -> (Option<PathBuf>, PathResolveDiag) {
    let Some(mbox) = resolve_mailbox_mbox_path(envelope, mailbox_rowid, mail_library_root) else {
        return (
            None,
            PathResolveDiag {
                mailbox_rowid: Some(mailbox_rowid),
                method: PathResolveMethod::NotFound,
            },
        );
    };

    if let Some(store) = discover_store_root(&mbox) {
        let data_dir = store.join("Data");
        let full = emlx_shard_path(&data_dir, stem);
        if full.is_file() {
            return (
                Some(full),
                PathResolveDiag {
                    mailbox_rowid: Some(mailbox_rowid),
                    method: PathResolveMethod::MailboxUrl,
                },
            );
        }
        let partial = full
            .parent()
            .map(|p| p.join(format!("{stem}.partial.emlx")))
            .unwrap_or_else(|| {
                data_dir
                    .join("Messages")
                    .join(format!("{stem}.partial.emlx"))
            });
        if partial.is_file() {
            return (
                Some(partial),
                PathResolveDiag {
                    mailbox_rowid: Some(mailbox_rowid),
                    method: PathResolveMethod::MailboxUrl,
                },
            );
        }
    }

    resolve_emlx_path_with_diag(
        mail_library_root,
        envelope,
        stem,
        Some(mailbox_rowid),
        cache,
    )
}

/// Search `mailbox_root/Data/{shard}/Messages/{stem}.emlx` for common shard layouts.
///
/// Apple Mail V10 uses ROWID as the file stem. Also checks for `.partial.emlx` (headers-only
/// downloads) when the full `.emlx` is not present.
pub fn find_emlx_under_mbox(mailbox_mbox_path: &Path, emlx_stem_id: i64) -> Option<PathBuf> {
    let data = mailbox_mbox_path.join("Data");
    if !data.is_dir() {
        return None;
    }
    let name_full = format!("{emlx_stem_id}.emlx");
    let name_partial = format!("{emlx_stem_id}.partial.emlx");

    // Direct path under Data/Messages.
    let direct_full = data.join("Messages").join(&name_full);
    if direct_full.is_file() {
        return Some(direct_full);
    }
    let direct_partial = data.join("Messages").join(&name_partial);
    if direct_partial.is_file() {
        return Some(direct_partial);
    }

    // Sharded layout: Data/{shard}/Messages or Data/{s1}/{s2}/{s3}/Messages.
    find_emlx_in_shards(&data, &name_full, &name_partial)
}

fn find_emlx_in_shards(data: &Path, name_full: &str, name_partial: &str) -> Option<PathBuf> {
    let mut stack: Vec<PathBuf> = vec![data.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for ent in entries.flatten() {
            let p = ent.path();
            if !p.is_dir() {
                continue;
            }
            let name = p.file_name().and_then(|n| n.to_str());
            if name == Some("Messages") {
                let full = p.join(name_full);
                if full.is_file() {
                    return Some(full);
                }
                let partial = p.join(name_partial);
                if partial.is_file() {
                    return Some(partial);
                }
            } else {
                stack.push(p);
            }
        }
    }
    None
}

/// Resolve `mailboxes.url` to a filesystem root that contains `Messages` subtrees (`.mbox` bundle or plain directory).
///
/// Supports both `file://` URLs (local mailboxes) and `imap://` URLs (IMAP-backed accounts).
pub fn resolve_mailbox_mbox_path(
    envelope: &Connection,
    mailbox_rowid: i64,
    mail_library_root: &Path,
) -> Option<PathBuf> {
    let url: Option<String> = envelope
        .query_row(
            "SELECT url FROM mailboxes WHERE ROWID = ?1",
            [mailbox_rowid],
            |r| r.get(0),
        )
        .ok()?;
    let url = url?;

    // Try imap:// URL first (common for IMAP-backed accounts in Mail V10).
    if let Some(p) = imap_url_to_mbox_path(&url, mail_library_root) {
        if p.is_dir() {
            return Some(p);
        }
    }

    // Try file:// URL.
    if let Some(p) = file_url_to_path(&url) {
        if p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("mbox"))
            == Some(true)
        {
            return Some(p);
        }
        if let Ok(entries) = std::fs::read_dir(&p) {
            for ent in entries.flatten() {
                let c = ent.path();
                if c.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("mbox"))
                    == Some(true)
                {
                    return Some(c);
                }
            }
        }
        // iCloud / some layouts: URL is an account or container directory without a `.mbox` child.
        if p.is_dir() {
            return Some(p);
        }
    }
    None
}

/// Walk `root` once; every `Messages` directory contributes `stem → path` for `*.emlx` and `*.partial.emlx`.
///
/// Stem must parse as `i64`. For `.partial.emlx`, the stem is extracted without the `.partial` suffix.
/// Prefers full `.emlx` over `.partial.emlx` when both exist.
pub fn index_messages_tree(root: &Path) -> HashMap<i64, PathBuf> {
    let mut out = HashMap::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for ent in entries.flatten() {
            let p = ent.path();
            if !p.is_dir() {
                continue;
            }
            let name = p.file_name().and_then(|n| n.to_str());
            if name == Some("Messages") {
                if let Ok(mes) = std::fs::read_dir(&p) {
                    for f in mes.flatten() {
                        let fp = f.path();
                        if let Some(file_name) = fp.file_name().and_then(|n| n.to_str()) {
                            if let Some(id) = parse_emlx_stem(file_name) {
                                let is_partial = file_name.ends_with(".partial.emlx");
                                if is_partial {
                                    // Only insert partial if we don't have a full version.
                                    out.entry(id).or_insert(fp);
                                } else {
                                    // Full .emlx always wins.
                                    out.insert(id, fp);
                                }
                            }
                        }
                    }
                }
            } else {
                stack.push(p);
            }
        }
    }
    out
}

/// Parse the numeric stem from an emlx filename (e.g. "12345.emlx" or "12345.partial.emlx" → 12345).
fn parse_emlx_stem(filename: &str) -> Option<i64> {
    let stem = filename
        .strip_suffix(".partial.emlx")
        .or_else(|| filename.strip_suffix(".emlx"))?;
    stem.parse().ok()
}

impl ApplemailEmlxCache {
    fn ensure_mailbox_index(
        &mut self,
        mailbox_rowid: i64,
        mbox_root: &Path,
    ) -> &HashMap<i64, PathBuf> {
        self.per_mailbox
            .entry(mailbox_rowid)
            .or_insert_with(|| index_messages_tree(mbox_root))
    }

    fn ensure_global_index(&mut self, mail_root: &Path) -> &HashMap<i64, PathBuf> {
        self.global
            .get_or_insert_with(|| index_messages_tree(mail_root))
    }
}

/// Resolve `.emlx` using `mailboxes.url` (fast probe), then a one-time per-mailbox `Messages/*.emlx` index, then optional global index.
pub fn resolve_emlx_path(
    mail_library_root: &Path,
    envelope: &Connection,
    emlx_file_stem_id: i64,
    mailbox_rowid: Option<i64>,
) -> Option<PathBuf> {
    let mut cache = ApplemailEmlxCache::new();
    resolve_emlx_path_with_diag(
        mail_library_root,
        envelope,
        emlx_file_stem_id,
        mailbox_rowid,
        &mut cache,
    )
    .0
}

/// Same as [`resolve_emlx_path`] but returns how resolution behaved (for perf/logging).
pub fn resolve_emlx_path_with_diag(
    mail_library_root: &Path,
    envelope: &Connection,
    emlx_file_stem_id: i64,
    mailbox_rowid: Option<i64>,
    cache: &mut ApplemailEmlxCache,
) -> (Option<PathBuf>, PathResolveDiag) {
    if let Some(mb) = mailbox_rowid {
        if let Some(mbox) = resolve_mailbox_mbox_path(envelope, mb, mail_library_root) {
            if let Some(p) = find_emlx_under_mbox(&mbox, emlx_file_stem_id) {
                return (
                    Some(p),
                    PathResolveDiag {
                        mailbox_rowid: Some(mb),
                        method: PathResolveMethod::MailboxUrl,
                    },
                );
            }
            let map = cache.ensure_mailbox_index(mb, &mbox);
            let n = map.len();
            if let Some(p) = map.get(&emlx_file_stem_id) {
                return (
                    Some(p.clone()),
                    PathResolveDiag {
                        mailbox_rowid: Some(mb),
                        method: PathResolveMethod::MailboxIndex { files_indexed: n },
                    },
                );
            }
            return (
                None,
                PathResolveDiag {
                    mailbox_rowid: Some(mb),
                    method: PathResolveMethod::NotFound,
                },
            );
        }
    }

    let gmap = cache.ensure_global_index(mail_library_root);
    let n = gmap.len();
    if let Some(p) = gmap.get(&emlx_file_stem_id) {
        return (
            Some(p.clone()),
            PathResolveDiag {
                mailbox_rowid,
                method: PathResolveMethod::GlobalIndex { files_indexed: n },
            },
        );
    }

    (
        None,
        PathResolveDiag {
            mailbox_rowid,
            method: PathResolveMethod::NotFound,
        },
    )
}

/// Best-effort: same as [`resolve_emlx_path`] but uses envelope row.
pub fn resolve_emlx_for_row(
    mail_library_root: &Path,
    envelope: &Connection,
    row: &EnvelopeMessageRow,
) -> Option<PathBuf> {
    let mut cache = ApplemailEmlxCache::new();
    resolve_emlx_for_row_with_diag(mail_library_root, envelope, row, &mut cache).0
}

/// Best-effort with diagnostics (see [`PathResolveDiag`]). When `mailbox_rowid` is set, uses the
/// same [`resolve_emlx_deterministic_then_scan`] strategy as Apple Mail sync (ROWID then `remote_id`).
pub fn resolve_emlx_for_row_with_diag(
    mail_library_root: &Path,
    envelope: &Connection,
    row: &EnvelopeMessageRow,
    cache: &mut ApplemailEmlxCache,
) -> (Option<PathBuf>, PathResolveDiag) {
    let Some(mb) = row.mailbox_rowid else {
        return resolve_emlx_path_with_diag(mail_library_root, envelope, row.rowid, None, cache);
    };
    resolve_emlx_deterministic_then_scan(
        mail_library_root,
        envelope,
        mb,
        row.rowid,
        row.remote_id,
        cache,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn find_emlx_under_mbox_shard() {
        let tmp = tempfile::tempdir().unwrap();
        let mbox = tmp.path().join("Inbox.mbox");
        let target = mbox.join("Data").join("3").join("Messages").join("42.emlx");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"1\nx").unwrap();
        let got = find_emlx_under_mbox(&mbox, 42).unwrap();
        assert_eq!(got, target);
    }

    #[test]
    fn find_emlx_partial() {
        let tmp = tempfile::tempdir().unwrap();
        let mbox = tmp.path().join("Inbox.mbox");
        let target = mbox
            .join("Data")
            .join("3")
            .join("Messages")
            .join("42.partial.emlx");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"1\nx").unwrap();
        let got = find_emlx_under_mbox(&mbox, 42).unwrap();
        assert_eq!(got, target);
    }

    #[test]
    fn find_emlx_prefers_full_over_partial() {
        let tmp = tempfile::tempdir().unwrap();
        let mbox = tmp.path().join("Inbox.mbox");
        let msgs = mbox.join("Data").join("Messages");
        fs::create_dir_all(&msgs).unwrap();
        let full = msgs.join("42.emlx");
        let partial = msgs.join("42.partial.emlx");
        fs::write(&full, b"1\nfull").unwrap();
        fs::write(&partial, b"1\npartial").unwrap();
        let got = find_emlx_under_mbox(&mbox, 42).unwrap();
        assert_eq!(got, full);
    }

    #[test]
    fn file_url_to_path_macos() {
        let p = file_url_to_path("file:///Users/u/Library/Mail/V10/x/Inbox.mbox").unwrap();
        assert!(p.ends_with("Inbox.mbox"));
    }

    #[test]
    fn imap_url_to_mbox_path_basic() {
        let root = PathBuf::from("/Users/u/Library/Mail/V10");
        let p = imap_url_to_mbox_path("imap://2ECD4393-916D-4F93-A4DE-C36E747ABBEE/INBOX", &root)
            .unwrap();
        assert_eq!(
            p,
            PathBuf::from(
                "/Users/u/Library/Mail/V10/2ECD4393-916D-4F93-A4DE-C36E747ABBEE/INBOX.mbox"
            )
        );
    }

    #[test]
    fn imap_url_to_mbox_path_percent_encoded() {
        let root = PathBuf::from("/Users/u/Library/Mail/V10");
        let p = imap_url_to_mbox_path(
            "imap://2ECD4393-916D-4F93-A4DE-C36E747ABBEE/Sent%20Messages",
            &root,
        )
        .unwrap();
        assert_eq!(
            p,
            PathBuf::from(
                "/Users/u/Library/Mail/V10/2ECD4393-916D-4F93-A4DE-C36E747ABBEE/Sent Messages.mbox"
            )
        );
    }

    #[test]
    fn index_messages_tree_finds_emlx() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("a").join("Messages").join("7.emlx");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"1\nx").unwrap();
        let idx = index_messages_tree(tmp.path());
        assert_eq!(idx.get(&7), Some(&target));
    }

    #[test]
    fn index_messages_tree_finds_partial_emlx() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("a").join("Messages").join("7.partial.emlx");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"1\nx").unwrap();
        let idx = index_messages_tree(tmp.path());
        assert_eq!(idx.get(&7), Some(&target));
    }

    #[test]
    fn index_messages_tree_prefers_full() {
        let tmp = tempfile::tempdir().unwrap();
        let msgs = tmp.path().join("a").join("Messages");
        fs::create_dir_all(&msgs).unwrap();
        let full = msgs.join("7.emlx");
        let partial = msgs.join("7.partial.emlx");
        fs::write(&full, b"1\nfull").unwrap();
        fs::write(&partial, b"1\npartial").unwrap();
        let idx = index_messages_tree(tmp.path());
        assert_eq!(idx.get(&7), Some(&full));
    }

    #[test]
    fn parse_emlx_stem_variants() {
        assert_eq!(parse_emlx_stem("12345.emlx"), Some(12345));
        assert_eq!(parse_emlx_stem("12345.partial.emlx"), Some(12345));
        assert_eq!(parse_emlx_stem("notanumber.emlx"), None);
        assert_eq!(parse_emlx_stem("12345.txt"), None);
    }

    #[test]
    fn resolve_deterministic_then_scan_falls_back_to_remote_id_stem() {
        let tmp = tempfile::tempdir().unwrap();
        let mail_root = tmp.path().join("V1");
        let mbox = mail_root.join("Acc.mbox");
        let uuid = "D9A37CC5-A285-4709-A74E-9F59CDA36BF2";
        // On-disk file uses stem 100 (typical when Envelope `remote_id` matches IMAP UID, not ROWID).
        let emlx = mbox
            .join(uuid)
            .join("Data")
            .join("Messages")
            .join("100.emlx");
        fs::create_dir_all(emlx.parent().unwrap()).unwrap();
        fs::write(&emlx, b"1\nx").unwrap();

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE mailboxes (url TEXT);
             INSERT INTO mailboxes VALUES ('file://localhost')",
        )
        .unwrap();
        let url = format!("file://{}", mbox.display());
        conn.execute("UPDATE mailboxes SET url = ?1 WHERE ROWID = 1", [&url])
            .unwrap();

        let mut cache = ApplemailEmlxCache::new();
        let (got, diag) =
            resolve_emlx_deterministic_then_scan(&mail_root, &conn, 1, 5, Some(100), &mut cache);
        assert_eq!(got.as_deref(), Some(emlx.as_path()));
        assert!(matches!(diag.method, PathResolveMethod::MailboxUrl));
    }

    #[test]
    fn resolve_prefers_mailbox_index_over_global() {
        let tmp = tempfile::tempdir().unwrap();
        let mail_root = tmp.path().join("V1");
        let mbox = mail_root.join("Acc.mbox");
        let emlx = mbox.join("Data").join("1").join("Messages").join("99.emlx");
        fs::create_dir_all(emlx.parent().unwrap()).unwrap();
        fs::write(&emlx, b"1\nx").unwrap();

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE mailboxes (url TEXT);
             INSERT INTO mailboxes VALUES ('file://localhost')",
        )
        .unwrap();
        // file URL must point at mbox — use absolute path
        let url = format!("file://{}", mbox.display());
        conn.execute("UPDATE mailboxes SET url = ?1 WHERE ROWID = 1", [&url])
            .unwrap();

        let mut cache = ApplemailEmlxCache::new();
        let (got, diag) = resolve_emlx_path_with_diag(&mail_root, &conn, 99, Some(1), &mut cache);
        assert_eq!(got.as_deref(), Some(emlx.as_path()));
        assert!(matches!(diag.method, PathResolveMethod::MailboxUrl));
        drop(got);

        // Wrong direct layout: force index path — put file only under nested Messages
        let mbox2 = mail_root.join("Alt.mbox");
        let emlx2 = mbox2.join("nested").join("Messages").join("100.emlx");
        fs::create_dir_all(emlx2.parent().unwrap()).unwrap();
        fs::write(&emlx2, b"1\nx").unwrap();
        let url2 = format!("file://{}", mbox2.display());
        conn.execute("UPDATE mailboxes SET url = ?1 WHERE ROWID = 1", [&url2])
            .unwrap();

        let mut cache2 = ApplemailEmlxCache::new();
        let (got2, diag2) =
            resolve_emlx_path_with_diag(&mail_root, &conn, 100, Some(1), &mut cache2);
        assert_eq!(got2.as_deref(), Some(emlx2.as_path()));
        assert!(matches!(
            diag2.method,
            PathResolveMethod::MailboxIndex { .. }
        ));
    }

    #[test]
    fn emlx_shard_path_matches_apple_mail_v10_layout() {
        let data = PathBuf::from("/tmp/Data");
        assert_eq!(
            emlx_shard_path(&data, 253118),
            PathBuf::from("/tmp/Data/3/5/2/Messages/253118.emlx")
        );
        assert_eq!(
            emlx_shard_path(&data, 52_000),
            PathBuf::from("/tmp/Data/2/5/Messages/52000.emlx")
        );
        assert_eq!(
            emlx_shard_path(&data, 999),
            PathBuf::from("/tmp/Data/Messages/999.emlx")
        );
        assert_eq!(
            emlx_shard_path(&data, 0),
            PathBuf::from("/tmp/Data/Messages/0.emlx")
        );
    }

    #[test]
    fn discover_store_root_finds_uuid_with_data() {
        let tmp = tempfile::tempdir().unwrap();
        let mbox = tmp.path().join("INBOX.mbox");
        let uuid = "D9A37CC5-A285-4709-A74E-9F59CDA36BF2";
        let store = mbox.join(uuid);
        fs::create_dir_all(store.join("Data").join("Messages")).unwrap();
        assert_eq!(
            discover_store_root(&mbox)
                .unwrap()
                .file_name()
                .and_then(|n| n.to_str()),
            Some(uuid)
        );
    }

    #[test]
    fn resolve_with_imap_url() {
        let tmp = tempfile::tempdir().unwrap();
        let mail_root = tmp.path().join("V10");
        let uuid = "2ECD4393-916D-4F93-A4DE-C36E747ABBEE";
        let mbox = mail_root.join(uuid).join("INBOX.mbox");
        let emlx = mbox.join("Data").join("Messages").join("123.emlx");
        fs::create_dir_all(emlx.parent().unwrap()).unwrap();
        fs::write(&emlx, b"1\nx").unwrap();

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE mailboxes (url TEXT);
             INSERT INTO mailboxes VALUES ('imap://2ECD4393-916D-4F93-A4DE-C36E747ABBEE/INBOX')",
        )
        .unwrap();

        let mut cache = ApplemailEmlxCache::new();
        let (got, diag) = resolve_emlx_path_with_diag(&mail_root, &conn, 123, Some(1), &mut cache);
        assert_eq!(got.as_deref(), Some(emlx.as_path()));
        assert!(matches!(diag.method, PathResolveMethod::MailboxUrl));
    }
}
