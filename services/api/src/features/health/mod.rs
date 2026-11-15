use axum::Router;
use axum::routing::get;
use metrics_exporter_prometheus::PrometheusHandle;

use crate::app::AppState;

pub fn routes(prometheus: PrometheusHandle) -> Router<AppState> {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route(
            "/metrics",
            get(move || std::future::ready(prometheus.render())),
        )
}
