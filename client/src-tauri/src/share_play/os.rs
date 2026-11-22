use enigo::{Axis, Button, Direction, Enigo as Inner, Key, Keyboard, Mouse, Settings};

use super::input::Backend;
use super::keymap::{self, Named};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
use linux::HostMouse;
#[cfg(windows)]
use windows::HostMouse;

pub struct Enigo {
    input: Inner,
    host_mouse: HostMouse,
}

impl Enigo {
    pub fn new() -> Result<Self, String> {
        let settings = Settings {
            #[cfg(windows)]
            windows_dw_extra_info: Some(windows::SHARE_PLAY_INPUT_MARKER),
            ..Settings::default()
        };
        let input = Inner::new(&settings).map_err(|e| e.to_string())?;
        let host_mouse = HostMouse::new().map_err(|e| e.to_string())?;
        Ok(Self { input, host_mouse })
    }
}

fn dir(down: bool) -> Direction {
    if down {
        Direction::Press
    } else {
        Direction::Release
    }
}

fn to_enigo(key: keymap::Key) -> Key {
    match key {
        keymap::Key::Char(c) => Key::Unicode(c),
        keymap::Key::Named(n) => match n {
            Named::Shift => Key::Shift,
            Named::Control => Key::Control,
            Named::Alt => Key::Alt,
            Named::Space => Key::Space,
            Named::Tab => Key::Tab,
            Named::Enter => Key::Return,
            Named::Escape => Key::Escape,
            Named::Backspace => Key::Backspace,
            Named::Delete => Key::Delete,
            Named::Insert => Key::Insert,
            Named::Home => Key::Home,
            Named::End => Key::End,
            Named::PageUp => Key::PageUp,
            Named::PageDown => Key::PageDown,
            Named::Up => Key::UpArrow,
            Named::Down => Key::DownArrow,
            Named::Left => Key::LeftArrow,
            Named::Right => Key::RightArrow,
            Named::CapsLock => Key::CapsLock,
            Named::F(n) => [
                Key::F1,
                Key::F2,
                Key::F3,
                Key::F4,
                Key::F5,
                Key::F6,
                Key::F7,
                Key::F8,
                Key::F9,
                Key::F10,
                Key::F11,
                Key::F12,
            ][usize::from(n - 1)],
        },
    }
}

impl Backend for Enigo {
    fn key(&mut self, key: keymap::Key, down: bool) -> bool {
        self.input.key(to_enigo(key), dir(down)).is_ok()
    }

    fn location(&self) -> Option<(i32, i32)> {
        self.input.location().ok()
    }

    fn button(&mut self, b: u8, down: bool) -> bool {
        let b = match b {
            0 => Button::Left,
            1 => Button::Middle,
            _ => Button::Right,
        };
        self.input.button(b, dir(down)).is_ok()
    }

    fn move_to(&mut self, x: i32, y: i32) {
        #[cfg(windows)]
        windows::move_to(x, y);
        #[cfg(target_os = "linux")]
        let _ = self.input.move_mouse(x, y, enigo::Coordinate::Abs);
    }

    fn host_mouse_activity(&mut self) -> Result<bool, String> {
        #[cfg(windows)]
        {
            self.host_mouse.active()
        }
        #[cfg(target_os = "linux")]
        self.host_mouse.active().map_err(|err| err.to_string())
    }

    fn scroll(&mut self, dx: i32, dy: i32) {
        if dy != 0 {
            let _ = self.input.scroll(dy, Axis::Vertical);
        }
        if dx != 0 {
            let _ = self.input.scroll(dx, Axis::Horizontal);
        }
    }
}
