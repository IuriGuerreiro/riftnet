//! Gate spike: can a native app send our own 1080p60 screen, hardware
//! encoded, through our SFU, using LiveKit's `libwebrtc` crate?
//!
//! Flow: log in → DM the viewer → call → join the SFU with a video-only offer
//! → capture the screen → libwebrtc encodes (VA-API H.264 if we can) → SFU →
//! the viewer's browser. Prints encoder stats every 2 seconds.
//!
//! Env:
//! - `API` (default http://127.0.0.1:7130), `EMAIL`, `PASSWORD`
//! - `CALL`: the viewer's username (they accept in the web UI)
//! - `FPS` (default 60), `ENCODER`: vaapi (default) | software

mod capture;
mod signaling;

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use libwebrtc::peer_connection_factory::native::PeerConnectionFactoryExt;
use libwebrtc::prelude::*;
use libwebrtc::stats::RtcStats;
use libwebrtc::video_source::native::NativeVideoSource;
use protocol::v1::{self, envelope::Payload};

const MAX_BITRATE: u64 = 8_000_000; // ~6–8 Mbps for 1080p60 H.264

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let api_url = env("API", "http://127.0.0.1:7130");
    let email = std::env::var("EMAIL").context("set EMAIL")?;
    let password = std::env::var("PASSWORD").context("set PASSWORD")?;
    let callee = std::env::var("CALL").context("set CALL (viewer's username)")?;
    let fps: u32 = env("FPS", "60").parse()?;
    let backend = match env("ENCODER", "vaapi").as_str() {
        "vaapi" => VideoEncoderBackend::Vaapi,
        "software" => VideoEncoderBackend::Software,
        other => bail!("unknown ENCODER {other}"),
    };

    let available: Vec<_> = VideoEncoderBackend::list_available().into_iter().collect();
    println!("encoder backends here: {available:?}");

    // --- 1. WebRTC: one video track, H.264 only, sendrecv like the web client.
    let factory = PeerConnectionFactory::default();
    println!(
        "H.264 encoders for {backend:?}: {:?}",
        factory.video_encoder_codecs(backend)
    );
    let pc = factory.create_peer_connection(RtcConfiguration::default())?;
    pc.on_connection_state_change(Some(Box::new(|s| println!("connection: {s:?}"))));

    let source = NativeVideoSource::new(
        VideoResolution {
            width: 1920,
            height: 1080,
        },
        true,
    );
    let track = factory.create_video_track("screen", source.clone());
    let transceiver = pc.add_transceiver(
        track.into(),
        RtpTransceiverInit {
            direction: RtpTransceiverDirection::SendRecv,
            stream_ids: vec!["screen".into()],
            send_encodings: vec![RtpEncodingParameters {
                max_bitrate: Some(MAX_BITRATE),
                max_framerate: Some(fps as f64),
                ..Default::default()
            }],
        },
    )?;
    // VA-API here only does H.264, and only the profiles it lists:
    // 42e01f (Constrained Baseline) or 4d0032 (Main). Any other H.264 profile
    // silently falls back to OpenH264 (software). Offer 42e01f only.
    let h264: Vec<_> = factory
        .get_rtp_sender_capabilities(MediaType::Video)
        .codecs
        .into_iter()
        .filter(|c| {
            let fmtp = c.sdp_fmtp_line.as_deref().unwrap_or("");
            c.mime_type.eq_ignore_ascii_case("video/H264")
                && fmtp.contains("profile-level-id=42e01f")
                && fmtp.contains("packetization-mode=1")
        })
        .collect();
    if h264.is_empty() {
        bail!("no H.264 in libwebrtc's codec list");
    }
    transceiver.set_codec_preferences(h264)?;
    let sender = transceiver.sender();
    sender.set_video_encoder_backend(backend);
    let mut params = sender.parameters();
    params.set_degradation_preference(DegradationPreference::MaintainFramerate);
    sender.set_parameters(params)?;

    // The bandwidth estimate starts low (~300 kbps) and only climbs while we
    // send a lot. A mostly still screen sends little, so it stays low and
    // libwebrtc shrinks the picture. Start at 4 Mbps, never below 1 Mbps.
    pc.set_bitrate(BitrateSettings {
        min_bitrate_bps: Some(1_000_000),
        start_bitrate_bps: Some(4_000_000),
        max_bitrate_bps: Some(MAX_BITRATE),
    })?;

    let opts = OfferOptions {
        // Keep our sendrecv direction (the default turns receiving off).
        offer_to_receive_audio: None,
        offer_to_receive_video: None,
        ..Default::default()
    };
    let offer = pc.create_offer(opts).await?;
    pc.set_local_description(offer.clone()).await?;

    // --- 2. Signaling: DM → call → join with our offer.
    let mut api = signaling::Api::connect(&api_url, &email, &password).await?;
    let Payload::Conversation(conv) = api
        .request(Payload::OpenDm(v1::OpenDm {
            username: callee.clone(),
        }))
        .await?
    else {
        bail!("open_dm: unexpected reply");
    };
    let conversation_id = conv.conversation.context("no conversation")?.id;
    let Payload::CallResult(started) = api
        .request(Payload::CallStart(v1::CallStart { conversation_id }))
        .await?
    else {
        bail!("call_start: unexpected reply");
    };
    let call_id = started.call.context("no call")?.id;
    println!("calling @{callee} (call {call_id}), accept it in the web UI…");

    let Payload::CallJoined(joined) = api
        .request(Payload::CallJoin(v1::CallJoin {
            call_id,
            sdp_offer: offer.to_string(),
        }))
        .await?
    else {
        bail!("call_join: unexpected reply");
    };
    pc.set_remote_description(SessionDescription::parse(
        &joined.sdp_answer,
        SdpType::Answer,
    )?)
    .await?;

    // --- 3. Start capturing and tell the viewer we share.
    capture::start(source, fps)?;
    api.wait_for_answer(call_id).await?;
    api.request(Payload::CallScreenShare(v1::CallScreenShare {
        call_id,
        sharing: true,
    }))
    .await?;
    println!("sharing. Ctrl-C to stop.");

    // --- 4. Stats until the call ends.
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    let mut last = Stats::default();
    loop {
        tokio::select! {
            _ = api.run_until_ended(call_id) => break,
            _ = tick.tick() => last = print_stats(&pc, last).await,
        }
    }
    println!("call ended");
    Ok(())
}

