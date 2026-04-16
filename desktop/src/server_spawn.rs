//! Spawn bundled Node + Hono in release builds (after embedded env is applied).

use std::fs::OpenOptions;
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::brain_paths;
use crate::native_port;

pub struct ServerChild(pub Mutex<Option<Child>>);

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
/// Returns the TCP port the server accepted (same sequence as `native_port::native_port_candidates`).
pub fn spawn_brain_server(app: &AppHandle) -> Result<u16, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let bundle = resolve_server_bundle_dir(&resource_dir).ok_or_else(|| {
        format!(
            "server bundle not found under {} (tried resources/server-bundle and server-bundle). Run npm run build && npm run tauri:bundle-server, then rebuild/run the Tauri binary.",
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
        .env("BRAIN_BUNDLED_NATIVE", "1")
        .env("AUTH_DISABLED", "true");

    log::info!(
        "Brain bundled server: RIPMAIL_BIN not set by shell — inbox uses `ripmail` on PATH or set RIPMAIL_BIN (e.g. after `npm run ripmail:dev`)"
    );

    if let Some(ref home) = resolve_home_for_child(&mut cmd) {
        brain_paths::ensure_dirs_and_apply_defaults(&mut cmd, home);
        log::info!(
            "Brain bundled server: HOME={} (default WIKI_DIR / CHAT_DATA_DIR / RIPMAIL_HOME applied when unset)",
            home
        );
    } else {
        log::warn!("Brain bundled server: HOME unset — WIKI_DIR may fall back to /wiki; set WIKI_DIR / CHAT_DATA_DIR / RIPMAIL_HOME in the environment");
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn node: {e}"))?;

    let log_path: Option<PathBuf> = match app.path().app_log_dir() {
        Ok(dir) => {
            let _ = std::fs::create_dir_all(&dir);
            let p = dir.join("node-server.log");
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p) {
                let _ = writeln!(
                    f,
                    "\n--- Brain Hono server {:?} ---\n",
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
    if let Some(out) = child.stdout.take() {
        drain_pipe(out, log_path.clone());
    }
    if let Some(err) = child.stderr.take() {
        drain_pipe(err, log_path.clone());
    }

    for _ in 0..120 {
        for port in native_port::native_port_candidates() {
            if TcpStream::connect(format!("127.0.0.1:{port}")).is_ok() {
                if let Some(ref p) = log_path {
                    log::info!(
                        "Brain bundled server: Node/Hono stdout+stderr (incl. ripmail) → {}",
                        p.display()
                    );
                }
                log::info!("Brain bundled server listening on 127.0.0.1:{port}");
                app.manage(ServerChild(Mutex::new(Some(child))));
                return Ok(port);
            }
        }
        thread::sleep(Duration::from_millis(250));
    }

    let _ = child.kill();
    Err(format!(
        "Hono server did not listen on 127.0.0.1 in native port range {}–{} (skip {}) in time",
        native_port::NATIVE_APP_PORT_START,
        native_port::NATIVE_APP_PORT_END,
        native_port::NATIVE_APP_PORT_SKIP
    ))
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
