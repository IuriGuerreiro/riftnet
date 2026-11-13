mod app;
mod common;
mod config;
mod features;

use std::net::SocketAddr;

use metrics_exporter_prometheus::PrometheusBuilder;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    ::common::telemetry::init("api");
    let config = config::Config::from_env()?;
    let prometheus = PrometheusBuilder::new().install_recorder()?;

    let app = app::build(&config, prometheus).await?;

    tracing::info!(addr = %config.addr, "api listening");
    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
