mod brain_paths;
mod embedded;
mod fda;
mod native_port;
mod server_spawn;

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
    use tauri::Manager;
    use tauri::Url;

    let context = tauri::generate_context!();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![check_fda, open_fda_settings])
        .setup(|app| {
            // Needed in release too: otherwise `log::info!` from Rust is dropped and users see nothing in log stream.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            #[cfg(target_os = "macos")]
            crate::fda::log_probe_diagnostics();
            // Dev: no bundled Node child — the webview must load the same URL as `npm run dev`
            // (`build.devUrl` / PORT, default :3000). That comes from `windows[].url` in tauri.conf.json;
            // we do not call `navigate` here in debug (see release branch below).
            if cfg!(debug_assertions) {
                return Ok(());
            }
            crate::embedded::apply_embedded_env()?;
            let port = crate::server_spawn::spawn_brain_server(app.handle())?;
            // Bundled Node uses HTTP for now (TLS optional later; see OPP-036).
            let url =
                Url::parse(&format!("http://127.0.0.1:{port}/")).map_err(|e| e.to_string())?;
            if let Some(w) = app.handle().get_webview_window("main") {
                w.navigate(url).map_err(|e| e.to_string())?;
            } else {
                log::warn!(
                    "Braintunnel: main webview not found; could not navigate to bundled server URL"
                );
            }
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            crate::server_spawn::kill_server_child(app_handle);
        }
    });
}
