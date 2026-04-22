//! Spawn bundled Node + Hono in release builds (after embedded env is applied).

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::brain_paths;

pub struct ServerChild(pub Mutex<Option<Child>>);

const BRAIN_LISTEN_PORT_PREFIX: &str = "BRAIN_LISTEN_PORT=";

fn parse_brain_listen_port_line(line: &str) -> Option<u16> {
    line.strip_prefix(BRAIN_LISTEN_PORT_PREFIX)
        .and_then(|rest| rest.trim().parse().ok())
}

fn resolve_home_for_child(cmd: &mut Command) -> Option<String> {
    if let Ok(h) = std::env::var("HOME") {
        return Some(h);
    }
    if let Ok(ns) = std::env::var("NSHomeDirectory") {
        cmd.env("HOME", &ns);
        return Some(ns);
    }
    None
}

/// Tauri places `bundle.resources` under `resource_dir/resources/` (see tauri-utils `resource_dir` + bundle layout).
/// `cargo run --release` → `target/release/resources/server-bundle`; `.app` → `Contents/Resources/resources/server-bundle`.
fn resolve_server_bundle_dir(resource_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        resource_dir.join("resources/server-bundle"),
        resource_dir.join("server-bundle"),
    ];
    for c in &candidates {
        if c.join("dist/server/index.js").is_file() {
            return Some(c.clone());
        }
    }
    None
}

/// Start `node dist/server/index.js` from the bundled `server-bundle/` directory.
/// Returns the port printed by Node as `BRAIN_LISTEN_PORT=<port>` (the process that owns the child).
pub fn spawn_brain_server(app: &AppHandle) -> Result<u16, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let bundle = resolve_server_bundle_dir(&resource_dir).ok_or_else(|| {
        format!(
            "server bundle not found under {} (tried resources/server-bundle and server-bundle). Run npm run build && npm run desktop:bundle-server, then rebuild/run the Tauri binary.",
            resource_dir.display()
        )
    })?;

    let node_exe = bundle.join("node");
    let node_path: PathBuf = if node_exe.is_file() {
        node_exe
    } else {
        PathBuf::from("node")
    };

    let mut cmd = Command::new(&node_path);
    cmd.current_dir(&bundle)
        .arg("dist/server/index.js")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NODE_ENV", "production")
        .env("BRAIN_BUNDLED_NATIVE", "1");

    // ripmail is bundled alongside node in server-bundle/. Always set the absolute path when
    // present (do not skip when the parent process has RIPMAIL_BIN= or a bare name — GUI apps
    // often inherit a broken value). `RIPMAIL_BIN` on the Command overrides the parent env.
    let bundled_rm = bundle.join("ripmail");
    if bundled_rm.is_file() {
        log::info!(
            "Braintunnel bundled server: RIPMAIL_BIN={}",
            bundled_rm.display()
        );
        cmd.env("RIPMAIL_BIN", bundled_rm.as_os_str());
    } else {
        log::warn!(
            "Braintunnel bundled server: bundled ripmail not found at {} — inbox will fail; rebuild with `npm run desktop:bundle-server` then `tauri build`",
            bundled_rm.display()
        );
    }

    if let Some(ref home) = resolve_home_for_child(&mut cmd) {
        brain_paths::ensure_dirs_and_apply_defaults(&mut cmd, home);
        log::info!(
            "Braintunnel bundled server: HOME={} (default BRAIN_HOME / RIPMAIL_HOME applied when unset)",
            home
        );
    } else {
        log::warn!(
            "Braintunnel bundled server: HOME unset — set BRAIN_HOME and RIPMAIL_HOME in the environment"
        );
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn node: {e}"))?;

    let log_path: Option<PathBuf> = match app.path().app_log_dir() {
        Ok(dir) => {
            let _ = std::fs::create_dir_all(&dir);
            let p = dir.join("node-server.log");
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p) {
                let _ = writeln!(
                    f,
                    "\n--- Braintunnel Hono server {:?} ---\n",
                    std::time::SystemTime::now()
                );
            }
            Some(p)
        }
        Err(e) => {
            eprintln!("brain: could not resolve app_log_dir: {e}");
            None
        }
    };

    fn drain_pipe(mut pipe: impl std::io::Read + Send + 'static, log_path: Option<PathBuf>) {
        thread::spawn(move || match log_path {
            Some(p) => {
                if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p) {
                    let _ = std::io::copy(&mut pipe, &mut f);
                } else {
                    let _ = std::io::copy(&mut pipe, &mut std::io::sink());
                }
            }
            None => {
                let _ = std::io::copy(&mut pipe, &mut std::io::sink());
            }
        });
    }

    // Append stdout/stderr to app log so `ripmail setup` and Hono logs are visible (not discarded).
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "spawn node: missing stdout pipe".to_string())?;
    if let Some(err) = child.stderr.take() {
        drain_pipe(err, log_path.clone());
    }

    let (tx, rx) = mpsc::channel::<Result<u16, String>>();
    let log_path_out = log_path.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut file = log_path_out
            .as_ref()
            .and_then(|p| OpenOptions::new().create(true).append(true).open(p).ok());
        let mut sent = false;
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    if let Some(port) = parse_brain_listen_port_line(&line) {
                        if !sent {
                            let _ = tx.send(Ok(port));
                            sent = true;
                        }
                    }
                    if let Some(ref mut f) = file {
                        let _ = f.write_all(line.as_bytes());
                    }
                }
                Err(e) => {
                    if !sent {
                        let _ = tx.send(Err(format!("read node stdout: {e}")));
                    }
                    break;
                }
            }
        }
        if !sent {
            let _ = tx.send(Err(
                "node did not print BRAIN_LISTEN_PORT=<port> to stdout (bundled server failed to bind?)"
                    .into(),
            ));
        }
    });

    let port = match rx.recv_timeout(Duration::from_secs(45)) {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => {
            let _ = child.kill();
            return Err(e);
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            return Err(
                "timed out waiting for BRAIN_LISTEN_PORT from bundled Node (check app logs)".into(),
            );
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let _ = child.kill();
            return Err("stdout reader disconnected before BRAIN_LISTEN_PORT".into());
        }
    };

    if let Some(ref p) = log_path {
        log::info!(
            "Braintunnel bundled server: Node/Hono stdout+stderr (incl. ripmail) → {}",
            p.display()
        );
    }
    log::info!(
        "Braintunnel WebView: navigate to http://127.0.0.1:{port}/ (from child BRAIN_LISTEN_PORT)"
    );
    app.manage(ServerChild(Mutex::new(Some(child))));
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::parse_brain_listen_port_line;

    #[test]
    fn parse_listen_port_line() {
        assert_eq!(
            parse_brain_listen_port_line("BRAIN_LISTEN_PORT=18474\n"),
            Some(18474)
        );
        assert_eq!(
            parse_brain_listen_port_line("BRAIN_LISTEN_PORT=18473"),
            Some(18473)
        );
        assert_eq!(parse_brain_listen_port_line("other\n"), None);
    }
}

pub fn kill_server_child(app: &AppHandle) {
    if let Some(state) = app.try_state::<ServerChild>() {
        if let Ok(mut g) = state.0.lock() {
            if let Some(mut c) = g.take() {
                let _ = c.kill();
            }
        }
    }
}
