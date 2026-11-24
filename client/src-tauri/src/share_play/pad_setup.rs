use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::State;

#[cfg(windows)]
mod windows;

pub fn run_install_helper() {
    #[cfg(windows)]
    {
        if std::env::args_os()
            .nth(1)
            .is_some_and(|a| a == windows::HELPER_ARG)
        {
            std::process::exit(windows::install_elevated() as i32);
        }
    }
}

#[derive(Default)]
pub struct PadSetup {
    busy: Arc<AtomicBool>,
}

struct Busy(Arc<AtomicBool>);

impl PadSetup {
    fn begin(&self) -> Result<Busy, String> {
        if self.busy.swap(true, Ordering::AcqRel) {
            return Err("Controller setup is already running".into());
        }
        Ok(Busy(self.busy.clone()))
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(serde::Serialize)]
pub struct PadStatus {
    supported: bool,
    driver: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallResult {
    Ready,
    Declined,
    RestartNeeded,
}

#[derive(serde::Serialize)]
pub struct TestReport {
    slots: Vec<u32>,
    median_ms: f64,
    worst_ms: f64,
}

#[tauri::command]
pub async fn pad_status() -> Result<PadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        return windows::status();
        #[cfg(not(windows))]
        {
            Ok(PadStatus {
                supported: false,
                driver: false,
            })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pad_install(state: State<'_, PadSetup>) -> Result<InstallResult, String> {
    let busy = state.begin()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = busy;
        #[cfg(windows)]
        return windows::install();
        #[cfg(not(windows))]
        {
            Err("Controller mode needs Windows".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pad_test(state: State<'_, PadSetup>) -> Result<TestReport, String> {
    let busy = state.begin()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = busy;
        #[cfg(windows)]
        return windows::test();
        #[cfg(not(windows))]
        {
            Err("Controller mode needs Windows".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_setup_runs_at_a_time() {
        let setup = PadSetup::default();
        let first = setup.begin().unwrap();
        assert!(setup.begin().is_err());
        drop(first);
        assert!(setup.begin().is_ok());
    }
}
