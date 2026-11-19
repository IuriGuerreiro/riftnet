// WARN: rooms of 2 only; 3+ people need renegotiation (see docs/architecture/calls.md).
use std::collections::HashMap;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use str0m::change::SdpOffer;
use str0m::media::{KeyframeRequestKind, MediaData, MediaKind, Mid};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};

use crate::meter as m;

const STATS_INTERVAL: Duration = Duration::from_secs(1);
const BUSY_WINDOW: Duration = Duration::from_secs(1);

#[derive(Clone)]
pub struct Sfu {
    addr: SocketAddr,
    cmds: Sender<Cmd>,
}

enum Cmd {
    Add {
        peer_id: u64,
        room: u64,
        rtc: Box<Rtc>,
        requested_at: Instant,
    },
    Remove {
        peer_id: u64,
    },
}

struct Peer {
    id: u64,
    room: u64,
    rtc: Rtc,
    audio: Option<Mid>,
    video: Option<Mid>,
    /// When `media.join` arrived. Cleared once the first media is seen.
    awaiting_media: Option<Instant>,
    end_reason: Option<&'static str>,
    /// Last cumulative (bytes, packets) per mid, to turn str0m totals into deltas.
    rx_totals: HashMap<Mid, (u64, u64)>,
    tx_totals: HashMap<Mid, (u64, u64)>,
}

impl Peer {
    fn kind(&self, mid: Mid) -> &'static str {
        if Some(mid) == self.video {
            "video"
        } else {
            "audio"
        }
    }

    /// Disconnect, keeping the first reason given.
    fn end(&mut self, reason: &'static str) {
        self.end_reason.get_or_insert(reason);
        self.rtc.disconnect();
    }
}

fn delta(totals: &mut HashMap<Mid, (u64, u64)>, mid: Mid, bytes: u64, packets: u64) -> (u64, u64) {
    let last = totals.insert(mid, (bytes, packets)).unwrap_or((0, 0));
    (bytes.saturating_sub(last.0), packets.saturating_sub(last.1))
}

/// RTCP jitter is in RTP clock units: 48 kHz for Opus, 90 kHz for video.
fn jitter_ms(kind: &str, units: u32) -> f64 {
    let hz = if kind == "video" { 90_000.0 } else { 48_000.0 };
    f64::from(units) * 1000.0 / hz
}

fn record_membership(peers: &[Peer], rooms: &HashMap<u64, Instant>) {
    metrics::gauge!(m::PEERS).set(peers.len() as f64);
    metrics::gauge!(m::ROOMS).set(rooms.len() as f64);
}

static NEXT_PEER: AtomicU64 = AtomicU64::new(1);

