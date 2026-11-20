//! Real input via enigo (Windows SendInput, X11 XTest).

use enigo::{Axis, Button, Coordinate, Direction, Enigo as Inner, Key, Keyboard, Mouse, Settings};

use super::input::Backend;
use super::keymap::{self, Named};

pub struct Enigo(Inner);

impl Enigo {
    pub fn new() -> Result<Self, String> {
        Inner::new(&Settings::default())
            .map(Self)
            .map_err(|e| e.to_string())
    }
}

fn dir(down: bool) -> Direction {
    if down {
        Direction::Press
    } else {
        Direction::Release
    }
}

fn to_enigo(code: &str) -> Option<Key> {
    Some(match keymap::to_key(code)? {
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
    })
}

impl Backend for Enigo {
    fn key(&mut self, code: &str, down: bool) {
        if let Some(k) = to_enigo(code)
            && let Err(e) = self.0.key(k, dir(down))
        {
            log::debug!("key {code}: {e}");
        }
    }

    fn button(&mut self, b: u8, down: bool) {
        let b = match b {
            0 => Button::Left,
            1 => Button::Middle,
            _ => Button::Right,
        };
        let _ = self.0.button(b, dir(down));
    }

    fn move_to(&mut self, x: i32, y: i32) {
        // enigo's absolute move on Windows only covers the primary monitor.
        // SetCursorPos uses virtual-desktop pixels, so it reaches every monitor.
        #[cfg(windows)]
        {
            let (w, h) = self.0.main_display().unwrap_or((0, 0));
            if x < 0 || y < 0 || x >= w || y >= h {
                // SAFETY: plain Win32 call with value arguments.
                let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::SetCursorPos(x, y) };
                return;
            }
        }
        let _ = self.0.move_mouse(x, y, Coordinate::Abs);
    }

    fn scroll(&mut self, dx: i32, dy: i32) {
        if dy != 0 {
            let _ = self.0.scroll(dy, Axis::Vertical);
        }
        if dx != 0 {
            let _ = self.0.scroll(dx, Axis::Horizontal);
        }
    }
}
