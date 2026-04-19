//! Local directory indexing + unified FTS keyword search for `kind = file`.

use std::fs;

use rusqlite::OptionalExtension;
use tempfile::tempdir;

use ripmail::config::{ConfigJson, LoadConfigOptions, LocalDirJson, SourceConfigJson, SourceKind};
use ripmail::db::open_file;
use ripmail::search_with_meta;
use ripmail::write_config_json;
use ripmail::{load_config, run_local_dir_sync, SearchOptions};

#[test]
fn local_dir_sync_indexes_files_and_fts_finds_body() {
    let tmp = tempdir().unwrap();
    let home = tmp.path();
    let root = tmp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("note.md"),
        "unique_token_ripmail_local_dir_test body",
    )
    .unwrap();

    let cfg_json = ConfigJson {
        sources: Some(vec![SourceConfigJson {
            id: "x_docs_local".into(),
            kind: SourceKind::LocalDir,
            email: String::new(),
            label: None,
            imap: None,
            imap_auth: None,
            search: None,
            identity: None,
            apple_mail_path: None,
            path: Some(root.to_string_lossy().into()),
            local_dir: Some(LocalDirJson::default()),
            oauth_source_id: None,
            calendar_ids: None,
            ics_url: None,
            default_calendars: None,
        }]),
        ..Default::default()
    };
    write_config_json(home, &cfg_json).unwrap();

    let cfg = load_config(LoadConfigOptions {
        home: Some(home.to_path_buf()),
        env: None,
    });
    let mb = cfg
        .resolved_mailboxes()
        .iter()
        .find(|m| m.kind == SourceKind::LocalDir)
        .expect("localDir source")
        .clone();

    let mut conn = open_file(cfg.db_path()).unwrap();
    run_local_dir_sync(&mut conn, &mb, false).unwrap();

    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM document_index WHERE source_id = ?1 AND kind = 'file'",
            [&mb.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "expected one file row in document_index");

    let last: Option<String> = conn
        .query_row(
            "SELECT last_synced_at FROM sources WHERE id = ?1",
            [&mb.id],
            |r| r.get(0),
        )
        .optional()
        .unwrap();
    assert!(
        last.is_some(),
        "sources row should record last_synced_at after local dir sync"
    );

    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("unique_token_ripmail_local_dir_test".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        set.results.iter().any(|r| {
            r.source_kind == "localDir"
                && r.message_id.contains("note.md")
                && r.subject.contains("note.md")
        }),
        "expected FTS hit for indexed markdown; got {:?}",
        set.results
    );
}