pub fn start(socket: UdpSocket) -> anyhow::Result<Sfu> {
    let addr = socket.local_addr()?;
    let (cmds, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("sfu".into())
        .spawn(move || run(socket, rx))?;
    Ok(Sfu { addr, cmds })
}

impl Sfu {
    pub fn add(&self, room: u64, sdp_offer: &str) -> anyhow::Result<(u64, String)> {
        let requested_at = Instant::now();
        let offer = SdpOffer::from_sdp_string(sdp_offer)?;
        let mut rtc = Rtc::builder()
            .set_stats_interval(Some(STATS_INTERVAL))
            .build(Instant::now());
        rtc.add_local_candidate(Candidate::host(self.addr, "udp")?);
        let answer = rtc.sdp_api().accept_offer(offer)?;

        let peer_id = NEXT_PEER.fetch_add(1, Ordering::Relaxed);
        self.cmds.send(Cmd::Add {
            peer_id,
            room,
            rtc: Box::new(rtc),
            requested_at,
        })?;
        Ok((peer_id, answer.to_sdp_string()))
    }

    pub fn remove(&self, peer_id: u64) {
        let _ = self.cmds.send(Cmd::Remove { peer_id });
    }
}

fn run(socket: UdpSocket, cmds: Receiver<Cmd>) {
    let local = socket.local_addr().expect("socket address");
    let mut peers: Vec<Peer> = Vec::new();
    let mut buf = vec![0u8; 2000];
    // Room id -> when its first peer joined.
    let mut rooms: HashMap<u64, Instant> = HashMap::new();
    record_membership(&peers, &rooms);

    // Loop saturation: per-pass work time, plus busy share over a window.
    let mut pass_start: Option<Instant> = None;
    let mut waited = Duration::ZERO;
    let mut window_start = Instant::now();
    let mut window_busy = Duration::ZERO;

    loop {
        let now = Instant::now();
        if let Some(start) = pass_start {
            let work = now.duration_since(start).saturating_sub(waited);
            metrics::histogram!(m::LOOP_ITERATION_US).record(work.as_micros() as f64);
            window_busy += work;
            let wall = now.duration_since(window_start);
            if wall >= BUSY_WINDOW {
                metrics::gauge!(m::LOOP_BUSY_RATIO)
                    .set((window_busy.as_secs_f64() / wall.as_secs_f64()).min(1.0));
                window_start = now;
                window_busy = Duration::ZERO;
            }
        }
        pass_start = Some(now);
        waited = Duration::ZERO;

        let mut joined = false;
        while let Ok(cmd) = cmds.try_recv() {
            match cmd {
                Cmd::Add {
                    peer_id,
                    room,
                    rtc,
                    requested_at,
                } => {
                    tracing::info!(peer.id = peer_id, room.id = room, "peer added");
                    rooms.entry(room).or_insert(requested_at);
                    peers.push(Peer {
                        id: peer_id,
                        room,
                        rtc: *rtc,
                        audio: None,
                        video: None,
                        awaiting_media: Some(requested_at),
                        end_reason: None,
                        rx_totals: HashMap::new(),
                        tx_totals: HashMap::new(),
                    });
                    joined = true;
                }
                Cmd::Remove { peer_id } => {
                    if let Some(p) = peers.iter_mut().find(|p| p.id == peer_id) {
                        p.end("left");
                    }
                }
            }
        }
        if joined {
            record_membership(&peers, &rooms);
        }

        let mut forward: Vec<(u64, u64, MediaKind, MediaData)> = Vec::new();
        let mut keyframes: Vec<(u64, u64, KeyframeRequestKind)> = Vec::new();
        let mut next_timeout = Instant::now() + Duration::from_millis(100);
        for p in &mut peers {
            while p.rtc.is_alive() {
                match p.rtc.poll_output() {
                    Ok(Output::Transmit(t)) => {
                        let _ = socket.send_to(&t.contents, t.destination);
                    }
                    Ok(Output::Timeout(t)) => {
                        let now = Instant::now();
                        if t <= now {
                            if p.rtc.handle_input(Input::Timeout(now)).is_err() {
                                p.end("error");
                            }
                            continue;
                        }
                        next_timeout = next_timeout.min(t);
                        break;
                    }
                    Ok(Output::Event(e)) => match e {
                        Event::MediaAdded(m) => match m.kind {
                            MediaKind::Audio => p.audio = Some(m.mid),
                            MediaKind::Video => p.video = Some(m.mid),
                        },
                        Event::MediaData(d) => {
                            if let Some(at) = p.awaiting_media.take() {
                                metrics::histogram!(m::JOIN_LATENCY_MS)
                                    .record(at.elapsed().as_secs_f64() * 1000.0);
                            }
                            let kind = if Some(d.mid) == p.video {
                                MediaKind::Video
                            } else {
                                MediaKind::Audio
                            };
                            forward.push((p.id, p.room, kind, d));
                        }
                        Event::KeyframeRequest(r) => {
                            let kind = match r.kind {
                                KeyframeRequestKind::Pli => "pli",
                                KeyframeRequestKind::Fir => "fir",
                            };
                            metrics::counter!(m::KEYFRAME_REQUESTS, "kind" => kind).increment(1);
                            keyframes.push((p.id, p.room, r.kind));
                        }
                        Event::MediaIngressStats(st) => {
                            let kind = p.kind(st.mid);
                            let (bytes, packets) =
                                delta(&mut p.rx_totals, st.mid, st.bytes, st.packets);
                            metrics::counter!(m::RTP_BYTES_IN, "kind" => kind).increment(bytes);
                            metrics::counter!(m::RTP_PACKETS_IN, "kind" => kind).increment(packets);
                            if let Some(loss) = st.loss {
                                metrics::histogram!(m::INGRESS_LOSS_PERCENT, "kind" => kind)
                                    .record(f64::from(loss) * 100.0);
                            }
                        }
                        Event::MediaEgressStats(st) => {
                            let kind = p.kind(st.mid);
                            let (bytes, packets) =
                                delta(&mut p.tx_totals, st.mid, st.bytes, st.packets);
                            metrics::counter!(m::RTP_BYTES_OUT, "kind" => kind).increment(bytes);
                            metrics::counter!(m::RTP_PACKETS_OUT, "kind" => kind)
                                .increment(packets);
                            if let Some(loss) = st.loss {
                                metrics::histogram!(m::EGRESS_LOSS_PERCENT, "kind" => kind)
                                    .record(f64::from(loss) * 100.0);
                            }
                            if let Some(remote) = &st.remote {
                                metrics::histogram!(m::EGRESS_JITTER_MS, "kind" => kind)
                                    .record(jitter_ms(kind, remote.jitter));
                            }
                        }
                        Event::PeerStats(st) => {
                            if let Some(rtt) = st.rtt {
                                metrics::histogram!(m::PEER_RTT_MS)
                                    .record(rtt.as_secs_f64() * 1000.0);
                            }
                        }
                        Event::Connected => tracing::info!(peer.id = p.id, "peer connected"),
                        Event::IceConnectionStateChange(IceConnectionState::Disconnected) => {
                            p.end("ice_disconnected")
                        }
                        _ => {}
                    },
                    Err(e) => {
                        tracing::warn!(peer.id = p.id, error = ?e, "peer failed");
                        p.end("error");
                    }
                }
            }
        }

        for (from, room, kind, data) in &forward {
            for p in peers
                .iter_mut()
                .filter(|p| p.id != *from && p.room == *room)
            {
                let (mid, label) = match kind {
                    MediaKind::Audio => (p.audio, "audio"),
                    MediaKind::Video => (p.video, "video"),
                };
                let dropped = |reason: &'static str| {
                    metrics::counter!(m::FORWARD_DROPPED, "kind" => label, "reason" => reason)
                        .increment(1);
                };
                let Some(mid) = mid else {
                    dropped("no_track");
                    continue;
                };
                let Some(writer) = p.rtc.writer(mid) else {
                    dropped("no_writer");
                    continue;
                };
                let Some(pt) = writer.match_params(data.params) else {
                    dropped("codec_mismatch");
                    continue;
                };
                match writer.write(pt, data.network_time, data.time, data.data.clone()) {
                    Ok(()) => metrics::counter!(m::FORWARDED, "kind" => label).increment(1),
                    Err(e) => {
                        dropped("write_error");
                        tracing::warn!(peer.id = p.id, error = ?e, "forward failed");
                    }
                }
            }
        }
        for (from, room, kind) in &keyframes {
            for p in peers
                .iter_mut()
                .filter(|p| p.id != *from && p.room == *room)
            {
                let Some(mid) = p.video else { continue };
                let Some(mut writer) = p.rtc.writer(mid) else {
                    continue;
                };
                let _ = writer.request_keyframe(None, *kind);
            }
        }

        if peers.iter().any(|p| !p.rtc.is_alive()) {
            let (gone, alive): (Vec<Peer>, Vec<Peer>) =
                peers.into_iter().partition(|p| !p.rtc.is_alive());
            peers = alive;
            for p in gone {
                let reason = p.end_reason.unwrap_or("closed");
                tracing::info!(peer.id = p.id, reason, "peer removed");
                metrics::counter!(m::PEER_SESSIONS_ENDED, "reason" => reason).increment(1);
                if !peers.iter().any(|o| o.room == p.room)
                    && let Some(started) = rooms.remove(&p.room)
                {
                    metrics::histogram!(m::CALL_DURATION_S, "reason" => reason)
                        .record(started.elapsed().as_secs_f64());
                }
            }
            record_membership(&peers, &rooms);
        }
        if !forward.is_empty() || !keyframes.is_empty() {
            continue;
        }

        let wait = next_timeout
            .saturating_duration_since(Instant::now())
            .clamp(Duration::from_millis(1), Duration::from_millis(100));
        socket
            .set_read_timeout(Some(wait))
            .expect("set read timeout");
        let wait_start = Instant::now();
        let received = socket.recv_from(&mut buf);
        waited = wait_start.elapsed();
        if let Ok((n, source)) = received
            && let Ok(contents) = buf[..n].try_into()
        {
            let input = Input::Receive(
                Instant::now(),
                Receive {
                    proto: Protocol::Udp,
                    source,
                    destination: local,
                    contents,
                },
            );
            if let Some(p) = peers.iter_mut().find(|p| p.rtc.accepts(&input))
                && p.rtc.handle_input(input).is_err()
            {
                p.end("error");
            }
        }

        let now = Instant::now();
        for p in peers.iter_mut().filter(|p| p.rtc.is_alive()) {
            if p.rtc.handle_input(Input::Timeout(now)).is_err() {
                p.end("error");
            }
        }
    }
}
