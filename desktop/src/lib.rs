mod bridge;
mod fda;
mod native_port;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use bridge::keychain::{clear_device_token, load_device_token, save_device_token};
use bridge::scheduler::{start_bridge_scheduler, BridgeConfig, BridgeSchedulerHandle};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, Url};

struct BridgeAppState {
    origin: String,
    scheduler: Mutex<Option<BridgeSchedulerHandle>>,
}

fn target_origin() -> String {
    if let Ok(origin) = std::env::var("BRAIN_WEB_ORIGIN") {
        let trimmed = origin.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if cfg!(debug_assertions) {
        "http://localhost:3000".to_string()
    } else {
        "https://staging.braintunnel.ai".to_string()
    }
}

fn bridge_device_id() -> String {
    if let Ok(id) = std::env::var("BRAIN_BRIDGE_DEVICE_ID") {
        let t = id.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    "mac-default".to_string()
}

fn imessage_db_path() -> PathBuf {
    if let Ok(path) = std::env::var("IMESSAGE_DB_PATH") {
        if !path.trim().is_empty() {
            return PathBuf::from(path);
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home)
        .join("Library")
        .join("Messages")
        .join("chat.db")
}

fn make_bridge_config(origin: String) -> BridgeConfig {
    BridgeConfig {
        chat_db_path: imessage_db_path(),
        cloud_origin: origin,
        device_id: bridge_device_id(),
        poll_interval: Duration::from_secs(300),
        batch_size: 500,
        recent_rescan_days: 3,
    }
}

fn current_scheduler(app: &tauri::AppHandle) -> Option<BridgeSchedulerHandle> {
    let state = app.state::<BridgeAppState>();
    let scheduler = state
        .scheduler
        .lock()
        .expect("bridge scheduler mutex poisoned")
        .clone();
    scheduler
}

fn set_scheduler(app: &tauri::AppHandle, handle: Option<BridgeSchedulerHandle>) {
    let state = app.state::<BridgeAppState>();
    let mut guard = state
        .scheduler
        .lock()
        .expect("bridge scheduler mutex poisoned");
    *guard = handle;
}

fn start_scheduler_if_possible(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        if current_scheduler(app).is_some() {
            return Ok(());
        }
        let Some(token) = load_device_token().map_err(|e| e.to_string())? else {
            log::info!("bridge scheduler: no device token in keychain; idle");
            return Ok(());
        };
        let cfg = make_bridge_config(app.state::<BridgeAppState>().origin.clone());
        let handle = start_bridge_scheduler(cfg, token).map_err(|e| e.to_string())?;
        set_scheduler(app, Some(handle));
        Ok(())
    }
}

#[tauri::command]
fn set_bridge_device_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("Device token cannot be empty".to_string());
    }
    save_device_token(trimmed).map_err(|e| e.to_string())?;
    start_scheduler_if_possible(&app)?;
    Ok(())
}

#[tauri::command]
fn clear_bridge_device_token(app: tauri::AppHandle) -> Result<(), String> {
    clear_device_token().map_err(|e| e.to_string())?;
    if let Some(handle) = current_scheduler(&app) {
        tauri::async_runtime::spawn(async move {
            let _ = handle.shutdown().await;
        });
    }
    set_scheduler(&app, None);
    Ok(())
}

#[tauri::command]
async fn bridge_sync_now(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(handle) = current_scheduler(&app) {
        handle.sync_now().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn check_fda() -> bool {
    crate::fda::is_fda_granted()
}

#[tauri::command]
fn open_fda_settings() {
    crate::fda::open_fda_system_settings();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let origin = target_origin();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            check_fda,
            open_fda_settings,
            set_bridge_device_token,
            clear_bridge_device_token,
            bridge_sync_now
        ])
        .setup(move |app| {
            // Needed in release too: otherwise `log::info!` from Rust is dropped and users see nothing in log stream.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            #[cfg(target_os = "macos")]
            crate::fda::log_probe_diagnostics();
            app.manage(BridgeAppState {
                origin: origin.clone(),
                scheduler: Mutex::new(None),
            });

            let tray_menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "sync_now", "Sync now", true, None::<&str>)?,
                    &MenuItem::with_id(
                        app,
                        "pause_sync",
                        "Pause / resume sync",
                        true,
                        None::<&str>,
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        "open_braintunnel",
                        "Open Braintunnel",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(app, "open_settings", "Settings…", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
                ],
            )?;
            let app_handle = app.handle().clone();
            TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event: tauri::menu::MenuEvent| {
                    let id = event.id().as_ref();
                    match id {
                        "sync_now" => {
                            if let Some(handle) = current_scheduler(app) {
                                tauri::async_runtime::spawn(async move {
                                    let _ = handle.sync_now().await;
                                });
                            }
                        }
                        "pause_sync" => {
                            if let Some(handle) = current_scheduler(app) {
                                let next = !handle.status().paused;
                                tauri::async_runtime::spawn(async move {
                                    let _ = handle.set_paused(next).await;
                                });
                            }
                        }
                        "open_braintunnel" => {
                            let url = app.state::<BridgeAppState>().origin.clone();
                            #[cfg(target_os = "macos")]
                            {
                                let _ = std::process::Command::new("open").arg(url).spawn();
                            }
                            #[cfg(not(target_os = "macos"))]
                            {
                                let _ = std::process::Command::new("xdg-open").arg(url).spawn();
                            }
                        }
                        "open_settings" => {
                            let settings_url = format!(
                                "{}/hub#devices",
                                app.state::<BridgeAppState>().origin.trim_end_matches('/')
                            );
                            if let Ok(url) = Url::parse(&settings_url) {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.navigate(url);
                                }
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            start_scheduler_if_possible(&app_handle)?;
            #[cfg(target_os = "macos")]
            {
                let _ = crate::bridge::contacts::request_contacts_access();
            }

            let url = Url::parse(&origin).map_err(|e| e.to_string())?;
            if let Some(w) = app.handle().get_webview_window("main") {
                w.navigate(url).map_err(|e| e.to_string())?;
            } else {
                log::warn!("Braintunnel: main webview not found; could not navigate");
            }
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(handle) = current_scheduler(app_handle) {
                tauri::async_runtime::spawn(async move {
                    let _ = handle.shutdown().await;
                });
            }
        }
    });
}
