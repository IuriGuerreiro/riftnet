//! Media server metric names and recorder setup.
//!
//! Labels stay low-cardinality: only `kind` (audio, video, pli, fir) and `reason`.
//! Never add user, peer, room or call IDs.

use metrics_exporter_prometheus::{
    Matcher, PrometheusBuilder, PrometheusHandle, PrometheusRecorder,
};

pub const ROOMS: &str = "media_rooms";
pub const PEERS: &str = "media_peers";
/// `media.join` request received -> first media from that peer.
pub const JOIN_LATENCY_MS: &str = "media_join_latency_ms";
/// Media frames written to a receiver, by `kind`.
pub const FORWARDED: &str = "media_packets_forwarded_total";
/// Frames not forwarded to a receiver, by `kind` and `reason`.
pub const FORWARD_DROPPED: &str = "media_forward_dropped_total";
/// RTP packets and bytes from str0m stats, by `kind`.
pub const RTP_PACKETS_IN: &str = "media_rtp_packets_in_total";
pub const RTP_PACKETS_OUT: &str = "media_rtp_packets_out_total";
pub const RTP_BYTES_IN: &str = "media_rtp_bytes_in_total";
pub const RTP_BYTES_OUT: &str = "media_rtp_bytes_out_total";
/// Loss we see on media from a peer, by `kind`.
pub const INGRESS_LOSS_PERCENT: &str = "media_ingress_loss_percent";
/// Loss a peer reports on media we send it, by `kind`.
pub const EGRESS_LOSS_PERCENT: &str = "media_egress_loss_percent";
/// Jitter a peer reports on media we send it, by `kind`.
pub const EGRESS_JITTER_MS: &str = "media_egress_jitter_ms";
pub const PEER_RTT_MS: &str = "media_peer_rtt_ms";
/// PLI/FIR requests from receivers, by `kind` (pli, fir).
pub const KEYFRAME_REQUESTS: &str = "media_keyframe_requests_total";
/// Work time of one SFU loop pass, socket wait excluded.
pub const LOOP_ITERATION_US: &str = "media_sfu_loop_iteration_us";
/// Share of wall time the SFU thread spends working (0..1). Near 1 = saturated.
pub const LOOP_BUSY_RATIO: &str = "media_sfu_loop_busy_ratio";
/// Peer sessions ended, by `reason`.
pub const PEER_SESSIONS_ENDED: &str = "media_peer_sessions_ended_total";
/// Room lifetime (first peer in -> last peer out), by end `reason` of the last peer.
pub const CALL_DURATION_S: &str = "media_call_duration_seconds";

const MS: &[f64] = &[
    1.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2500.0, 5000.0, 10000.0,
];
const US: &[f64] = &[
    5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2500.0, 5000.0, 10000.0, 50000.0,
];
const PERCENT: &[f64] = &[0.0, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0];
const SECONDS: &[f64] = &[
    10.0, 30.0, 60.0, 300.0, 900.0, 1800.0, 3600.0, 7200.0, 14400.0,
];

pub fn recorder() -> anyhow::Result<(PrometheusRecorder, PrometheusHandle)> {
    let mut b = PrometheusBuilder::new();
    for (name, buckets) in [
        (JOIN_LATENCY_MS, MS),
        (EGRESS_JITTER_MS, MS),
        (PEER_RTT_MS, MS),
        (LOOP_ITERATION_US, US),
        (INGRESS_LOSS_PERCENT, PERCENT),
        (EGRESS_LOSS_PERCENT, PERCENT),
        (CALL_DURATION_S, SECONDS),
    ] {
        b = b.set_buckets_for_metric(Matcher::Full(name.into()), buckets)?;
    }
    let recorder = b.build_recorder();
    let handle = recorder.handle();
    Ok((recorder, handle))
}

/// Minimal `GET /metrics` endpoint (Prometheus text) for local checks.
pub async fn serve(addr: std::net::SocketAddr, handle: PrometheusHandle) -> anyhow::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "media metrics listening");
    loop {
        let (mut conn, _) = listener.accept().await?;
        let handle = handle.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            let _ = conn.read(&mut buf).await;
            let body = handle.render();
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/plain; version=0.0.4\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                body.len()
            );
            let _ = conn.write_all(head.as_bytes()).await;
            let _ = conn.write_all(body.as_bytes()).await;
        });
    }
}
