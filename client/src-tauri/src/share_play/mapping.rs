//! Map the viewer's normalized (0–1) pointer position onto the shared monitor.

/// A screen area in desktop pixels (X11 root / Windows virtual desktop).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 0–1 → pixel inside `rect`. Anything outside 0–1 (or NaN) is refused:
/// a remote can never point outside the shared area.
pub fn to_pixels(rect: Rect, nx: f64, ny: f64) -> Option<(i32, i32)> {
    let ok = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
    if !ok(nx) || !ok(ny) || rect.width == 0 || rect.height == 0 {
        return None;
    }
    let axis = |origin: i32, len: u32, n: f64| origin + (n * f64::from(len - 1)).round() as i32;
    Some((axis(rect.x, rect.width, nx), axis(rect.y, rect.height, ny)))
}

/// The capture size alone can't prove which monitor is shared. Suggest one
/// only when exactly one monitor has that exact size; otherwise the host
/// must pick it by hand before approving.
pub fn unique_match(monitors: &[Rect], captured_w: u32, captured_h: u32) -> Option<usize> {
    let mut hits = monitors
        .iter()
        .enumerate()
        .filter(|(_, m)| m.width == captured_w && m.height == captured_h);
    let first = hits.next()?.0;
    hits.next().is_none().then_some(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    const RIGHT: Rect = Rect {
        x: 1920,
        y: 0,
        width: 2560,
        height: 1440,
    };
    const TWIN: Rect = Rect {
        x: -1920,
        y: 0,
        width: 1920,
        height: 1080,
    };

    #[test]
    fn corners_and_center() {
        assert_eq!(to_pixels(PRIMARY, 0.0, 0.0), Some((0, 0)));
        assert_eq!(to_pixels(PRIMARY, 1.0, 1.0), Some((1919, 1079)));
        assert_eq!(to_pixels(PRIMARY, 0.5, 0.5), Some((960, 540)));
    }

    #[test]
    fn offset_monitor() {
        assert_eq!(to_pixels(RIGHT, 0.0, 0.0), Some((1920, 0)));
        assert_eq!(to_pixels(RIGHT, 1.0, 1.0), Some((1920 + 2559, 1439)));
        assert_eq!(to_pixels(TWIN, 0.0, 0.0), Some((-1920, 0)));
    }

    #[test]
    fn refuses_bad_input() {
        assert_eq!(to_pixels(RIGHT, -0.01, 0.5), None);
        assert_eq!(to_pixels(RIGHT, 0.5, 1.01), None);
        assert_eq!(to_pixels(PRIMARY, f64::NAN, 0.0), None);
        assert_eq!(to_pixels(PRIMARY, 0.0, f64::INFINITY), None);
    }

    #[test]
    fn suggests_only_an_unambiguous_monitor() {
        assert_eq!(unique_match(&[PRIMARY, RIGHT], 2560, 1440), Some(1));
        assert_eq!(
            unique_match(&[PRIMARY, RIGHT, TWIN], 1920, 1080),
            None,
            "two identical"
        );
        assert_eq!(
            unique_match(&[PRIMARY, RIGHT], 1280, 720),
            None,
            "scaled capture"
        );
        assert_eq!(unique_match(&[], 10, 10), None);
    }
}
