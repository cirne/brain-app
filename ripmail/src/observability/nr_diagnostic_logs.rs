//! Best-effort forward of Ripmail diagnostic lines to New Relic Log API (HTTPS).
//! Does not use stdout/stderr; failures are swallowed so sync never breaks.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;

const US_LOG_API: &str = "https://log-api.newrelic.com/log/v1";
const POST_TIMEOUT: Duration = Duration::from_secs(5);

fn send_mutex() -> &'static Mutex<()> {
    static M: OnceLock<Mutex<()>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(()))
}

/// When true, Ripmail may POST diagnostic sync lines to New Relic Log API.
/// Testable without reading process environment.
pub fn nr_diag_enabled_from_parts(
    license_key: Option<&str>,
    node_env: Option<&str>,
    ripmail_nr_diagnostics: Option<&str>,
) -> bool {
    let key_ok = license_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();
    if !key_ok {
        return false;
    }
    let prod = node_env.map(str::trim) == Some("production");
    let opt_in = matches!(
        ripmail_nr_diagnostics.map(str::trim),
        Some("1") | Some("true") | Some("yes")
    );
    prod || opt_in
}

fn nr_diag_enabled_process() -> bool {
    nr_diag_enabled_from_parts(
        std::env::var("NEW_RELIC_LICENSE_KEY").ok().as_deref(),
        std::env::var("NODE_ENV").ok().as_deref(),
        std::env::var("RIPMAIL_NR_DIAGNOSTICS").ok().as_deref(),
    )
}

fn trim_opt_env(key: &str) -> Option<String> {
    std::env::var(key).ok().and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

#[derive(Serialize)]
struct LogApiRoot<'a> {
    #[serde(rename = "common")]
    common: LogApiCommon,
    logs: [LogApiLogEntry<'a>; 1],
}

#[derive(Serialize)]
struct LogApiCommon {
    attributes: LogApiCommonAttrs,
}

#[derive(Serialize)]
struct LogApiCommonAttrs {
    #[serde(rename = "service.name")]
    service_name: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "newrelic.appName")]
    app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostname: Option<String>,
}

#[derive(Serialize)]
struct LogApiLogEntry<'a> {
    timestamp: i64,
    message: String,
    attributes: LogLineAttrs<'a>,
}

#[derive(Serialize)]
struct LogLineAttrs<'a> {
    source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none", rename = "tenantUserId")]
    tenant_user_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "workspaceHandle")]
    workspace_handle: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "ripmail.sync.data")]
    data: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "ripmail.sync.event")]
    event: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
}

