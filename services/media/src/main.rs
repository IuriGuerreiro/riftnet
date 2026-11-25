mod control;
mod meter;
mod ready;
mod sfu;

use std::net::{IpAddr, UdpSocket};
use std::sync::{Arc, OnceLock};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let telemetry = common::telemetry::init("media", env!("CARGO_PKG_VERSION"));
    let (recorder, metrics_handle) = meter::recorder()?;
    telemetry.install_metrics(recorder)?;
    str0m::crypto::from_feature_flags().install_process_default();

    let nats_url = env_or("NATS_URL", "nats://127.0.0.1:4222");
    let ip: IpAddr = match std::env::var("MEDIA_IP") {
        Ok(ip) => ip.parse()?,
        Err(_) => lan_ip()?,
    };
    let port: u16 = env_or("MEDIA_PORT", "7110").parse()?;

    let socket = UdpSocket::bind((ip, port))?;
    tracing::info!(addr = %socket.local_addr()?, "media UDP listening");

    let metrics_addr: std::net::SocketAddr =
        env_or("MEDIA_METRICS_ADDR", "127.0.0.1:7111").parse()?;
    let nats_ready = Arc::new(OnceLock::new());
    let probe = nats_ready.clone();
    tokio::spawn(async move {
        if let Err(e) = meter::serve(metrics_addr, metrics_handle, probe).await {
            tracing::warn!(error = %e, "media metrics endpoint stopped");
        }
    });

    let (sfu, notices) = sfu::start(socket)?;
    let nats = common::nats::connect(&nats_url).await?;
    control::serve(nats, sfu, notices, nats_ready).await
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn lan_ip() -> anyhow::Result<IpAddr> {
    let s = UdpSocket::bind("0.0.0.0:0")?;
    s.connect("8.8.8.8:80")?;
    Ok(s.local_addr()?.ip())
}
