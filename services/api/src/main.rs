mod app;
mod common;
mod config;
mod features;

use std::net::SocketAddr;

use metrics_exporter_prometheus::{Matcher, PrometheusBuilder};

use crate::common::middleware::http_metrics;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env before telemetry so OTEL_* and APP_ENV from it apply.
    let _ = dotenvy::dotenv();
    let mut telemetry = ::common::telemetry::init("api", env!("CARGO_PKG_VERSION"));
    let config = config::Config::from_env()?;

    // `/metrics` (Prometheus) always; OTLP too when enabled.
    let prometheus = PrometheusBuilder::new()
        .set_buckets_for_metric(
            Matcher::Full(http_metrics::REQUEST_DURATION.into()),
            http_metrics::DURATION_BUCKETS,
        )?
        .build_recorder();
    let prometheus_handle = prometheus.handle();
    telemetry.install_metrics(prometheus)?;

    let app = app::build(&config, prometheus_handle).await?;

    tracing::info!(addr = %config.addr, "api listening");
    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    tracing::info!("api stopped");
    telemetry.shutdown();
    Ok(())
}

/// Ctrl+C or SIGTERM: stop accepting requests, then flush telemetry.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = term => {},
    }
}
