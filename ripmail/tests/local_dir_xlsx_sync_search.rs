//! Local directory indexes `.xlsx` as CSV text; FTS finds tokens from sheet content.
//!
//! Indexing uses the same [`ripmail::extract_attachment`] as email attachments and `ripmail read`;
//! tests below assert stored text matches a direct call (no duplicate extractors).

use std::fs;

use tempfile::tempdir;

use ripmail::config::{ConfigJson, LoadConfigOptions, LocalDirJson, SourceConfigJson, SourceKind};
use ripmail::db::open_file;
use ripmail::search_with_meta;
use ripmail::write_config_json;
use ripmail::{extract_attachment, load_config, run_local_dir_sync, SearchOptions};
use rust_xlsxwriter::Workbook;

#[test]
fn local_dir_sync_indexes_xlsx_and_fts_finds_cell_token() {
    let tmp = tempdir().unwrap();
    let home = tmp.path();
    let root = tmp.path().join("docs");
    fs::create_dir_all(&root).unwrap();

    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    let token = "unique_xlsx_fts_token_ripmail_9f3a";
    ws.write_string(0, 0, token).unwrap();
    wb.save(root.join("sheet.xlsx")).unwrap();

    let cfg_json = ConfigJson {
        sources: Some(vec![SourceConfigJson {
            id: "x_xlsx_local".into(),
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

    let body: String = conn
        .query_row(
            "SELECT body FROM document_index WHERE source_id = ?1 AND kind = 'file' AND ext_id = 'sheet.xlsx'",
            [&mb.id],
            |r| r.get(0),
        )
        .expect("indexed xlsx row");
    assert!(
        body.contains(token),
        "body should be extracted CSV-ish text, not PK…; got {}…",
        body.chars().take(80).collect::<String>()
    );
    assert!(!body.starts_with("PK"));

    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some(token.into()),
            mailbox_ids: Some(vec![mb.id.clone()]),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        set.results.iter().any(|r| {
            r.source_kind == "localDir"
                && r.message_id.contains("sheet.xlsx")
                && r.body_preview.contains(token)
        }),
        "expected FTS hit for xlsx cell text; got {:?}",
        set.results
    );
}

#[test]
fn local_dir_fixture_xlsx_sales_data_indexable() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/attachments/fixtures/sales-data.xlsx");
    assert!(fixture.is_file(), "fixture missing: {}", fixture.display());

    let tmp = tempdir().unwrap();
    let home = tmp.path();
    let root = tmp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    fs::copy(&fixture, root.join("sales-data.xlsx")).unwrap();

    let cfg_json = ConfigJson {
        sources: Some(vec![SourceConfigJson {
            id: "x_sales_fixture".into(),
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
        .find(|m| m.id == "x_sales_fixture")
        .unwrap()
        .clone();

    let mut conn = open_file(cfg.db_path()).unwrap();
    run_local_dir_sync(&mut conn, &mb, false).unwrap();

    let body: String = conn
        .query_row(
            "SELECT body FROM document_index WHERE source_id = ?1 AND kind = 'file'",
            [&mb.id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!body.starts_with("PK"), "xlsx must not be indexed as raw ZIP bytes");

    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("sales".into()),
            mailbox_ids: Some(vec![mb.id.clone()]),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        !set.results.is_empty(),
        "expected at least one FTS hit for 'sales' in fixture xlsx"
    );
}

/// Indexed `files` / `document_index` body must match [`extract_attachment`] — same path as mail attachments.
#[test]
fn local_dir_stored_text_matches_extract_attachment_direct() {
    let tmp = tempdir().unwrap();
    let home = tmp.path();
    let root = tmp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("book.xlsx");
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.write_string(0, 0, "parity_cell_a1").unwrap();
    wb.save(&path).unwrap();

    let bytes = fs::read(&path).unwrap();
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    let expected = extract_attachment(&bytes, &mime, "book.xlsx").expect("xlsx extract");

    let cfg_json = ConfigJson {
        sources: Some(vec![SourceConfigJson {
            id: "x_parity".into(),
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
        .find(|m| m.id == "x_parity")
        .unwrap()
        .clone();

    let mut conn = open_file(cfg.db_path()).unwrap();
    run_local_dir_sync(&mut conn, &mb, false).unwrap();

    let file_body: String = conn
        .query_row(
            "SELECT body_text FROM files WHERE source_id = ?1 AND rel_path = 'book.xlsx'",
            [&mb.id],
            |r| r.get(0),
        )
        .unwrap();
    let doc_body: String = conn
        .query_row(
            "SELECT body FROM document_index WHERE source_id = ?1 AND kind = 'file' AND ext_id = 'book.xlsx'",
            [&mb.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(file_body, expected);
    assert_eq!(doc_body, expected);
}

/// Misnamed `.bin` + octet-stream still goes through [`extract_attachment`] (ZIP sniff); DB must match.
#[test]
fn local_dir_misnamed_xlsx_bin_matches_extract_attachment_direct() {
    let tmp = tempdir().unwrap();
    let home = tmp.path();
    let root = tmp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("opaque.bin");
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.write_string(0, 0, "bin_row_token").unwrap();
    wb.save(&path).unwrap();

    let bytes = fs::read(&path).unwrap();
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    assert_eq!(mime, "application/octet-stream");
    let expected =
        extract_attachment(&bytes, &mime, "opaque.bin").expect("zip sniff xlsx for .bin");

    let cfg_json = ConfigJson {
        sources: Some(vec![SourceConfigJson {
            id: "x_bin_parity".into(),
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
        .find(|m| m.id == "x_bin_parity")
        .unwrap()
        .clone();

    let mut conn = open_file(cfg.db_path()).unwrap();
    run_local_dir_sync(&mut conn, &mb, false).unwrap();

    let file_body: String = conn
        .query_row(
            "SELECT body_text FROM files WHERE source_id = ?1 AND rel_path = 'opaque.bin'",
            [&mb.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(file_body, expected);
    assert!(file_body.contains("bin_row_token"));
}
