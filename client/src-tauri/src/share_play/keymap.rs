//! DOM `KeyboardEvent.code` → a key we can press. Physical codes keep WASD in
//! place whatever the viewer's layout is.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    /// Letters, digits, punctuation: typed as the unshifted character.
    Char(char),
    Named(Named),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Named {
    Shift,
    Control,
    Alt,
    Space,
    Tab,
    Enter,
    Escape,
    Backspace,
    Delete,
    Insert,
    Home,
    End,
    PageUp,
    PageDown,
    Up,
    Down,
    Left,
    Right,
    CapsLock,
    F(u8),
}

pub fn to_key(code: &str) -> Option<Key> {
    use Named::*;
    if let Some(c) = code.strip_prefix("Key")
        && c.len() == 1
    {
        return c.chars().next().map(|c| Key::Char(c.to_ascii_lowercase()));
    }
    if let Some(d) = code
        .strip_prefix("Digit")
        .or_else(|| code.strip_prefix("Numpad"))
        && d.len() == 1
        && let Some(c) = d.chars().next().filter(char::is_ascii_digit)
    {
        return Some(Key::Char(c));
    }
    if let Some(n) = code.strip_prefix('F').and_then(|n| n.parse::<u8>().ok())
        && (1..=12).contains(&n)
    {
        return Some(Key::Named(F(n)));
    }
    let named = match code {
        "ShiftLeft" | "ShiftRight" => Shift,
        "ControlLeft" | "ControlRight" => Control,
        "AltLeft" | "AltRight" => Alt,
        "Space" => Space,
        "Tab" => Tab,
        "Enter" | "NumpadEnter" => Enter,
        "Escape" => Escape,
        "Backspace" => Backspace,
        "Delete" | "NumpadDecimal" => Delete,
        "Insert" => Insert,
        "Home" => Home,
        "End" => End,
        "PageUp" => PageUp,
        "PageDown" => PageDown,
        "ArrowUp" => Up,
        "ArrowDown" => Down,
        "ArrowLeft" => Left,
        "ArrowRight" => Right,
        "CapsLock" => CapsLock,
        // OS keys are listed so the controller can name them, then blocks them.
        "MetaLeft" | "MetaRight" | "OSLeft" | "OSRight" => return None,
        _ => {
            let c = match code {
                "Minus" | "NumpadSubtract" => '-',
                "Equal" => '=',
                "BracketLeft" => '[',
                "BracketRight" => ']',
                "Backslash" => '\\',
                "Semicolon" => ';',
                "Quote" => '\'',
                "Backquote" => '`',
                "Comma" => ',',
                "Period" => '.',
                "Slash" | "NumpadDivide" => '/',
                "NumpadMultiply" => '*',
                "NumpadAdd" => '+',
                _ => return None,
            };
            return Some(Key::Char(c));
        }
    };
    Some(Key::Named(named))
}

/// Keys the controller accepts (before the safety filter).
pub fn known(code: &str) -> bool {
    to_key(code).is_some() || matches!(code, "MetaLeft" | "MetaRight" | "OSLeft" | "OSRight")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_common_game_keys() {
        assert_eq!(to_key("KeyW"), Some(Key::Char('w')));
        assert_eq!(to_key("Digit1"), Some(Key::Char('1')));
        assert_eq!(to_key("Numpad5"), Some(Key::Char('5')));
        assert_eq!(to_key("ShiftLeft"), Some(Key::Named(Named::Shift)));
        assert_eq!(to_key("Space"), Some(Key::Named(Named::Space)));
        assert_eq!(to_key("F12"), Some(Key::Named(Named::F(12))));
        assert_eq!(to_key("Slash"), Some(Key::Char('/')));
    }

    #[test]
    fn rejects_unknown() {
        assert_eq!(to_key("F13"), None);
        assert_eq!(to_key("KeyAB"), None);
        assert_eq!(to_key("LaunchMail"), None);
        assert!(!known("LaunchMail"));
        assert!(known("MetaLeft"), "known so it can be blocked, not dropped");
    }
}
