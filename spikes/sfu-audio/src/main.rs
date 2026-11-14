//! Throwaway spike: 1:1 audio through our own SFU (str0m).
//!
//! How it works:
//! - HTTP (axum, port 3000): serves `index.html` and `POST /join` (SDP offer -> SDP answer).
//! - UDP (one socket): ALL WebRTC traffic for all peers. One `Rtc` (str0m) per peer.
//! - The browser offers one two-way ("sendrecv") audio track. We forward every
//!   Opus packet we get from one peer into the other peer's track. No decoding.
//!
//! Only 2 peers. A 3rd one would need renegotiation (see docs/architecture/calls.md).

use std::net::{SocketAddr, UdpSocket};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::time::{Duration, Instant};

use axum::{Router, extract::{Query, State}, routing::get, routing::post};
use std::collections::HashMap;
use str0m::change::SdpOffer;
use str0m::media::{MediaData, Mid};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};
use tracing::{info, warn};

/// One connected browser.
struct Peer {
    id: u64,
    /// Only peers in the same room hear each other (room = conversation id).
    room: String,
    rtc: Rtc,
    /// The audio track (m-line). Same mid is used to send and receive.
    mid: Option<Mid>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sfu_audio=info,str0m=warn".into()),
        )
        .init();
    str0m::crypto::from_feature_flags().install_process_default();

    // The IP browsers use to reach us. Override with SFU_IP=1.2.3.4
    let ip = std::env::var("SFU_IP")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(lan_ip);
    let socket = UdpSocket::bind((ip, 0)).expect("bind UDP");
    let udp_addr = socket.local_addr().unwrap();
    info!("media UDP on {udp_addr}");

    // HTTP side hands new Rtc instances to the media loop through this channel.
    let (tx, rx) = mpsc::sync_channel::<(String, Rtc)>(4);
    std::thread::spawn(move || media_loop(socket, rx));

    let app = Router::new()
        .route("/", get(|| async { axum::response::Html(include_str!("../index.html")) }))
        .route("/join", post(join))
        .with_state((udp_addr, tx));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    info!("open http://localhost:3000 in two tabs");
    axum::serve(listener, app).await.unwrap();
}

/// POST /join?room=<id>: body = browser's offer JSON ({type, sdp}), reply = our answer JSON.
async fn join(
    State((udp_addr, tx)): State<(SocketAddr, SyncSender<(String, Rtc)>)>,
    Query(q): Query<HashMap<String, String>>,
    body: String,
) -> Result<String, (axum::http::StatusCode, String)> {
    let bad = |e: String| (axum::http::StatusCode::BAD_REQUEST, e);
    let offer: SdpOffer = serde_json::from_str(&body).map_err(|e| bad(e.to_string()))?;

    // Full ICE, not ICE-lite: with lite, str0m locked onto a different path than the one
    // Chrome sent media on (machines with several interfaces, e.g. Docker bridges).
    let mut rtc = Rtc::builder().build(Instant::now());
    rtc.add_local_candidate(Candidate::host(udp_addr, "udp").unwrap());
    let answer = rtc
        .sdp_api()
        .accept_offer(offer)
        .map_err(|e| bad(e.to_string()))?;

    let room = q.get("room").cloned().unwrap_or_default();
    tx.send((room, rtc)).map_err(|e| bad(e.to_string()))?;
    Ok(serde_json::to_string(&answer).unwrap())
}

