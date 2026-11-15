#[tauri::command]
fn core_ping() -> Vec<u8> {
    client_core::encode_ping(1)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core_ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
