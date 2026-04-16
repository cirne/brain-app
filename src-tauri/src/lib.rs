mod brain_paths;
mod embedded;
mod server_spawn;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Needed in release too: otherwise `log::info!` from Rust is dropped and users see nothing in log stream.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
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
