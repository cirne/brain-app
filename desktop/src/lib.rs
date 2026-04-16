mod brain_paths;
mod embedded;
mod fda;
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
    let context = tauri::generate_context!();

    let app = tauri::Builder::default()
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
            if cfg!(debug_assertions) {
                return Ok(());
            }
            crate::embedded::apply_embedded_env()?;
            crate::server_spawn::spawn_brain_server(app.handle())?;
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
