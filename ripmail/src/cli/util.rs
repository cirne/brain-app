use std::path::PathBuf;

use ripmail::{load_config, resolved_ripmail_home_from_env, Config, LoadConfigOptions};

pub(crate) fn load_cfg() -> Config {
    load_config(LoadConfigOptions {
        home: resolved_ripmail_home_from_env(),
        env: None,
    })
}

pub(crate) fn ripmail_home_path() -> PathBuf {
    resolved_ripmail_home_from_env().expect("internal error: ripmail_home_path after env guard")
}

pub(crate) fn format_attachment_size(n: i64) -> String {
    if n >= 1024 * 1024 {
        format!("{:.2} MB", n as f64 / (1024.0 * 1024.0))
    } else if n >= 1024 {
        format!("{:.2} KB", n as f64 / 1024.0)
    } else {
        format!("{n} B")
    }
}