#[derive(Default)]
struct Stats {
    at: Option<Instant>,
    bytes: u64,
    frames: u64,
    cpu_ticks: u64,
}

async fn print_stats(pc: &PeerConnection, last: Stats) -> Stats {
    let now = Instant::now();
    let mut line = String::new();
    let mut bytes = last.bytes;
    let mut remote = String::new();
    for s in pc.get_stats().await.unwrap_or_default() {
        if let RtcStats::OutboundRtp(o) = &s
            && o.stream.kind == "video"
        {
            bytes = o.sent.bytes_sent;
            let out = &o.outbound;
            line = format!(
                "{}x{}@{:.0} enc={} hw={} limit={:?} key={} pli={} nack={} rtx={}KB",
                out.frame_width,
                out.frame_height,
                out.frames_per_second,
                out.encoder_implementation,
                out.power_efficient_encoder,
                out.quality_limitation_reason,
                out.key_frames_encoded,
                out.pli_count,
                out.nack_count,
                out.retransmitted_bytes_sent / 1000,
            );
        }
        // What the SFU reports back about our packets (RTCP receiver reports).
        if let RtcStats::RemoteInboundRtp(r) = &s
            && r.stream.kind == "video"
        {
            remote = format!(
                " | sfu: lost={} frac={:.2} rtt={:.0}ms",
                r.received.packets_lost,
                r.remote_inbound.fraction_lost,
                r.remote_inbound.round_trip_time * 1000.0
            );
        }
    }
    line.push_str(&remote);
    let frames = capture::FRAMES.load(Ordering::Relaxed);
    let cpu_ticks = cpu_ticks();
    if let Some(at) = last.at {
        let secs = now.duration_since(at).as_secs_f64();
        let mbps = (bytes - last.bytes) as f64 * 8.0 / secs / 1e6;
        let cap_fps = (frames - last.frames) as f64 / secs;
        // /proc ticks are 1/100 s. 100% = one full core.
        let cpu = (cpu_ticks - last.cpu_ticks) as f64 / secs;
        println!("{line} {mbps:.1} Mbps | captured {cap_fps:.0} fps | cpu {cpu:.0}%");
    }
    Stats {
        at: Some(now),
        bytes,
        frames,
        cpu_ticks,
    }
}

/// This process's CPU time (user + system), in 1/100 s.
fn cpu_ticks() -> u64 {
    let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    // Fields after the ")" of the process name; utime and stime are 14 and 15.
    let rest = stat.rsplit(')').next().unwrap_or("");
    let f: Vec<&str> = rest.split_whitespace().collect();
    let get = |i: usize| f.get(i).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    get(11) + get(12)
}