/// Forward one sync diagnostic line (after file append). Best-effort only.
pub(crate) fn forward_sync_log_line(
    level: &str,
    message: &str,
    data: Option<&str>,
    tenant_user_id: Option<&str>,
    workspace_handle: Option<&str>,
) {
    if !nr_diag_enabled_process() {
        return;
    }
    let Some(license) = trim_opt_env("NEW_RELIC_LICENSE_KEY") else {
        return;
    };

    let ts = chrono::Utc::now().timestamp_millis();
    let msg_line = match data {
        Some(d) => format!("[{level}] {message} {d}"),
        None => format!("[{level}] {message}"),
    };

    let app_name = std::env::var("NEW_RELIC_APP_NAME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let hostname = std::env::var("HOSTNAME")
        .ok()
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let body = match serde_json::to_string(&[LogApiRoot {
        common: LogApiCommon {
            attributes: LogApiCommonAttrs {
                service_name: "ripmail".to_string(),
                source: "ripmail_sync".to_string(),
                app_name,
                hostname,
            },
        },
        logs: [LogApiLogEntry {
            timestamp: ts,
            message: msg_line,
            attributes: LogLineAttrs {
                source: "ripmail_sync",
                tenant_user_id,
                workspace_handle,
                level: Some(level),
                data,
                event: None,
                pid: None,
            },
        }],
    }]) {
        Ok(s) => s,
        Err(_) => return,
    };

    post_logs(&license, &body);
}

/// Forward sync run separator (`sync_run_start`). Best-effort only.
pub(crate) fn forward_sync_run_start(
    pid: u32,
    tenant_user_id: Option<&str>,
    workspace_handle: Option<&str>,
) {
    if !nr_diag_enabled_process() {
        return;
    }
    let Some(license) = trim_opt_env("NEW_RELIC_LICENSE_KEY") else {
        return;
    };

    let ts = chrono::Utc::now().timestamp_millis();
    let msg_line = format!("ripmail sync run start pid={pid}");

    let app_name = std::env::var("NEW_RELIC_APP_NAME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let hostname = std::env::var("HOSTNAME")
        .ok()
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let body = match serde_json::to_string(&[LogApiRoot {
        common: LogApiCommon {
            attributes: LogApiCommonAttrs {
                service_name: "ripmail".to_string(),
                source: "ripmail_sync".to_string(),
                app_name,
                hostname,
            },
        },
        logs: [LogApiLogEntry {
            timestamp: ts,
            message: msg_line,
            attributes: LogLineAttrs {
                source: "ripmail_sync",
                tenant_user_id,
                workspace_handle,
                level: None,
                data: None,
                event: Some("sync_run_start"),
                pid: Some(pid),
            },
        }],
    }]) {
        Ok(s) => s,
        Err(_) => return,
    };

    post_logs(&license, &body);
}

fn post_logs(license_key: &str, json_body: &str) {
    let Ok(_guard) = send_mutex().lock() else {
        return;
    };
    let _ = ureq::post(US_LOG_API)
        .set("Api-Key", license_key)
        .set("Content-Type", "application/json")
        .timeout(POST_TIMEOUT)
        .send_string(json_body);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nr_diag_requires_license() {
        assert!(!nr_diag_enabled_from_parts(None, Some("production"), None));
        assert!(!nr_diag_enabled_from_parts(
            Some(""),
            Some("production"),
            None
        ));
        assert!(!nr_diag_enabled_from_parts(
            Some("   "),
            Some("production"),
            None
        ));
    }

    #[test]
    fn nr_diag_production_with_license() {
        assert!(nr_diag_enabled_from_parts(
            Some("abc"),
            Some("production"),
            None
        ));
    }

    #[test]
    fn nr_diag_non_prod_without_opt_in() {
        assert!(!nr_diag_enabled_from_parts(
            Some("abc"),
            Some("development"),
            None
        ));
    }

    #[test]
    fn nr_diag_opt_in_without_production() {
        assert!(nr_diag_enabled_from_parts(Some("abc"), None, Some("1")));
        assert!(nr_diag_enabled_from_parts(
            Some("abc"),
            Some("development"),
            Some("true")
        ));
    }

    #[test]
    fn log_payload_shape_line() {
        let root = [LogApiRoot {
            common: LogApiCommon {
                attributes: LogApiCommonAttrs {
                    service_name: "ripmail".to_string(),
                    source: "ripmail_sync".to_string(),
                    app_name: Some("Braintunnel Local Dev".to_string()),
                    hostname: Some("test-host".to_string()),
                },
            },
            logs: [LogApiLogEntry {
                timestamp: 1_700_000_000_000,
                message: "[INFO] hello extra".to_string(),
                attributes: LogLineAttrs {
                    source: "ripmail_sync",
                    tenant_user_id: Some("usr_x"),
                    workspace_handle: Some("alice"),
                    level: Some("INFO"),
                    data: Some("extra"),
                    event: None,
                    pid: None,
                },
            }],
        }];
        let s = serde_json::to_string(&root).unwrap();
        assert!(s.contains("ripmail_sync"));
        assert!(s.contains("tenantUserId"));
        assert!(s.contains("usr_x"));
        assert!(s.contains("service.name"));
    }
}
