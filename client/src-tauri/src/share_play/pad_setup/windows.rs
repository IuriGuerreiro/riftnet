use std::fs::{self, File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use ::windows::Win32::Devices::DeviceAndDriverInstallation::{
    CM_GET_DEVICE_INTERFACE_LIST_PRESENT, CM_Get_Device_Interface_List_SizeW, CR_SUCCESS,
};
use ::windows::Win32::Foundation::{ERROR_CANCELLED, ERROR_SUCCESS, HANDLE, WAIT_OBJECT_0};
use ::windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use ::windows::Win32::System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject};
use ::windows::Win32::UI::Input::XboxController::{XINPUT_STATE, XInputGetState};
use ::windows::Win32::UI::Shell::{
    SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW,
};
use ::windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use ::windows::core::{GUID, HSTRING, PCWSTR, w};
use tauri::{AppHandle, Manager, Runtime};

use super::super::pad::{BUTTON_A, BUTTON_B, Pad, PadState, Server};
use super::{DRIVER, Download, InstallResult, PadStatus, TestReport, VIIPER};

const VHCI: GUID = GUID::from_u128(0xB4030C06_DC5F_4FCC_87EB_E5515A0935C0);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const FILE_SHARE_READ: u32 = 1;
const RESTART_EXIT: u32 = 3010;
const SAMPLES: usize = 50;

fn home<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("controllers");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn driver_ready() -> bool {
    let mut len = 0;
    let found = unsafe {
        CM_Get_Device_Interface_List_SizeW(
            &mut len,
            &VHCI,
            PCWSTR::null(),
            CM_GET_DEVICE_INTERFACE_LIST_PRESENT,
        )
    };
    found == CR_SUCCESS && len > 1
}

struct Verified {
    path: PathBuf,
    _lock: File,
}

fn open_verified(dir: &Path, item: &Download) -> Result<Verified, String> {
    let path = dir.join(item.file);
    // INVARIANT: the handle stays open while the file runs, so nothing can swap it after the check.
    let lock = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&path)
        .map_err(|e| format!("{}: {e}", item.file))?;
    item.verify(&lock)?;
    Ok(Verified { path, _lock: lock })
}

