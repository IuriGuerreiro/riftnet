mod share_play;

use tauri::Manager;

#[tauri::command]
fn core_ping() -> Vec<u8> {
    client_core::encode_ping(1)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            app.manage(share_play::SharePlay::start(app.handle().clone()));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_ping,
            share_play::share_play_supported,
            share_play::share_play_monitors,
            share_play::share_play_approve,
            share_play::share_play_arm,
            share_play::share_play_revoke,
            share_play::share_play_input,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
