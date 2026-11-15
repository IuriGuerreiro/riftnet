//! Screen capture → video source.
//!
//! libwebrtc's own desktop capturer (X11 here; PipeWire on Wayland) hands us
//! BGRA frames. We convert them to I420 (the YUV layout encoders take) and push
//! them into a `NativeVideoSource`. The encoder (hardware if possible) runs
//! inside libwebrtc after that.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use libwebrtc::desktop_capturer::{
    DesktopCaptureSourceType, DesktopCapturer, DesktopCapturerOptions,
};
use libwebrtc::native::yuv_helper;
use libwebrtc::prelude::*;
use libwebrtc::video_source::native::NativeVideoSource;

/// Frames captured so far (for the stats line).
pub static FRAMES: AtomicU64 = AtomicU64::new(0);

/// Starts a thread that grabs the screen `fps` times a second.
pub fn start(source: NativeVideoSource, fps: u32) -> anyhow::Result<()> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("capture".into())
        .spawn(move || {
            let mut options = DesktopCapturerOptions::new(DesktopCaptureSourceType::Screen);
            options.set_include_cursor(true);
            let Some(mut capturer) = DesktopCapturer::new(options) else {
                let _ = ready_tx.send(Err(anyhow::anyhow!("no desktop capturer on this system")));
                return;
            };
            let screens = capturer.get_source_list();
            let titles: Vec<String> = screens
                .iter()
                .map(|s| format!("{} ({})", s.title(), s.id()))
                .collect();
            println!("screens: {titles:?}");
            let started = Instant::now();
            let source = Arc::new(source);
            capturer.start_capture(screens.first().cloned(), move |result| {
                let Ok(frame) = result else { return };
                let (w, h) = (frame.width() as u32, frame.height() as u32);
                let mut i420 = I420Buffer::new(w, h);
                let (sy, su, sv) = i420.strides();
                let (y, u, v) = i420.data_mut();
                // libyuv "ARGB" = bytes B,G,R,A in memory = what X11 gives us.
                yuv_helper::argb_to_i420(
                    frame.data(),
                    frame.stride(),
                    y,
                    sy,
                    u,
                    su,
                    v,
                    sv,
                    w as i32,
                    h as i32,
                );
                let mut vf = VideoFrame::new(VideoRotation::VideoRotation0, i420);
                vf.timestamp_us = started.elapsed().as_micros() as i64;
                source.capture_frame(&vf);
                FRAMES.fetch_add(1, Ordering::Relaxed);
            });
            let _ = ready_tx.send(Ok(()));

            // Ask for a frame every 1/fps seconds. The callback above runs inside.
            let period = Duration::from_secs_f64(1.0 / fps as f64);
            let mut next = Instant::now();
            loop {
                capturer.capture_frame();
                next += period;
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                } else {
                    next = now; // we're behind: don't try to catch up
                }
            }
        })?;
    ready_rx.recv()?
}