fn fetch(dir: &Path, item: &Download) -> Result<Verified, String> {
    if let Ok(found) = open_verified(dir, item) {
        return Ok(found);
    }
    let part = dir.join(format!("{}.part", item.file));
    let system = std::env::var_os("SystemRoot").ok_or("Windows folder not found")?;
    let out = Command::new(Path::new(&system).join(r"System32\curl.exe"))
        .args([
            "--disable",
            "--fail",
            "--location",
            "--silent",
            "--show-error",
        ])
        .args(["--proto", "=https", "--proto-redir", "=https"])
        .args(["--connect-timeout", "20", "--max-time", "600"])
        .args(["--max-filesize", &item.size.to_string()])
        .arg("--output")
        .arg(&part)
        .arg(item.url)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("couldn't download {}: {e}", item.file))?;
    let result = if out.status.success() {
        fs::rename(&part, dir.join(item.file))
            .map_err(|e| e.to_string())
            .and_then(|()| open_verified(dir, item))
    } else {
        Err(format!(
            "couldn't download {}: {}",
            item.file,
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    };
    if result.is_err() {
        let _ = fs::remove_file(&part);
        let _ = fs::remove_file(dir.join(item.file));
    }
    result
}

fn run_elevated(exe: &Path) -> Result<Option<u32>, String> {
    let file = HSTRING::from(exe.as_os_str());
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: w!(
            "/VERYSILENT /SUPPRESSMSGBOXES /SP- /NORESTART /RESTARTEXITCODE=3010 /TYPE=compact /TASKS=vcredist"
        ),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    unsafe {
        if let Err(e) = ShellExecuteExW(&mut info) {
            return if e.code() == ERROR_CANCELLED.to_hresult() {
                Ok(None)
            } else {
                Err(format!("couldn't start the driver installer: {e}"))
            };
        }
        if info.hProcess.is_invalid() {
            return Err("the driver installer didn't start".into());
        }
        let process = OwnedHandle::from_raw_handle(info.hProcess.0);
        let handle = HANDLE(process.as_raw_handle());
        if WaitForSingleObject(handle, INFINITE) != WAIT_OBJECT_0 {
            return Err("lost track of the driver installer".into());
        }
        let mut code = 0;
        GetExitCodeProcess(handle, &mut code).map_err(|e| e.to_string())?;
        Ok(Some(code))
    }
}

pub fn status<R: Runtime>(app: &AppHandle<R>) -> Result<PadStatus, String> {
    let dir = home(app)?;
    Ok(PadStatus {
        supported: true,
        driver: driver_ready(),
        helper: open_verified(&dir, &VIIPER).is_ok(),
    })
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<InstallResult, String> {
    let dir = home(app)?;
    fetch(&dir, &VIIPER)?;
    if driver_ready() {
        return Ok(InstallResult::Ready);
    }
    let setup = fetch(&dir, &DRIVER)?;
    let Some(code) = run_elevated(&setup.path)? else {
        return Ok(InstallResult::Declined);
    };
    if code != 0 && code != RESTART_EXIT {
        return Err(format!("the driver installer failed (code {code})"));
    }
    let path = setup.path.clone();
    drop(setup);
    let _ = fs::remove_file(path);
    let deadline = Instant::now() + Duration::from_secs(10);
    while !driver_ready() {
        if Instant::now() > deadline {
            return Ok(InstallResult::RestartNeeded);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Ok(InstallResult::Ready)
}

struct Running {
    server: Server,
    _job: OwnedHandle,
    _exe: Verified,
}

fn start<R: Runtime>(app: &AppHandle<R>) -> Result<Running, String> {
    let dir = home(app)?;
    let exe = open_verified(&dir, &VIIPER)?;
    let job = unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).map_err(|e| e.to_string())?;
        let owned = OwnedHandle::from_raw_handle(job.0);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            size_of_val(&limits) as u32,
        )
        .map_err(|e| e.to_string())?;
        owned
    };
    let server = Server::start(&exe.path, &dir, true, |cmd| {
        cmd.creation_flags(CREATE_NO_WINDOW);
    })?;
    unsafe {
        AssignProcessToJobObject(
            HANDLE(job.as_raw_handle()),
            HANDLE(server.child().as_raw_handle()),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(Running {
        server,
        _job: job,
        _exe: exe,
    })
}

fn read(slot: u32) -> Option<XINPUT_STATE> {
    let mut state = XINPUT_STATE::default();
    (unsafe { XInputGetState(slot, &mut state) } == ERROR_SUCCESS.0).then_some(state)
}

fn connected() -> Vec<u32> {
    (0..4).filter(|s| read(*s).is_some()).collect()
}

fn wait(limit: Duration, mut done: impl FnMut() -> bool) -> bool {
    let end = Instant::now() + limit;
    while !done() {
        if Instant::now() > end {
            return false;
        }
        std::thread::yield_now();
    }
    true
}

fn plug(server: &Server) -> Result<(Pad, u32), String> {
    let before = connected();
    let mut pad = server.plug()?;
    pad.set(PadState::default())?;
    let mut slot = None;
    let mut next_check = Instant::now();
    wait(Duration::from_secs(15), || {
        if Instant::now() < next_check {
            std::thread::sleep(Duration::from_millis(10));
            return false;
        }
        next_check = Instant::now() + Duration::from_millis(50);
        slot = connected().into_iter().find(|s| !before.contains(s));
        slot.is_some()
    });
    let slot = slot.ok_or("Windows didn't detect the virtual controller")?;
    Ok((pad, slot))
}

fn buttons(slot: u32) -> Option<u16> {
    read(slot).map(|s| s.Gamepad.wButtons.0)
}

fn press(pad: &mut Pad, slot: u32, mask: u16) -> Result<f64, String> {
    let sent = Instant::now();
    pad.set(PadState {
        buttons: mask,
        ..PadState::default()
    })?;
    if !wait(Duration::from_millis(500), || buttons(slot) == Some(mask)) {
        return Err("a virtual controller didn't respond".into());
    }
    Ok(sent.elapsed().as_secs_f64() * 1000.0)
}

pub fn test<R: Runtime>(app: &AppHandle<R>) -> Result<TestReport, String> {
    let free = 4 - connected().len();
    if free < 2 {
        return Err(format!(
            "The test needs 2 free controller slots, but only {free} are free"
        ));
    }
    let Running { server, _job, _exe } = start(app)?;
    let (mut a, slot_a) = plug(&server)?;
    let (mut b, slot_b) = plug(&server)?;
    let mut times = Vec::with_capacity(SAMPLES * 2);
    for _ in 0..SAMPLES {
        times.push(press(&mut a, slot_a, BUTTON_A)?);
        if buttons(slot_b) != Some(0) {
            return Err("one controller's input reached another".into());
        }
        times.push(press(&mut b, slot_b, BUTTON_B)?);
        press(&mut a, slot_a, 0)?;
        if buttons(slot_b) != Some(BUTTON_B) {
            return Err("releasing one controller released another".into());
        }
        press(&mut b, slot_b, 0)?;
    }
    press(&mut a, slot_a, BUTTON_A)?;
    press(&mut b, slot_b, BUTTON_B)?;
    drop(b);
    if !wait(Duration::from_secs(10), || buttons(slot_b).is_none()) {
        return Err("a removed controller stayed connected".into());
    }
    if buttons(slot_a) != Some(BUTTON_A) {
        return Err("removing one controller affected another".into());
    }
    drop(server);
    if !wait(Duration::from_secs(10), || buttons(slot_a).is_none()) {
        return Err("a controller stayed connected after VIIPER stopped".into());
    }
    times.sort_by(f64::total_cmp);
    Ok(TestReport {
        slots: vec![slot_a, slot_b],
        median_ms: times[times.len() / 2],
        worst_ms: times[times.len() - 1],
    })
}
