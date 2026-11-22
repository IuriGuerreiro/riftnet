use std::collections::HashMap;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use str0m::change::{SdpAnswer, SdpOffer, SdpPendingOffer};
use str0m::channel::{ChannelId, Reliability};
use str0m::media::{Direction, KeyframeRequestKind, MediaData, MediaKind, Mid};
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

/// Things the SFU decided on its own that the api must know about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Notice {
    PeerGone { peer_id: u64 },
    RouteFailed { room: u64, grant: u64 },
}

/// Share Play limits on relayed input.
const MAX_INPUT_BYTES: usize = 256;
const INPUT_RATE_PER_S: f64 = 200.0;
const INPUT_BURST: f64 = 400.0;
const RELIABLE: &str = "input";
const LATEST: &str = "input-move";
const AUDIO_SIGNAL: &str = "call-audio-v1";
const MAX_AUDIO_SDP: usize = 64 * 1024;

#[derive(Clone, Copy)]
enum Source {
    Voice,
    ScreenAudio,
    Video,
}

struct AudioTracks {
    voice: Mid,
    screen: Mid,
}

#[derive(Default)]
struct AudioNegotiation {
    channel: Option<ChannelId>,
    screen_input: Option<Mid>,
    tracks: HashMap<u64, AudioTracks>,
    pending: Option<(SdpPendingOffer, Instant)>,
}

impl AudioNegotiation {
    fn sync(
        &mut self,
        rtc: &mut Rtc,
        self_id: u64,
        roster: &[(u64, u64)],
        now: Instant,
    ) -> anyhow::Result<()> {
        let Some(channel) = self.channel else {
            return Ok(());
        };
        if let Some((_, sent)) = &self.pending {
            anyhow::ensure!(
                now.duration_since(*sent) < Duration::from_secs(15),
                "audio SDP timed out"
            );
            return Ok(());
        }
        let mut changes = rtc.sdp_api();
        if self.screen_input.is_none() {
            self.screen_input =
                Some(changes.add_media(MediaKind::Audio, Direction::RecvOnly, None, None, None));
        }
        self.tracks.retain(|id, tracks| {
            if roster.iter().any(|(peer, _)| peer == id) {
                true
            } else {
                changes.stop_media(tracks.voice);
                changes.stop_media(tracks.screen);
                false
            }
        });
        for &(peer, user) in roster.iter().filter(|(id, _)| *id != self_id) {
            self.tracks.entry(peer).or_insert_with(|| AudioTracks {
                voice: changes.add_media(
                    MediaKind::Audio,
                    Direction::SendOnly,
                    None,
                    Some(format!("voice-{user}-{peer}")),
                    None,
                ),
                screen: changes.add_media(
                    MediaKind::Audio,
                    Direction::SendOnly,
                    None,
                    Some(format!("screen-{user}-{peer}")),
                    None,
                ),
            });
        }
        if let Some((offer, pending)) = changes.apply() {
            let sdp = offer.to_sdp_string();
            let sdp = with_screen_stereo(&sdp, self.screen_input);
            anyhow::ensure!(sdp.len() <= MAX_AUDIO_SDP, "audio SDP is too large");
            let written = rtc
                .channel(channel)
                .ok_or_else(|| anyhow::anyhow!("audio channel closed"))?
                .write(false, sdp.as_bytes())?;
            anyhow::ensure!(written, "audio channel is full");
            self.pending = Some((pending, now));
        }
        Ok(())
    }

    fn accept_answer(&mut self, rtc: &mut Rtc, data: &[u8]) -> anyhow::Result<()> {
        anyhow::ensure!(data.len() <= MAX_AUDIO_SDP, "audio SDP is too large");
        let Some((pending, _)) = self.pending.take() else {
            anyhow::bail!("unexpected audio SDP answer")
        };
        let answer = SdpAnswer::from_sdp_string(std::str::from_utf8(data)?)?;
        rtc.sdp_api().accept_answer(pending, answer)?;
        Ok(())
    }
}