/// The whole SFU: one thread, one UDP socket, all peers.
fn media_loop(socket: UdpSocket, rx: Receiver<(String, Rtc)>) {
    let mut peers: Vec<Peer> = Vec::new();
    let mut next_id = 0;
    let mut buf = vec![0u8; 2000];
    let local = socket.local_addr().unwrap();

    loop {
        // 1. Pick up newly joined peers.
        while let Ok((room, rtc)) = rx.try_recv() {
            next_id += 1;
            let n = peers.iter().filter(|p| p.room == room).count() + 1;
            info!("peer {next_id} joined room {room:?} ({n} in room)");
            peers.push(Peer { id: next_id, room, rtc, mid: None });
        }

        // 2. Drain each peer's output: send packets, collect audio to forward.
        let mut forward: Vec<(u64, String, MediaData)> = Vec::new();
        let mut next_timeout = Instant::now() + Duration::from_millis(100);
        for p in &mut peers {
            loop {
                match p.rtc.poll_output() {
                    Ok(Output::Transmit(t)) => {
                        let _ = socket.send_to(&t.contents, t.destination);
                    }
                    Ok(Output::Timeout(t)) => {
                        next_timeout = next_timeout.min(t);
                        break;
                    }
                    Ok(Output::Event(e)) => match e {
                        Event::MediaAdded(m) => p.mid = Some(m.mid),
                        Event::MediaData(d) => { tracing::debug!("in from {} mid {:?}", p.id, d.mid); forward.push((p.id, p.room.clone(), d)) }
                        Event::IceConnectionStateChange(IceConnectionState::Disconnected) => {
                            p.rtc.disconnect()
                        }
                        Event::Connected => info!("peer {} connected", p.id),
                        _ => {}
                    },
                    Err(e) => {
                        warn!("peer {} error: {e:?}", p.id);
                        p.rtc.disconnect();
                        break;
                    }
                }
            }
        }

        // 3. Forward: write each audio packet into every OTHER peer's track.
        for (from, room, data) in &forward {
            for p in peers.iter_mut().filter(|p| p.id != *from && p.room == *room) {
                let Some(mid) = p.mid else { continue };
                let Some(writer) = p.rtc.writer(mid) else { continue };
                let Some(pt) = writer.match_params(data.params) else { continue };
                match writer.write(pt, data.network_time, data.time, data.data.clone()) {
                    Ok(()) => tracing::debug!("fwd {} -> {}", from, p.id),
                    Err(e) => warn!("write to peer {} failed: {e:?}", p.id),
                }
            }
        }

        // 4. Remove dead peers.
        peers.retain(|p| {
            let alive = p.rtc.is_alive();
            if !alive {
                info!("peer {} left", p.id);
            }
            alive
        });

        // Just forwarded something? Loop again right away so it gets sent.
        if !forward.is_empty() {
            continue;
        }

        // 5. Wait for a UDP packet (or the next timer), then feed it to the right peer.
        let wait = next_timeout
            .saturating_duration_since(Instant::now())
            .max(Duration::from_millis(1));
        socket.set_read_timeout(Some(wait)).unwrap();
        if let Ok((n, source)) = socket.recv_from(&mut buf) {
            if let Ok(contents) = buf[..n].try_into() {
                let input = Input::Receive(
                    Instant::now(),
                    Receive { proto: Protocol::Udp, source, destination: local, contents },
                );
                // `accepts` tells us which peer this packet belongs to.
                if let Some(p) = peers.iter_mut().find(|p| p.rtc.accepts(&input)) {
                    if let Err(e) = p.rtc.handle_input(input) {
                        warn!("input err {e:?}");
                        p.rtc.disconnect();
                    }
                    
                } else {
                    tracing::debug!("udp from {source} matched no peer");
                }
            }
        }

        // 6. Let every peer's clock tick (retransmits, keepalives, ...).
        let now = Instant::now();
        for p in &mut peers {
            if p.rtc.is_alive() && p.rtc.handle_input(Input::Timeout(now)).is_err() {
                p.rtc.disconnect();
            }
        }
    }
}

/// Our LAN IP (asks the OS which interface routes outward; sends nothing).
fn lan_ip() -> std::net::IpAddr {
    let s = UdpSocket::bind("0.0.0.0:0").unwrap();
    s.connect("8.8.8.8:80").unwrap();
    s.local_addr().unwrap().ip()
}
