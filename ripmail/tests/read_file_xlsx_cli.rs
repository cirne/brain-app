//! `ripmail read <path>` for local files: XLSX misnamed as `.bin` must extract CSV, not PK… gibberish.

use std::fs;
use std::process::Command;

use rust_xlsxwriter::Workbook;
use tempfile::tempdir;

#[test]
fn read_json_xlsx_renamed_bin_is_csv_not_pk() {
    let home = tempdir().unwrap();
    fs::write(
        home.path().join("config.json"),
        r#"{"sync":{"defaultSince":"1y"}}"#,
    )
    .unwrap();

    let docs = tempdir().unwrap();
    let xlsx_path = docs.path().join("sheet.xlsx");
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.write_string(0, 0, "Segment").unwrap();
    wb.save(&xlsx_path).unwrap();

    let bin_path = docs.path().join("data.bin");
    fs::copy(&xlsx_path, &bin_path).unwrap();

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", home.path())
        .current_dir(docs.path())
        .args(["read", "data.bin", "--json"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let body = v["bodyText"].as_str().expect("bodyText");
    assert!(!body.starts_with("PK"));
    assert!(body.contains("Segment"));
}