fn with_screen_stereo(sdp: &str, input: Option<Mid>) -> String {
    let Some(input) = input else {
        return sdp.to_owned();
    };
    let input = input.to_string();
    sdp.split("\r\nm=")
        .map(|section| {
            if !section
                .lines()
                .any(|line| line.strip_prefix("a=mid:") == Some(input.as_str()))
            {
                return section.to_owned();
            }
            let opus = section.lines().find_map(|line| {
                let (pt, codec) = line.strip_prefix("a=rtpmap:")?.split_once(' ')?;
                codec.eq_ignore_ascii_case("opus/48000/2").then_some(pt)
            });
            section
                .split_inclusive("\r\n")
                .map(|line| {
                    if opus.is_some_and(|pt| {
                        line.strip_prefix("a=fmtp:")
                            .and_then(|value| value.split_once(' '))
                            .is_some_and(|(payload, _)| payload == pt)
                    }) && !line.contains(";stereo=")
                    {
                        format!("{};stereo=1\r\n", line.trim_end())
                    } else {
                        line.to_owned()
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\r\nm=")
}

/// Token bucket for one peer's input messages.
struct RateLimit {
    tokens: f64,
    at: Instant,
}

impl RateLimit {
    fn new(now: Instant) -> Self {
        Self {
            tokens: INPUT_BURST,
            at: now,
        }
    }

    fn allow(&mut self, now: Instant) -> bool {
        let dt = now.saturating_duration_since(self.at).as_secs_f64();
        self.at = now;
        self.tokens = (self.tokens + dt * INPUT_RATE_PER_S).min(INPUT_BURST);
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

/// The one input route of a room, for one grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Route {
    pub controller: u64,
    pub host: u64,
    pub grant: u64,
}

/// A room's route plus the highest grant ever closed there. Grant ids only
/// grow, so a late or replayed update for a closed grant is ignored.
#[derive(Debug, Default)]
struct RouteSlot {
    active: Option<Route>,
    closed: u64,
    revision: u64,
}

impl RouteSlot {
    fn update(&mut self, revision: u64, route: Option<Route>) {
        if revision <= self.revision {
            return;
        }
        self.revision = revision;
        self.set(route);
    }

    fn set(&mut self, route: Option<Route>) {
        let Some(r) = route else {
            self.close();
            return;
        };
        if r.grant == 0 || r.grant <= self.closed {
            return;
        }
        match self.active {
            Some(a) if r.grant < a.grant => {}
            Some(a) if r.grant > a.grant => {
                self.close();
                self.active = Some(r);
            }
            _ => self.active = Some(r),
        }
    }

    fn close(&mut self) -> Option<Route> {
        let a = self.active.take()?;
        self.closed = self.closed.max(a.grant);
        Some(a)
    }
}

/// The lossy channel carries pointer moves only. A key or click there could
/// lose its release, so anything else is dropped.
fn is_move(data: &[u8]) -> bool {
    data.starts_with(br#"{"t":"move","#)
}

#[derive(Debug, PartialEq, Eq)]
enum Relay {
    /// Send to this host peer.
    To(u64),
    /// Ignore (lossy channel, or not part of the active grant).
    Drop,
    /// A reliable input message must not be lost: break the route.
    Fail,
}

/// Only the granted controller's input reaches only its host.
fn relay_decision(
    route: Option<Route>,
    from: u64,
    label: &str,
    data: &[u8],
    allowed: bool,
) -> Relay {
    let Some(r) = route.filter(|r| r.controller == from) else {
        return Relay::Drop;
    };
    let ok = data.len() <= MAX_INPUT_BYTES && allowed;
    match label {
        RELIABLE if ok => Relay::To(r.host),
        RELIABLE => Relay::Fail,
        LATEST if ok && is_move(data) => Relay::To(r.host),
        _ => Relay::Drop,
    }
}

// Bind events at production time, before SCTP buffering and route changes.
fn input_for_grant(route: Option<Route>, packet: &[u8]) -> Option<&[u8]> {
    let grant = u64::from_be_bytes(packet.get(..8)?.try_into().ok()?);
    (route?.grant == grant).then(|| &packet[8..])
}

enum Cmd {
    Add {
        peer_id: u64,
        room: u64,
        user_id: u64,
        rtc: Box<Rtc>,
        requested_at: Instant,
    },
    Remove {
        peer_id: u64,
    },
    Route {
        room: u64,
        revision: u64,
        route: Option<Route>,
    },
}

struct Peer {
    id: u64,
    room: u64,
    user_id: u64,
    rtc: Rtc,
    /// Open data channels by label. Only `input*` labels are relayed.
    channels: HashMap<String, ChannelId>,
    limiter: RateLimit,
    audio: Option<Mid>,
    negotiated_audio: AudioNegotiation,
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

/// Share Play input channels. Anything else a client opens is ignored.
fn is_relayed(label: &str) -> bool {
    label.starts_with("input")
}

/// Prefix the sender's user id and the grant it was relayed under (8 bytes
/// each, big endian) so the host checks both before applying it.
fn tag(user_id: u64, grant: u64, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(16 + data.len());
    out.extend_from_slice(&user_id.to_be_bytes());
    out.extend_from_slice(&grant.to_be_bytes());
    out.extend_from_slice(data);
    out
}

static NEXT_PEER: AtomicU64 = AtomicU64::new(1);

pub fn start(
    socket: UdpSocket,
) -> anyhow::Result<(Sfu, tokio::sync::mpsc::UnboundedReceiver<Notice>)> {
    let addr = socket.local_addr()?;
    let (cmds, rx) = mpsc::channel();
    let (notices, notices_rx) = tokio::sync::mpsc::unbounded_channel();
    std::thread::Builder::new()
        .name("sfu".into())
        .spawn(move || run(socket, rx, notices))?;
    Ok((Sfu { addr, cmds }, notices_rx))
}

impl Sfu {
    pub fn add(&self, room: u64, user_id: u64, sdp_offer: &str) -> anyhow::Result<(u64, String)> {
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
            user_id,
            rtc: Box::new(rtc),
            requested_at,
        })?;
        Ok((peer_id, answer.to_sdp_string()))
    }

    pub fn remove(&self, peer_id: u64) {
        let _ = self.cmds.send(Cmd::Remove { peer_id });
    }

    /// Share Play: the one input route of a room (controller peer, host peer).
    pub fn route(&self, room: u64, revision: u64, route: Option<Route>) {
        let _ = self.cmds.send(Cmd::Route {
            room,
            revision,
            route,
        });
    }
}

fn run(
    socket: UdpSocket,
    cmds: Receiver<Cmd>,
    notices: tokio::sync::mpsc::UnboundedSender<Notice>,
) {
    let mut routes: HashMap<u64, RouteSlot> = HashMap::new();
    let local = socket.local_addr().expect("socket address");
    let mut peers: Vec<Peer> = Vec::new();
    let mut buf = vec![0u8; 2000];
    // Room id -> when its first peer joined.
    let mut rooms: HashMap<u64, Instant> = HashMap::new();
    let mut roster: HashMap<u64, Vec<(u64, u64)>> = HashMap::new();
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
                    user_id,
                    rtc,
                    requested_at,
                } => {
                    tracing::info!(peer.id = peer_id, room.id = room, "peer added");
                    rooms.entry(room).or_insert(requested_at);
                    roster.entry(room).or_default().push((peer_id, user_id));
                    peers.push(Peer {
                        id: peer_id,
                        room,
                        user_id,
                        rtc: *rtc,
                        channels: HashMap::new(),
                        limiter: RateLimit::new(requested_at),
                        audio: None,
                        negotiated_audio: AudioNegotiation::default(),
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
                Cmd::Route {
                    room,
                    revision,
                    route,
                } => routes.entry(room).or_default().update(revision, route),
            }
        }
        if joined {
            record_membership(&peers, &rooms);
        }

        let mut forward: Vec<(u64, u64, Source, MediaData)> = Vec::new();
        let mut keyframes: Vec<(u64, u64, KeyframeRequestKind)> = Vec::new();
        // (room, grant, host peer, label, tagged payload)
        let mut relay: Vec<(u64, u64, u64, String, Vec<u8>)> = Vec::new();
        let mut failed: Vec<(u64, u64)> = Vec::new();
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
                            MediaKind::Audio => {
                                p.audio.get_or_insert(m.mid);
                            }
                            MediaKind::Video => p.video = Some(m.mid),
                        },
                        Event::MediaData(d) => {
                            if let Some(at) = p.awaiting_media.take() {
                                metrics::histogram!(m::JOIN_LATENCY_MS)
                                    .record(at.elapsed().as_secs_f64() * 1000.0);
                            }
                            let source = if Some(d.mid) == p.audio {
                                Source::Voice
                            } else if Some(d.mid) == p.negotiated_audio.screen_input {
                                Source::ScreenAudio
                            } else if Some(d.mid) == p.video {
                                Source::Video
                            } else {
                                continue;
                            };
                            if matches!(source, Source::Voice)
                                || routes
                                    .get(&p.room)
                                    .and_then(|s| s.active)
                                    .is_none_or(|r| r.host == p.id)
                            {
                                forward.push((p.id, p.room, source, d));
                            }
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
                        Event::ChannelOpen(id, label) => {
                            if label == AUDIO_SIGNAL {
                                let valid = p
                                    .rtc
                                    .channel(id)
                                    .and_then(|c| c.config().cloned())
                                    .is_some_and(|c| {
                                        c.ordered && matches!(c.reliability, Reliability::Reliable)
                                    });
                                if !valid || p.negotiated_audio.channel.replace(id).is_some() {
                                    p.end("invalid_audio_channel");
                                }
                                continue;
                            }
                            if !is_relayed(&label) {
                                continue;
                            }
                            let valid = p
                                .rtc
                                .channel(id)
                                .and_then(|c| c.config().cloned())
                                .is_some_and(|c| {
                                    label != RELIABLE
                                        || (c.ordered
                                            && matches!(c.reliability, Reliability::Reliable))
                                });
                            if !valid || p.channels.contains_key(&label) {
                                p.end("invalid_input_channel");
                                continue;
                            }
                            p.channels.insert(label, id);
                        }
                        Event::ChannelClose(id) => {
                            if p.negotiated_audio.channel == Some(id) {
                                p.end("audio_channel_closed");
                            }
                            if p.channels.get(RELIABLE) == Some(&id) {
                                if let Some(r) = routes
                                    .get(&p.room)
                                    .and_then(|s| s.active)
                                    .filter(|r| r.controller == p.id || r.host == p.id)
                                {
                                    failed.push((p.room, r.grant));
                                }
                            }
                            p.channels.retain(|_, c| *c != id);
                        }
                        Event::ChannelData(d) => {
                            if p.negotiated_audio.channel == Some(d.id) {
                                if let Err(error) =
                                    p.negotiated_audio.accept_answer(&mut p.rtc, &d.data)
                                {
                                    tracing::warn!(peer.id = p.id, %error, "invalid audio answer");
                                    p.end("invalid_audio_answer");
                                }
                                continue;
                            }
                            let Some(label) = p
                                .channels
                                .iter()
                                .find(|(_, c)| **c == d.id)
                                .map(|(l, _)| l.clone())
                                .filter(|l| is_relayed(l))
                            else {
                                continue;
                            };
                            let route = routes.get(&p.room).and_then(|s| s.active);
                            let Some(data) = input_for_grant(route, &d.data) else {
                                continue;
                            };
                            let allowed = route.is_some_and(|r| r.controller == p.id)
                                && p.limiter.allow(Instant::now());
                            match (route, relay_decision(route, p.id, &label, data, allowed)) {
                                (Some(r), Relay::To(host)) => relay.push((
                                    p.room,
                                    r.grant,
                                    host,
                                    label,
                                    tag(p.user_id, r.grant, data),
                                )),
                                (Some(r), Relay::Fail) => failed.push((p.room, r.grant)),
                                _ => {}
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

        for p in peers
            .iter_mut()
            .filter(|p| p.rtc.is_alive() && p.negotiated_audio.channel.is_some())
        {
            if let Err(error) =
                p.negotiated_audio
                    .sync(&mut p.rtc, p.id, &roster[&p.room], Instant::now())
            {
                tracing::warn!(peer.id = p.id, %error, "could not negotiate audio tracks");
                p.end("audio_negotiation_failed");
            }
        }

        for (from, room, kind, data) in &forward {
            for p in peers
                .iter_mut()
                .filter(|p| p.id != *from && p.room == *room && p.rtc.is_alive())
            {
                let tracks = p.negotiated_audio.tracks.get(from);
                let legacy_peer = roster
                    .get(room)
                    .and_then(|peers| peers.iter().find(|(id, _)| *id != p.id));
                let (mid, label) = match kind {
                    Source::Voice if p.negotiated_audio.channel.is_none() => (
                        p.audio
                            .filter(|_| legacy_peer.is_some_and(|(id, _)| id == from)),
                        "audio",
                    ),
                    Source::Voice => (tracks.map(|tracks| tracks.voice), "audio"),
                    Source::ScreenAudio => (tracks.map(|tracks| tracks.screen), "screen_audio"),
                    Source::Video => (p.video, "video"),
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

        for (room, grant, host, label, data) in &relay {
            if failed.contains(&(*room, *grant)) {
                continue;
            }
            let written = peers
                .iter_mut()
                .find(|p| p.id == *host && p.room == *room)
                .and_then(|p| {
                    let id = *p.channels.get(label)?;
                    // Ok(false) = str0m couldn't buffer it: as bad as an error.
                    p.rtc.channel(id)?.write(true, data).ok()
                })
                .unwrap_or(false);
            if !written && label == RELIABLE {
                failed.push((*room, *grant));
            }
        }
        failed.sort_unstable();
        failed.dedup();
        for (room, grant) in failed {
            let Some(slot) = routes.get_mut(&room) else {
                continue;
            };
            if slot.active.is_some_and(|r| r.grant == grant) {
                slot.close();
                tracing::warn!(room.id = room, grant, "share play route failed");
                let _ = notices.send(Notice::RouteFailed { room, grant });
            }
        }

        if peers.iter().any(|p| !p.rtc.is_alive()) {
            let (gone, alive): (Vec<Peer>, Vec<Peer>) =
                peers.into_iter().partition(|p| !p.rtc.is_alive());
            peers = alive;
            for p in gone {
                if let Some(members) = roster.get_mut(&p.room) {
                    members.retain(|(id, _)| *id != p.id);
                    if members.is_empty() {
                        roster.remove(&p.room);
                    }
                }
                let reason = p.end_reason.unwrap_or("closed");
                tracing::info!(peer.id = p.id, reason, "peer removed");
                for slot in routes.values_mut() {
                    if slot
                        .active
                        .is_some_and(|r| r.controller == p.id || r.host == p.id)
                    {
                        slot.close();
                    }
                }
                if reason != "left" {
                    let _ = notices.send(Notice::PeerGone { peer_id: p.id });
                }
                metrics::counter!(m::PEER_SESSIONS_ENDED, "reason" => reason).increment(1);
                if !peers.iter().any(|o| o.room == p.room) {
                    routes.remove(&p.room);
                }
                if !peers.iter().any(|o| o.room == p.room)
                    && let Some(started) = rooms.remove(&p.room)
                {
                    metrics::histogram!(m::CALL_DURATION_S, "reason" => reason)
                        .record(started.elapsed().as_secs_f64());
                }
            }
            record_membership(&peers, &rooms);
        }
        if !forward.is_empty() || !keyframes.is_empty() || !relay.is_empty() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_clears_and_installs_cannot_replace_newer_routes() {
        let mut slot = RouteSlot::default();
        slot.update(2, route(50));
        slot.update(1, None);
        assert_eq!(slot.active, route(50));
        slot.update(4, None);
        slot.update(3, route(60));
        assert_eq!(slot.active, None);
        slot.update(5, route(70));
        assert_eq!(slot.active, route(70));
    }

    #[test]
    fn input_is_bound_to_its_original_grant() {
        let mut packet = 50u64.to_be_bytes().to_vec();
        packet.extend_from_slice(br#"{"t":"ping"}"#);
        assert_eq!(input_for_grant(route(50), &packet), Some(&packet[8..]));
        assert_eq!(input_for_grant(route(60), &packet), None);
        assert_eq!(input_for_grant(None, &packet), None);
        assert_eq!(input_for_grant(route(50), &[0; 7]), None);
    }

    #[test]
    fn relays_only_input_channels() {
        assert!(is_relayed("input"));
        assert!(is_relayed("input-move"));
        assert!(!is_relayed("chat"));
    }

    const NOW_ROUTE: Option<Route> = Some(Route {
        controller: 2,
        host: 1,
        grant: 50,
    });
    const MOVE: &[u8] = br#"{"t":"move","x":0.5,"y":0.5}"#;
    const KEY: &[u8] = br#"{"t":"key","code":"KeyW","down":true}"#;

    #[test]
    fn only_the_granted_controller_reaches_only_its_host() {
        assert_eq!(
            relay_decision(NOW_ROUTE, 2, RELIABLE, KEY, true),
            Relay::To(1)
        );
        assert_eq!(
            relay_decision(NOW_ROUTE, 2, LATEST, MOVE, true),
            Relay::To(1)
        );
        assert_eq!(
            relay_decision(NOW_ROUTE, 3, RELIABLE, KEY, true),
            Relay::Drop,
            "bystander"
        );
        assert_eq!(
            relay_decision(NOW_ROUTE, 1, RELIABLE, KEY, true),
            Relay::Drop,
            "host"
        );
        assert_eq!(
            relay_decision(None, 2, RELIABLE, KEY, true),
            Relay::Drop,
            "pending/no grant"
        );
        assert_eq!(
            relay_decision(NOW_ROUTE, 2, "input-x", KEY, true),
            Relay::Drop
        );
    }

    #[test]
    fn oversize_or_rate_limited_input_breaks_the_reliable_route() {
        assert_eq!(
            relay_decision(NOW_ROUTE, 2, RELIABLE, &[b'x'; MAX_INPUT_BYTES + 1], true),
            Relay::Fail
        );
        assert_eq!(
            relay_decision(NOW_ROUTE, 2, RELIABLE, KEY, false),
            Relay::Fail
        );
        assert_eq!(
            relay_decision(NOW_ROUTE, 2, LATEST, MOVE, false),
            Relay::Drop,
            "moves are lossy"
        );
    }

    #[test]
    fn rate_limit_refills() {
        let t0 = Instant::now();
        let mut r = RateLimit::new(t0);
        let sent = (0..1000).filter(|_| r.allow(t0)).count();
        assert_eq!(sent, INPUT_BURST as usize);
        assert!(!r.allow(t0));
        assert!(
            r.allow(t0 + Duration::from_millis(10)),
            "2 tokens after 10 ms"
        );
    }

    #[test]
    fn tag_prefixes_sender() {
        assert_eq!(
            tag(0x0102, 0x03, b"hi"),
            [0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 3, b'h', b'i']
        );
    }

    #[test]
    fn lossy_channel_carries_moves_only() {
        assert_eq!(
            relay_decision(NOW_ROUTE, 2, LATEST, MOVE, true),
            Relay::To(1)
        );
        for bad in [
            KEY,
            br#"{"t":"button","b":0,"down":true,"x":0,"y":0}"#.as_slice(),
            br#"{"t":"ping"}"#,
            br#" {"t":"move","x":0,"y":0}"#,
        ] {
            assert_eq!(relay_decision(NOW_ROUTE, 2, LATEST, bad, true), Relay::Drop);
        }
        assert_eq!(
            relay_decision(NOW_ROUTE, 2, RELIABLE, KEY, true),
            Relay::To(1),
            "keys go on the reliable channel"
        );
    }

    fn route(grant: u64) -> Option<Route> {
        Some(Route {
            controller: 2,
            host: 1,
            grant,
        })
    }

    #[test]
    fn closed_grant_never_reopens() {
        let mut slot = RouteSlot::default();
        slot.set(route(50));
        assert_eq!(slot.active, route(50));
        // The route failed: SFU closes grant 50.
        assert_eq!(slot.close(), route(50));
        // A late update for 50 (sent before the failure) arrives now.
        slot.set(route(50));
        assert_eq!(slot.active, None, "stale update can't undo the failure");
        // An api clear also closes; older grants stay dead.
        slot.set(route(60));
        slot.set(None);
        slot.set(route(55));
        slot.set(route(60));
        assert_eq!(slot.active, None);
        // A newer grant opens, an older one can't replace it.
        slot.set(route(70));
        slot.set(route(65));
        assert_eq!(slot.active, route(70));
        // A newer grant replaces and closes the old one.
        slot.set(route(80));
        slot.set(route(70));
        assert_eq!(slot.active, route(80));
        slot.set(route(0));
        assert_eq!(slot.active, route(80), "grant 0 is never a route");
    }
}
