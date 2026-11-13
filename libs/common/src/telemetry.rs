use tracing_subscriber::{EnvFilter, fmt};

/// Logs to stdout. Level via `RUST_LOG` (default `info`).
/// Set `LOG_FORMAT=json` for structured logs in production.
pub fn init(service: &str) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    if std::env::var("LOG_FORMAT").as_deref() == Ok("json") {
        fmt().with_env_filter(filter).json().init();
    } else {
        fmt().with_env_filter(filter).init();
    }
    tracing::info!(service, "telemetry initialised");
}
