use std::fs;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use ::windows::Win32::Devices::DeviceAndDriverInstallation::{
    DICD_GENERATE_ID, DIF_REGISTERDEVICE, DIF_REMOVE, GUID_DEVCLASS_SYSTEM, HDEVINFO,
    INSTALLFLAG_NONINTERACTIVE, SP_DEVINFO_DATA, SPDRP_HARDWAREID, SetupDiCallClassInstaller,
    SetupDiCreateDeviceInfoList, SetupDiCreateDeviceInfoW, SetupDiDestroyDeviceInfoList,
    SetupDiSetDeviceRegistryPropertyW, UpdateDriverForPlugAndPlayDevicesW,
};
use ::windows::Win32::Foundation::{ERROR_CANCELLED, ERROR_SUCCESS, HANDLE, WAIT_OBJECT_0};
use ::windows::Win32::System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject};
use ::windows::Win32::UI::Input::XboxController::{XINPUT_STATE, XInputGetState};
use ::windows::Win32::UI::Shell::{
    SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW,
};
use ::windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use ::windows::core::{BOOL, HSTRING, PCWSTR, w};

use super::super::pad::{BUTTON_A, BUTTON_B, Bus, Pad, PadState};
use super::{InstallResult, PadStatus, TestReport};

pub const HELPER_ARG: &str = "--install-controller-driver";
const HARDWARE_ID: &str = r"Nefarius\ViGEmBus\Gen1";
const DRIVER_FILES: [(&str, &[u8]); 3] = [
    (
        "ViGEmBus.inf",
        include_bytes!("../../../drivers/vigembus/ViGEmBus.inf"),
    ),
    (
        "ViGEmBus.sys",
        include_bytes!("../../../drivers/vigembus/ViGEmBus.sys"),
    ),
    (
        "ViGEmBus.cat",
        include_bytes!("../../../drivers/vigembus/vigembus.cat"),
    ),
];
const RESTART_EXIT: u32 = 3010;
const NO_SUCH_DEVICE: u32 = 0xE000_020B;
const SAMPLES: usize = 50;

fn driver_ready() -> bool {
    matches!(Bus::connect(), Ok(Some(_)))
}

fn run_elevated() -> Result<Option<u32>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let file = HSTRING::from(exe.as_os_str());
    let params = HSTRING::from(HELPER_ARG);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
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

struct Folder(PathBuf);

