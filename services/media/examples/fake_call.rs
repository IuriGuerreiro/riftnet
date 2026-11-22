use std::net::UdpSocket;
use std::time::{Duration, Instant};

use protocol::Message;
use protocol::v1::{MediaJoin, MediaJoinReply, MediaLeave};
use str0m::change::SdpAnswer;
use str0m::media::{Direction, Frequency, MediaKind, MediaTime};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, Input, Output, Rtc};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    str0m::crypto::from_feature_flags().install_process_default();
    let args: Vec<String> = std::env::args().collect();
    let peers: usize = args.get(1).map_or(Ok(2), |s| s.parse())?;
    let secs: u64 = args.get(2).map_or(Ok(10), |s| s.parse())?;
    let room: u64 = args.get(3).map_or_else(|| Ok(rand_room()), |s| s.parse())?;
    let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://127.0.0.1:4222".into());
    let nats = async_nats::connect(nats_url).await?;

    let mut threads = Vec::new();
    let mut ids = Vec::new();
    for _ in 0..peers {
        let socket = UdpSocket::bind("127.0.0.1:0")?;
        let mut rtc = Rtc::builder().build(Instant::now());
        rtc.add_local_candidate(Candidate::host(socket.local_addr()?, "udp")?);
        let mut api = rtc.sdp_api();
        let mid = api.add_media(MediaKind::Audio, Direction::SendRecv, None, None, None);
        let (offer, pending) = api.apply().expect("offer");

        let req = MediaJoin {
            room_id: room,
            sdp_offer: offer.to_sdp_string(),
            user_id: 0,
        };
        let msg = nats
            .request("media.join", req.encode_to_vec().into())
            .await?;
        let reply = MediaJoinReply::decode(msg.payload)?;
        anyhow::ensure!(reply.error.is_empty(), "join failed: {}", reply.error);
        rtc.sdp_api()
            .accept_answer(pending, SdpAnswer::from_sdp_string(&reply.sdp_answer)?)?;
        ids.push(reply.peer_id);
        threads.push(std::thread::spawn(move || {
            drive(socket, rtc, mid, Duration::from_secs(secs))
        }));
    }
    println!("room {room}: {peers} peers joined");
    for t in threads {
        let received = t.join().expect("peer thread");
        println!("peer got {received} frames");
    }
    for id in ids {
        nats.publish(
            "media.leave",
            MediaLeave { peer_id: id }.encode_to_vec().into(),
        )
        .await?;
    }
    nats.flush().await?;
    Ok(())
}

fn drive(socket: UdpSocket, mut rtc: Rtc, mid: str0m::media::Mid, run_for: Duration) -> u64 {
    let local = socket.local_addr().unwrap();
    let start = Instant::now();
    let mut buf = vec![0u8; 2000];
    let mut connected = false;
    let mut next_frame = Instant::now();
    let mut ts: u64 = 0;
    let mut received = 0;
    while start.elapsed() < run_for && rtc.is_alive() {
        if connected && Instant::now() >= next_frame {
            if let Some(w) = rtc.writer(mid) {
                let pt = w.payload_params().next().map(|p| p.pt());
                if let Some(pt) = pt {
                    let t = MediaTime::new(ts, Frequency::FORTY_EIGHT_KHZ);
                    let _ = w.write(pt, Instant::now(), t, vec![0xF8u8; 80]);
                }
            }
            ts += 960;
            next_frame += Duration::from_millis(20);
        }
        let timeout = loop {
            match rtc.poll_output() {
                Ok(Output::Transmit(t)) => {
                    let _ = socket.send_to(&t.contents, t.destination);
                }
                Ok(Output::Timeout(t)) => break t,
                Ok(Output::Event(Event::Connected)) => connected = true,
                Ok(Output::Event(Event::MediaData(_))) => received += 1,
                Ok(Output::Event(_)) => {}
                Err(_) => return received,
            }
        };
        let wait = timeout
            .min(next_frame)
            .saturating_duration_since(Instant::now())
            .max(Duration::from_millis(1));
        socket.set_read_timeout(Some(wait)).unwrap();
        let input = match socket.recv_from(&mut buf) {
            Ok((n, source)) => match buf[..n].try_into() {
                Ok(contents) => Input::Receive(
                    Instant::now(),
                    Receive {
                        proto: Protocol::Udp,
                        source,
                        destination: local,
                        contents,
                    },
                ),
                Err(_) => continue,
            },
            Err(_) => Input::Timeout(Instant::now()),
        };
        if rtc.handle_input(input).is_err() {
            break;
        }
    }
    received
}

fn rand_room() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64
}
