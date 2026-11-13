mod ws;

use axum::{Router, routing::get};
use metrics_exporter_prometheus::PrometheusBuilder;
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    common::telemetry::init("api");

    let prometheus = PrometheusBuilder::new().install_recorder()?;

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route(
            "/metrics",
            get(move || std::future::ready(prometheus.render())),
        )
        .route("/ws", get(ws::handler));

    let addr: SocketAddr = std::env::var("API_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:7100".into())
        .parse()?;
    tracing::info!(%addr, "api listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