impl Folder {
    fn unpack() -> Result<Self, String> {
        let root = std::env::var_os("SystemRoot").ok_or("Windows folder not found")?;
        let path = Path::new(&root)
            .join("Temp")
            .join(format!("adept-vigembus-{}", std::process::id()));
        // INVARIANT: create_dir fails on an existing folder, so nobody can plant one beforehand.
        fs::create_dir(&path).map_err(|e| e.to_string())?;
        let folder = Self(path);
        for (name, bytes) in DRIVER_FILES {
            fs::write(folder.0.join(name), bytes).map_err(|e| e.to_string())?;
        }
        Ok(folder)
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct Device {
    list: HDEVINFO,
    data: SP_DEVINFO_DATA,
}

impl Device {
    fn create(id: &HSTRING) -> ::windows::core::Result<Self> {
        unsafe {
            let list = SetupDiCreateDeviceInfoList(Some(&GUID_DEVCLASS_SYSTEM), None)?;
            let mut device = Self {
                list,
                data: SP_DEVINFO_DATA {
                    cbSize: size_of::<SP_DEVINFO_DATA>() as u32,
                    ..Default::default()
                },
            };
            SetupDiCreateDeviceInfoW(
                list,
                w!("System"),
                &GUID_DEVCLASS_SYSTEM,
                PCWSTR::null(),
                None,
                DICD_GENERATE_ID,
                Some(&mut device.data),
            )?;
            let ids: Vec<u8> = id
                .iter()
                .copied()
                .chain([0, 0])
                .flat_map(u16::to_le_bytes)
                .collect();
            SetupDiSetDeviceRegistryPropertyW(
                list,
                &mut device.data,
                SPDRP_HARDWAREID,
                Some(&ids),
            )?;
            SetupDiCallClassInstaller(DIF_REGISTERDEVICE, list, Some(&device.data))?;
            Ok(device)
        }
    }

    fn remove(&self) {
        unsafe {
            let _ = SetupDiCallClassInstaller(DIF_REMOVE, self.list, Some(&self.data));
        }
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        unsafe {
            let _ = SetupDiDestroyDeviceInfoList(self.list);
        }
    }
}

fn update(id: &HSTRING, inf: &HSTRING) -> ::windows::core::Result<bool> {
    let mut restart = BOOL(0);
    unsafe {
        UpdateDriverForPlugAndPlayDevicesW(
            None,
            id,
            inf,
            INSTALLFLAG_NONINTERACTIVE,
            Some(&mut restart),
        )?;
    }
    Ok(restart.as_bool())
}

fn install_files() -> Result<bool, u32> {
    let code = |e: ::windows::core::Error| e.code().0 as u32;
    let folder = Folder::unpack().map_err(|_| 1u32)?;
    let inf = HSTRING::from(folder.0.join("ViGEmBus.inf").as_os_str());
    let id = HSTRING::from(HARDWARE_ID);
    match update(&id, &inf) {
        Err(e) if e.code().0 as u32 == NO_SUCH_DEVICE => {}
        other => return other.map_err(code),
    }
    let device = Device::create(&id).map_err(code)?;
    update(&id, &inf).map_err(|e| {
        device.remove();
        code(e)
    })
}

pub fn install_elevated() -> u32 {
    match install_files() {
        Ok(false) => 0,
        Ok(true) => RESTART_EXIT,
        Err(code) => code,
    }
}

pub fn status() -> Result<PadStatus, String> {
    Ok(PadStatus {
        supported: true,
        driver: Bus::connect()?.is_some(),
    })
}

pub fn install() -> Result<InstallResult, String> {
    if driver_ready() {
        return Ok(InstallResult::Ready);
    }
    let Some(code) = run_elevated()? else {
        return Ok(InstallResult::Declined);
    };
    if code != 0 && code != RESTART_EXIT {
        return Err(format!(
            "Windows couldn't install the driver (0x{code:08X})"
        ));
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    while !driver_ready() {
        if Instant::now() > deadline {
            return Ok(InstallResult::RestartNeeded);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Ok(InstallResult::Ready)
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

fn set(pad: &mut Pad, mask: u16) -> Result<(), String> {
    pad.set(PadState {
        buttons: mask,
        ..PadState::default()
    })
    .map_err(|e| format!("virtual controller input: {e}"))
}

fn plug(bus: &Bus) -> Result<(Pad, u32), String> {
    let before = connected();
    let mut pad = bus.plug()?;
    set(&mut pad, 0)?;
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
    set(pad, mask)?;
    if !wait(Duration::from_millis(500), || buttons(slot) == Some(mask)) {
        return Err("a virtual controller didn't respond".into());
    }
    Ok(sent.elapsed().as_secs_f64() * 1000.0)
}

pub fn test() -> Result<TestReport, String> {
    let free = 4 - connected().len();
    if free < 2 {
        return Err(format!(
            "The test needs 2 free controller slots, but only {free} are free"
        ));
    }
    let bus = Bus::connect()?.ok_or("ViGEmBus isn't installed")?;
    let (mut a, slot_a) = plug(&bus)?;
    let (mut b, slot_b) = plug(&bus)?;
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
    drop(a);
    if !wait(Duration::from_secs(10), || buttons(slot_a).is_none()) {
        return Err("a removed controller stayed connected".into());
    }
    times.sort_by(f64::total_cmp);
    Ok(TestReport {
        slots: vec![slot_a, slot_b],
        median_ms: times[times.len() / 2],
        worst_ms: times[times.len() - 1],
    })
}
