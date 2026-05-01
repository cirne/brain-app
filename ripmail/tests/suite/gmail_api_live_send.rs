//! Live Gmail API send smoke test (manual). Does not run in CI.
//!
//! Prerequisites: `RIPMAIL_HOME` with Gmail `googleOAuth` + `google-oauth.json`; Gmail API enabled in Google Cloud.
//!
//! ```bash
//! export RIPMAIL_LIVE_GMAIL_SEND=1
//! export RIPMAIL_HOME=/path/to/ripmail/home
//! unset RIPMAIL_SEND_TEST   # or recipient must match DEV_SEND_ALLOWLIST when send-test is on
//! cargo nextest run -p ripmail -E 'test(live_gmail_https)' --run-ignored only
//! ```

use std::process::Command;

#[test]
#[ignore = "live network + real mailbox; see module doc"]
fn live_gmail_https_send_smoke() {
    assert_eq!(
        std::env::var("RIPMAIL_LIVE_GMAIL_SEND").unwrap_or_default(),
        "1",
        "Set RIPMAIL_LIVE_GMAIL_SEND=1 to run this test"
    );
    let home = std::env::var("RIPMAIL_HOME").expect("RIPMAIL_HOME must be set");

    let exe = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(exe)
        .env("RIPMAIL_HOME", &home)
        .args([
            "send",
            "--to",
            "lewiscirne@gmail.com",
            "--subject",
            "ripmail live Gmail API HTTPS smoke",
            "--body",
            "Automated ignored integration test (suite/gmail_api_live_send). Safe to delete.",
            "--text",
        ])
        .output()
        .expect("spawn ripmail send");

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("users.messages.send"),
        "expected Gmail API send path in stderr; got stderr={stderr:?}"
    );
    assert!(
        out.status.success(),
        "ripmail send failed: status={} stderr={stderr} stdout={}",
        out.status,
        String::from_utf8_lossy(&out.stdout)
    );
}
