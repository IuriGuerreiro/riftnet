use std::cell::OnceCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::{self, JoinHandle};

use ::windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use ::windows::Win32::System::Threading::GetCurrentThreadId;
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_MOVE, MOUSEEVENTF_VIRTUALDESK,
    MOUSEINPUT, SendInput,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, GetSystemMetrics, HC_ACTION, LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT,
    PM_NOREMOVE, PeekMessageW, PostThreadMessageW, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SetWindowsHookExW, UnhookWindowsHookEx, WH_MOUSE_LL,
    WM_QUIT,
};

pub const SHARE_PLAY_INPUT_MARKER: usize = 0x5350_4C59;

thread_local! {
    static HOST_MOUSE_ACTIVE: OnceCell<Arc<AtomicBool>> = const { OnceCell::new() };
}

pub struct HostMouse {
    active: Arc<AtomicBool>,
    thread_id: u32,
    thread: JoinHandle<()>,
}

impl HostMouse {
    pub fn new() -> Result<Self, String> {
        let active = Arc::new(AtomicBool::new(false));
        let flag = active.clone();
        let (ready, started) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("share-play-host-mouse".into())
            .spawn(move || {
                HOST_MOUSE_ACTIVE.with(|slot| {
                    let _ = slot.set(flag);
                });
                // SAFETY: the hook and thread message queue stay on this thread.
                unsafe {
                    let mut msg = MSG::default();
                    let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
                    let hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0) {
                        Ok(hook) => hook,
                        Err(err) => {
                            let _ = ready.send(Err(err.to_string()));
                            return;
                        }
                    };
                    if ready.send(Ok(GetCurrentThreadId())).is_ok() {
                        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {}
                    }
                    let _ = UnhookWindowsHookEx(hook);
                }
            })
            .map_err(|err| err.to_string())?;
        let thread_id = started.recv().map_err(|err| err.to_string())??;
        Ok(Self {
            active,
            thread_id,
            thread,
        })
    }

    pub fn active(&mut self) -> Result<bool, String> {
        if self.thread.is_finished() {
            return Err("host mouse hook stopped".into());
        }
        Ok(self.active.swap(false, Ordering::AcqRel))
    }
}

impl Drop for HostMouse {
    fn drop(&mut self) {
        if !self.thread.is_finished() {
            // SAFETY: the thread created its message queue before returning its ID.
            let _ = unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
        }
    }
}

unsafe extern "system" fn mouse_hook(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let event = unsafe { &*(data.0 as *const MSLLHOOKSTRUCT) };
        if event.flags & LLMHF_INJECTED == 0 || event.dwExtraInfo != SHARE_PLAY_INPUT_MARKER {
            HOST_MOUSE_ACTIVE.with(|active| {
                if let Some(flag) = active.get() {
                    flag.store(true, Ordering::Release);
                }
            });
        }
    }
    unsafe { CallNextHookEx(None, code, message, data) }
}

pub fn move_to(x: i32, y: i32) {
    unsafe {
        let left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if width <= 0 || height <= 0 {
            return;
        }
        let normalized = |pixel: i32, origin: i32, span: i32| {
            let span = i64::from(span);
            let offset = (i64::from(pixel) - i64::from(origin)).clamp(0, span - 1);
            ((offset * 65_536 + span - 1) / span).min(65_535) as i32
        };
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: normalized(x, left, width),
                    dy: normalized(y, top, height),
                    dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                    dwExtraInfo: SHARE_PLAY_INPUT_MARKER,
                    ..Default::default()
                },
            },
        };
        SendInput(&[input], size_of::<INPUT>() as i32);
    }
}
