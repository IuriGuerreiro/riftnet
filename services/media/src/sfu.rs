//! The forwarding loop. One thread, one UDP socket, one str0m `Rtc` per device.
//!
//! Each device offers one two-way ("sendrecv") audio track. Every Opus packet
//! from one device is written into the track of every other device in the same
//! room. Nothing is decoded.
//!
//! Limit: rooms of 2 (1:1 calls). 3+ people need renegotiation: the SFU must
//! add a track per other person. See docs/architecture/calls.md.

use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use str0m::change::SdpOffer;
use str0m::media::{MediaData, Mid};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};

/// Handle to the loop thread. Cheap to share.
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
    },
    Remove {
        peer_id: u64,
    },
}

struct Peer {
    id: u64,
    room: u64,
    rtc: Rtc,
    /// The audio track. The same mid sends and receives.
    mid: Option<Mid>,
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
    /// Adds a device to `room`. Returns its peer id and the SDP answer.
    pub fn add(&self, room: u64, sdp_offer: &str) -> anyhow::Result<(u64, String)> {
        let offer = SdpOffer::from_sdp_string(sdp_offer)?;
        // Full ICE, not ICE-lite: lite picked the wrong path on machines with
        // several network interfaces (see spikes/sfu-audio/README.md).
        let mut rtc = Rtc::builder().build(Instant::now());
        rtc.add_local_candidate(Candidate::host(self.addr, "udp")?);
        let answer = rtc.sdp_api().accept_offer(offer)?;

        let peer_id = NEXT_PEER.fetch_add(1, Ordering::Relaxed);
        self.cmds.send(Cmd::Add {
            peer_id,
            room,
            rtc: Box::new(rtc),
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

    loop {
        // 1. Joins and leaves from the control plane.
        while let Ok(cmd) = cmds.try_recv() {
            match cmd {
                Cmd::Add { peer_id, room, rtc } => {
                    tracing::info!(peer.id = peer_id, room.id = room, "peer added");
                    peers.push(Peer {
                        id: peer_id,
                        room,
                        rtc: *rtc,
                        mid: None,
                    });
                }
                Cmd::Remove { peer_id } => {
                    if let Some(p) = peers.iter_mut().find(|p| p.id == peer_id) {
                        p.rtc.disconnect();
                    }
                }
            }
        }

        // 2. Drain each peer: send its packets, collect audio to forward.
        let mut forward: Vec<(u64, u64, MediaData)> = Vec::new();
        let mut next_timeout = Instant::now() + Duration::from_millis(100);
        for p in &mut peers {
            while p.rtc.is_alive() {
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
                        Event::MediaData(d) => forward.push((p.id, p.room, d)),
                        Event::Connected => tracing::info!(peer.id = p.id, "peer connected"),
                        Event::IceConnectionStateChange(IceConnectionState::Disconnected) => {
                            p.rtc.disconnect()
                        }
                        _ => {}
                    },
                    Err(e) => {
                        tracing::warn!(peer.id = p.id, error = ?e, "peer failed");
                        p.rtc.disconnect();
                    }
                }
            }
        }

        // 3. Forward each packet to everyone else in the same room.
        for (from, room, data) in &forward {
            for p in peers
                .iter_mut()
                .filter(|p| p.id != *from && p.room == *room)
            {
                let Some(mid) = p.mid else { continue };
                let Some(writer) = p.rtc.writer(mid) else {
                    continue;
                };
                let Some(pt) = writer.match_params(data.params) else {
                    continue;
                };
                if let Err(e) = writer.write(pt, data.network_time, data.time, data.data.clone()) {
                    tracing::warn!(peer.id = p.id, error = ?e, "forward failed");
                }
            }
        }
        if !forward.is_empty() {
            metrics::counter!("media_packets_forwarded_total").increment(forward.len() as u64);
        }

        // 4. Drop dead peers.
        let before = peers.len();
        peers.retain(|p| {
            if !p.rtc.is_alive() {
                tracing::info!(peer.id = p.id, "peer removed");
            }
            p.rtc.is_alive()
        });
        if peers.len() != before || !forward.is_empty() {
            metrics::gauge!("media_peers").set(peers.len() as f64);
        }
        if !forward.is_empty() {
            continue; // send what we just wrote right away
        }

        // 5. Wait for one UDP packet (or the next timer).
        let wait = next_timeout
            .saturating_duration_since(Instant::now())
            .clamp(Duration::from_millis(1), Duration::from_millis(100));
        socket
            .set_read_timeout(Some(wait))
            .expect("set read timeout");
        if let Ok((n, source)) = socket.recv_from(&mut buf)
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
            // `accepts` finds which peer this packet belongs to.
            if let Some(p) = peers.iter_mut().find(|p| p.rtc.accepts(&input))
                && p.rtc.handle_input(input).is_err()
            {
                p.rtc.disconnect();
            }
        }

        // 6. Tick every peer's clock (keepalives, retransmits...).
        let now = Instant::now();
        for p in peers.iter_mut().filter(|p| p.rtc.is_alive()) {
            if p.rtc.handle_input(Input::Timeout(now)).is_err() {
                p.rtc.disconnect();
            }
        }
    }
}
