use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Default)]
pub struct VoiceShortcut(Mutex<Option<String>>);

#[tauri::command]
pub fn voice_shortcut<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, VoiceShortcut>,
    key: Option<String>,
) -> Result<(), String> {
    if let Some(key) = &key
        && !matches!(key.as_str(), "F6" | "F7" | "F8" | "F9" | "F10")
    {
        return Err("Unsupported push-to-talk key".into());
    }
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    if *current == key {
        return Ok(());
    }
    let shortcuts = app.global_shortcut();
    if let Some(old) = current.as_deref() {
        shortcuts.unregister(old).map_err(|e| e.to_string())?;
        *current = None;
    }
    if let Some(key) = key {
        shortcuts
            .on_shortcut(key.as_str(), |app, shortcut, event| {
                let _ = app.emit(
                    "voice://push-to-talk",
                    (shortcut.to_string(), event.state == ShortcutState::Pressed),
                );
            })
            .map_err(|e| e.to_string())?;
        *current = Some(key);
    }
    Ok(())
}
