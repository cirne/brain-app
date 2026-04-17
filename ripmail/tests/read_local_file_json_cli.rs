//! `ripmail read <path> --json` for local files: structured `readStatus`, no binary `utf8_lossy` dumps.

use std::fs;
use std::process::Command;

use tempfile::tempdir;

#[test]
fn read_json_empty_pdf_is_image_heavy() {
    let home = tempdir().unwrap();
    fs::write(
        home.path().join("config.json"),
        r#"{"sync":{"defaultSince":"1y"}}"#,
    )
    .unwrap();

    let docs = tempdir().unwrap();
    let path = docs.path().join("empty.pdf");
    fs::write(&path, b"").unwrap();

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", home.path())
        .current_dir(docs.path())
        .args(["read", "empty.pdf", "--json"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["readStatus"], "image_heavy_pdf");
    assert!(v["bodyText"].as_str().unwrap().contains("PDF"));
    assert!(v["hint"].as_str().is_some_and(|s| !s.is_empty()));
    assert_eq!(v["mime"], "application/pdf");
}

#[test]
fn read_json_random_bin_is_binary_status() {
    let home = tempdir().unwrap();
    fs::write(
        home.path().join("config.json"),
        r#"{"sync":{"defaultSince":"1y"}}"#,
    )
    .unwrap();

    let docs = tempdir().unwrap();
    fs::write(docs.path().join("noise.bin"), vec![0xFFu8; 400]).unwrap();

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", home.path())
        .current_dir(docs.path())
        .args(["read", "noise.bin", "--json"])
        .output()
        .unwrap();
    assert!(out.status.success());
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["readStatus"], "binary");
    assert!(v["bodyText"].as_str().unwrap().contains("Binary file"));
}

#[test]
fn read_json_markdown_ok_status() {
    let home = tempdir().unwrap();
    fs::write(
        home.path().join("config.json"),
        r#"{"sync":{"defaultSince":"1y"}}"#,
    )
    .unwrap();

    let docs = tempdir().unwrap();
    fs::write(docs.path().join("note.md"), b"# Title\n\nhello").unwrap();

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", home.path())
        .current_dir(docs.path())
        .args(["read", "note.md", "--json"])
        .output()
        .unwrap();
    assert!(out.status.success());
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["readStatus"], "ok");
    assert!(v["bodyText"].as_str().unwrap().contains("Title"));
}
