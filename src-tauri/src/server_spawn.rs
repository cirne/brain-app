//! Spawn bundled Node + Hono in release builds (after embedded env is applied).

use std::fs::OpenOptions;
use std::io::Write;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::brain_paths;

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

/// Start `node dist/server/index.js` from `Resources/server-bundle/`.
pub fn spawn_brain_server(app: &AppHandle) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let bundle = resource_dir.join("server-bundle");
    let dist_server = bundle.join("dist/server/index.js");
    if !dist_server.is_file() {
        return Err(format!(
            "server bundle missing at {} (run npm run build && npm run tauri:bundle-server before tauri build)",
            bundle.display()
        ));
    }

    let node_exe = bundle.join("node");
    let node_path: PathBuf = if node_exe.is_file() {
        node_exe
    } else {
        PathBuf::from("node")
    };

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let macos_dir = exe.parent().ok_or("no parent for executable")?;
    let triple = if cfg!(target_arch = "aarch64") {
        "aarch64-apple-darwin"
    } else {
        "x86_64-apple-darwin"
    };
    let ripmail = macos_dir.join(format!("ripmail-{triple}"));

    let mut cmd = Command::new(&node_path);
    cmd.current_dir(&bundle)
        .arg("dist/server/index.js")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NODE_ENV", "production")
        .env("PORT", "3000")
        .env("AUTH_DISABLED", "true");

    if ripmail.is_file() {
        cmd.env("RIPMAIL_BIN", ripmail.to_string_lossy().as_ref());
    }

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
        thread::spawn(move || {
            match log_path {
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
        if TcpStream::connect("127.0.0.1:3000").is_ok() {
            if let Some(ref p) = log_path {
                log::info!(
                    "Brain bundled server: Node/Hono stdout+stderr (incl. ripmail) → {}",
                    p.display()
                );
            }
            app.manage(ServerChild(Mutex::new(Some(child))));
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }

    let _ = child.kill();
    Err("Hono server did not listen on 127.0.0.1:3000 in time".into())
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
