//! Per-request span + metrics. Labels use the route *template*
//! (`/me/username`), never the raw path, so cardinality stays low and no
//! ids or tokens end up in labels. Headers are never recorded.

use std::time::Instant;

use axum::extract::{MatchedPath, Request};
use axum::middleware::Next;
use axum::response::Response;
use tracing::{Instrument, field};

pub const REQUESTS_TOTAL: &str = "http_server_requests_total";
pub const REQUEST_DURATION: &str = "http_server_request_duration_seconds";

/// Bucket bounds (seconds) for [`REQUEST_DURATION`].
pub const DURATION_BUCKETS: &[f64] = &[
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

pub async fn track(req: Request, next: Next) -> Response {
    let method = req.method().as_str().to_owned();
    let route = route_label(req.extensions().get::<MatchedPath>());
    let span = tracing::info_span!(
        "http_request",
        otel.name = format!("{method} {route}"),
        otel.kind = "server",
        http.request.method = %method,
        http.route = %route,
        http.response.status_code = field::Empty,
        otel.status_code = field::Empty,
    );

    let start = Instant::now();
    let response = next.run(req).instrument(span.clone()).await;
    let elapsed = start.elapsed();
    let status = response.status();

    span.record("http.response.status_code", status.as_u16());
    if status.is_server_error() {
        span.record("otel.status_code", "ERROR");
    }
    span.in_scope(|| {
        tracing::info!(
            status = status.as_u16(),
            duration_ms = elapsed.as_secs_f64() * 1000.0,
            "request finished"
        );
    });

    let labels = [
        ("method", method),
        ("route", route),
        ("status", status.as_u16().to_string()),
    ];
    metrics::counter!(REQUESTS_TOTAL, &labels).increment(1);
    metrics::histogram!(REQUEST_DURATION, &labels).record(elapsed.as_secs_f64());
    response
}

fn route_label(matched: Option<&MatchedPath>) -> String {
    matched.map_or_else(|| "unmatched".to_owned(), |m| m.as_str().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_routes_share_one_label() {
        assert_eq!(route_label(None), "unmatched");
    }
}
