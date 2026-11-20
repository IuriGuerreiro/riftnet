//! Map the viewer's normalized (0–1) pointer position onto the shared monitor.

/// A screen area in desktop pixels (X11 root / Windows virtual desktop).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 0–1 → pixel inside `rect`. Out-of-range or NaN input is clamped, so a
/// remote can never push the cursor outside the shared area.
pub fn to_pixels(rect: Rect, nx: f64, ny: f64) -> (i32, i32) {
    let clamp = |v: f64| if v.is_nan() { 0.0 } else { v.clamp(0.0, 1.0) };
    let axis = |origin: i32, len: u32, n: f64| {
        let max = len.saturating_sub(1) as f64;
        origin + (clamp(n) * max).round() as i32
    };
    (axis(rect.x, rect.width, nx), axis(rect.y, rect.height, ny))
}

/// Pick the monitor that was shared. `getDisplayMedia` only tells us the
/// captured size, so pick the monitor with that size (first match),
/// otherwise the one with the closest aspect ratio, otherwise the first.
pub fn pick_monitor(monitors: &[Rect], captured_w: u32, captured_h: u32) -> Option<Rect> {
    if let Some(m) = monitors
        .iter()
        .find(|m| m.width == captured_w && m.height == captured_h)
    {
        return Some(*m);
    }
    let aspect = |w: u32, h: u32| w as f64 / h.max(1) as f64;
    let want = aspect(captured_w, captured_h);
    monitors.iter().copied().min_by(|a, b| {
        let da = (aspect(a.width, a.height) - want).abs();
        let db = (aspect(b.width, b.height) - want).abs();
        da.total_cmp(&db)
    })
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

    #[test]
    fn corners_and_center() {
        assert_eq!(to_pixels(PRIMARY, 0.0, 0.0), (0, 0));
        assert_eq!(to_pixels(PRIMARY, 1.0, 1.0), (1919, 1079));
        assert_eq!(to_pixels(PRIMARY, 0.5, 0.5), (960, 540));
    }

    #[test]
    fn offset_monitor() {
        assert_eq!(to_pixels(RIGHT, 0.0, 0.0), (1920, 0));
        assert_eq!(to_pixels(RIGHT, 1.0, 1.0), (1920 + 2559, 1439));
    }

    #[test]
    fn clamps_bad_input() {
        assert_eq!(to_pixels(RIGHT, -3.0, 9.0), (1920, 1439));
        assert_eq!(to_pixels(PRIMARY, f64::NAN, f64::INFINITY), (0, 1079));
    }

    #[test]
    fn picks_by_exact_size_then_aspect() {
        let all = [PRIMARY, RIGHT];
        assert_eq!(pick_monitor(&all, 2560, 1440), Some(RIGHT));
        assert_eq!(pick_monitor(&all, 1920, 1080), Some(PRIMARY));
        // scaled-down capture of the 16:9 screens → first 16:9
        assert_eq!(pick_monitor(&all, 1280, 720), Some(PRIMARY));
        let ultrawide = Rect {
            x: 0,
            y: 0,
            width: 3440,
            height: 1440,
        };
        assert_eq!(
            pick_monitor(&[PRIMARY, ultrawide], 1720, 720),
            Some(ultrawide)
        );
        assert_eq!(pick_monitor(&[], 10, 10), None);
    }
}
