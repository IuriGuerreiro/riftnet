//! DOM `KeyboardEvent.code` → a key we may press. Strict allowlist: anything
//! not listed here is refused. Physical codes keep WASD in place whatever
//! the viewer's layout is.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    /// a–z, 0–9 and a few punctuation keys, typed unshifted.
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

const PUNCTUATION: &[(&str, char)] = &[
    ("Minus", '-'),
    ("NumpadSubtract", '-'),
    ("Equal", '='),
    ("BracketLeft", '['),
    ("BracketRight", ']'),
    ("Backslash", '\\'),
    ("Semicolon", ';'),
    ("Quote", '\''),
    ("Backquote", '`'),
    ("Comma", ','),
    ("Period", '.'),
    ("Slash", '/'),
    ("NumpadDivide", '/'),
    ("NumpadMultiply", '*'),
    ("NumpadAdd", '+'),
];

pub fn to_key(code: &str) -> Option<Key> {
    use Named::*;
    if let Some(rest) = code.strip_prefix("Key")
        && let [c] = rest.as_bytes()
        && c.is_ascii_uppercase()
    {
        return Some(Key::Char(c.to_ascii_lowercase() as char));
    }
    if let Some(rest) = code
        .strip_prefix("Digit")
        .or_else(|| code.strip_prefix("Numpad"))
        && let [c] = rest.as_bytes()
        && c.is_ascii_digit()
    {
        return Some(Key::Char(*c as char));
    }
    if let Some(n) = code.strip_prefix('F').and_then(|n| n.parse::<u8>().ok())
        && (1..=12).contains(&n)
        && code.len() == 1 + n.to_string().len()
    {
        return Some(Key::Named(F(n)));
    }
    if let Some((_, c)) = PUNCTUATION.iter().find(|(name, _)| *name == code) {
        return Some(Key::Char(*c));
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
        _ => return None,
    };
    Some(Key::Named(named))
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
    fn rejects_everything_else() {
        for code in [
            "F13",
            "F012",
            "KeyAB",
            "Keya",
            "Key\u{7f}",
            "Key\u{1}",
            "Key\u{8}",
            "Digit\u{7f}",
            "Numpad\u{1b}",
            "LaunchMail",
            "MetaLeft",
            "OSLeft",
            "ContextMenu",
            "",
            "Key",
        ] {
            assert_eq!(to_key(code), None, "{code:?}");
        }
    }

    #[test]
    fn every_char_is_printable_ascii() {
        let mut codes: Vec<String> = ('A'..='Z').map(|c| format!("Key{c}")).collect();
        codes.extend((0..10).map(|d| format!("Digit{d}")));
        codes.extend(PUNCTUATION.iter().map(|(n, _)| n.to_string()));
        for code in codes {
            match to_key(&code) {
                Some(Key::Char(c)) => assert!(c.is_ascii_graphic(), "{code}"),
                other => panic!("{code}: {other:?}"),
            }
        }
    }
}
