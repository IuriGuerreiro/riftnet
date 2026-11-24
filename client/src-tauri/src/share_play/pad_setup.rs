use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Runtime, State};

#[cfg(windows)]
mod windows;

#[cfg(any(windows, test))]
struct Download {
    file: &'static str,
    url: &'static str,
    sha256: &'static str,
    size: u64,
}

#[cfg(any(windows, test))]
const DRIVER: Download = Download {
    file: "USBip-0.9.8.1-x64.exe",
    url: "https://github.com/vadimgrn/usbip-win2/releases/download/v.0.9.8.1/USBip-0.9.8.1-x64.exe",
    sha256: "38cad6d4432b52d5bb9409d9ad03b72fdffc4ada4cd3a48fbeca1a2752a8518a",
    size: 26_083_632,
};

#[cfg(any(windows, test))]
const VIIPER: Download = Download {
    file: "viiper-0.9.0.exe",
    url: "https://github.com/Alia5/VIIPER/releases/download/v0.9.0/viiper-windows-amd64.exe",
    sha256: "142c144f6abee8b8a5f6a1abbc7018683444de71d2e45102cde6aaab9b2223e6",
    size: 13_536_584,
};

#[cfg(any(windows, test))]
impl Download {
    fn verify(&self, mut from: impl std::io::Read) -> Result<(), String> {
        use sha2::Digest;
        let mut hash = sha2::Sha256::new();
        std::io::copy(&mut from, &mut hash).map_err(|e| e.to_string())?;
        if format!("{:x}", hash.finalize()) == self.sha256 {
            Ok(())
        } else {
            Err(format!("{} failed its safety check", self.file))
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
    helper: bool,
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
pub async fn pad_status<R: Runtime>(app: AppHandle<R>) -> Result<PadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        return windows::status(&app);
        #[cfg(not(windows))]
        {
            drop(app);
            Ok(PadStatus {
                supported: false,
                driver: false,
                helper: false,
            })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pad_install<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PadSetup>,
) -> Result<InstallResult, String> {
    let busy = state.begin()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = busy;
        #[cfg(windows)]
        return windows::install(&app);
        #[cfg(not(windows))]
        {
            drop(app);
            Err("Controller mode needs Windows".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pad_test<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PadSetup>,
) -> Result<TestReport, String> {
    let busy = state.begin()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = busy;
        #[cfg(windows)]
        return windows::test(&app);
        #[cfg(not(windows))]
        {
            drop(app);
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
    fn downloads_are_pinned_to_official_releases() {
        for d in [DRIVER, VIIPER] {
            assert!(d.url.starts_with("https://github.com/"), "{}", d.url);
            assert!(d.url.contains("/releases/download/v"), "{}", d.url);
            assert_eq!(d.sha256.len(), 64);
            assert!(d.size > 0);
        }
    }

    #[test]
    fn changed_files_are_refused() {
        let expected = Download {
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            ..DRIVER
        };
        assert!(expected.verify(&b"hello"[..]).is_ok());
        assert!(expected.verify(&b"hello!"[..]).is_err());
    }

    #[test]
    fn only_one_setup_runs_at_a_time() {
        let setup = PadSetup::default();
        let first = setup.begin().unwrap();
        assert!(setup.begin().is_err());
        drop(first);
        assert!(setup.begin().is_ok());
    }
}
