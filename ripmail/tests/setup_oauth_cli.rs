use std::fs;
use std::process::Command;
use tempfile::tempdir;

#[test]
fn test_setup_google_oauth_cli() {
    let tmp = tempdir().unwrap();
    let home = tmp.path();

    // We can't run the full interactive OAuth flow in a test,
    // but we can test that the CLI correctly handles the --google-oauth flag
    // and fails gracefully when it can't open a browser or when env is missing.

    let out = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", home)
        .env_remove("GOOGLE_OAUTH_CLIENT_ID")
        .env_remove("GOOGLE_OAUTH_CLIENT_SECRET")
        .env("RIPMAIL_GOOGLE_OAUTH_REDIRECT_URI", "http://127.0.0.1:1/cb") // Invalid port to fail fast
        .args([
            "setup",
            "--email",
            "test@gmail.com",
            "--google-oauth",
            "--no-validate",
        ])
        .output()
        .expect("setup failed");

    let stderr = String::from_utf8_lossy(&out.stderr);
    // It should fail because port 1 is privileged or no client ID is provided
    assert!(!out.status.success());
    assert!(
        stderr.contains("GOOGLE_OAUTH_CLIENT_ID")
            || stderr.contains("OAuth client")
            || stderr.contains("redirect URI")
            || stderr.contains("Bind")
    );
}

#[test]
fn test_setup_apple_mail_cli() {
    let tmp = tempdir().unwrap();
    let home = tmp.path();

    let out = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", home)
        .args([
            "setup",
            "--email",
            "test@icloud.com",
            "--apple-mail",
            "--no-validate",
        ])
        .output()
        .expect("setup failed");

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.contains("Could not find Apple Mail") || stderr.contains("Full Disk Access") {
            return;
        }
        panic!("setup --apple-mail failed unexpectedly: {stderr}");
    }
    let config_raw = fs::read_to_string(home.join("config.json")).unwrap();
    let config: serde_json::Value = serde_json::from_str(&config_raw).unwrap();

    let source = &config["sources"][0];
    assert_eq!(source["kind"], "applemail");
    assert_eq!(source["email"], "test@icloud.com");
}
