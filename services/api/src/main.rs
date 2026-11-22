use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use metrics_exporter_prometheus::{Matcher, PrometheusBuilder};

use api::common::middleware::http_metrics;
use api::common::shutdown::Shutdown;
use api::{app, config};

const DRAIN_LIMIT: Duration = Duration::from_secs(10);

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // WARN: load .env before telemetry so OTEL_* and APP_ENV apply.
    let _ = dotenvy::dotenv();
    let mut telemetry = ::common::telemetry::init("api", env!("CARGO_PKG_VERSION"));
    let config = config::Config::from_env()?;
    if !config.rate_limits {
        tracing::warn!(
            "!!! RATE_LIMITS=off: ALL rate limits and the per-user socket cap are DISABLED. Load tests only, never production. !!!"
        );
    }

    let prometheus = PrometheusBuilder::new()
        .set_buckets_for_metric(
            Matcher::Full(http_metrics::REQUEST_DURATION.into()),
            http_metrics::DURATION_BUCKETS,
        )?
        .set_buckets_for_metric(
            Matcher::Prefix("auth_".into()),
            http_metrics::DURATION_BUCKETS,
        )?
        .build_recorder();
    let prometheus_handle = prometheus.handle();
    telemetry.install_metrics(prometheus)?;

    let shutdown = Arc::new(Shutdown::default());
    let app = app::build(&config, prometheus_handle, shutdown.clone()).await?;

    tracing::info!(addr = %config.addr, "api listening");
    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown({
        let shutdown = shutdown.clone();
        async move {
            shutdown_signal().await;
            tracing::info!("shutdown signal received, draining");
            shutdown.trigger();
        }
    })
    .await?;

    let left = shutdown.drained(DRAIN_LIMIT).await;
    if left > 0 {
        tracing::warn!(sockets = left, "drain timed out, closing anyway");
    }

    tracing::info!("api stopped");
    telemetry.shutdown();
    Ok(())
}

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
