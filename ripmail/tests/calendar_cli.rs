use std::fs;
use std::process::Command;
use tempfile::tempdir;

fn setup_calendar_db(home: &std::path::Path) {
    fs::create_dir_all(home.join("data")).unwrap();
    let config = serde_json::json!({
        "sources": [{
            "id": "test_cal",
            "kind": "icsFile",
            "path": home.join("test.ics").to_str().unwrap(),
            "email": "test@example.com"
        }]
    });
    fs::write(
        home.join("config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();

    let ics = "BEGIN:VCALENDAR\r\n\
               BEGIN:VEVENT\r\n\
               UID:event1\r\n\
               DTSTART:20260420T100000Z\r\n\
               DTEND:20260420T110000Z\r\n\
               SUMMARY:Test Event\r\n\
               END:VEVENT\r\n\
               END:VCALENDAR\r\n";
    fs::write(home.join("test.ics"), ics).unwrap();

    // Run sync to populate DB
    let status = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", home)
        .args(["refresh", "--foreground"])
        .status()
        .expect("sync failed");
    assert!(status.success());
}

#[test]
fn test_calendar_list_and_query() {
    let tmp = tempdir().unwrap();
    setup_calendar_db(tmp.path());

    // 1. List calendars
    let out = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", tmp.path())
        .args(["calendar", "list-calendars", "--json"])
        .output()
        .expect("list-calendars failed");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let val: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| {
        panic!(
            "failed to parse JSON: {e}\nSTDOUT: {stdout}\nSTDERR: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    });
    assert_eq!(val["calendars"][0]["sourceId"], "test_cal");

    // 2. Range query
    let out = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", tmp.path())
        .args([
            "calendar",
            "range",
            "--from",
            "2026-04-19",
            "--to",
            "2026-04-21",
            "--json",
        ])
        .output()
        .expect("range failed");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let val: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| {
        panic!(
            "failed to parse range JSON: {e}\nSTDOUT: {stdout}\nSTDERR: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    });
    assert_eq!(val["events"].as_array().unwrap().len(), 1);
    assert_eq!(val["events"][0]["summary"], "Test Event");

    // 3. Search
    let out = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", tmp.path())
        .args(["calendar", "search", "--query", "Test", "--json"])
        .output()
        .expect("search failed");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let val: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| {
        panic!(
            "failed to parse search JSON: {e}\nSTDOUT: {stdout}\nSTDERR: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    });
    assert_eq!(val["events"].as_array().unwrap().len(), 1);
}

#[test]
fn list_calendars_json_includes_colors_from_calendar_colors_json() {
    let tmp = tempdir().unwrap();
    let ics_path = tmp.path().join("noop.ics");
    fs::write(&ics_path, "").unwrap();

    fs::create_dir_all(tmp.path().join("src_colors")).unwrap();
    let config = serde_json::json!({
        "sources": [{
            "id": "src_colors",
            "kind": "icsFile",
            "path": ics_path.to_str().unwrap(),
            "email": "colors@example.com",
            "calendarIds": ["cal_a"]
        }]
    });
    fs::write(
        tmp.path().join("config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();

    fs::write(
        tmp.path().join("src_colors").join("calendar-names.json"),
        r#"{"cal_a":"Alpha Cal"}"#,
    )
    .unwrap();
    fs::write(
        tmp.path().join("src_colors").join("calendar-colors.json"),
        r##"{"cal_a":"#abcdef"}"##,
    )
    .unwrap();

    let out = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", tmp.path())
        .args(["calendar", "list-calendars", "--json"])
        .output()
        .expect("list-calendars failed");
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    let val: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| {
        panic!(
            "failed to parse JSON: {e}\nSTDOUT: {stdout}\nSTDERR: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    });
    let rows = val["calendars"].as_array().expect("calendars array");
    let row = rows
        .iter()
        .find(|r| r["sourceId"] == "src_colors")
        .expect("src_colors row");
    let configured = row["calendars"].as_array().unwrap();
    assert_eq!(configured[0]["id"], "cal_a");
    assert_eq!(configured[0]["color"], "#abcdef");
    let all = row["allCalendars"].as_array().unwrap();
    assert_eq!(all[0]["color"], "#abcdef");
}
