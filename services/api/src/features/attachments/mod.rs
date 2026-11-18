//! File attachments: chunked upload with BLAKE3 checks, members-only
//! download links, and a cleanup job for expired files.

mod controller;
pub mod dto;
pub mod models;
pub mod repository;
pub mod service;

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post, put};

use crate::app::AppState;
use models::CHUNK_SIZE;
use service::AttachmentService;

pub use controller::CHUNK_HASH_HEADER;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/attachments", post(controller::start))
        .route(
            "/attachments/{id}/chunks/{idx}",
            // Axum's default 2 MB body limit is below one chunk.
            put(controller::put_chunk).layer(DefaultBodyLimit::max(CHUNK_SIZE as usize)),
        )
        .route("/attachments/{id}/complete", post(controller::complete))
        .route("/attachments/{id}", get(controller::download))
        .route("/attachments/{id}/preview", get(controller::preview))
}

/// Runs the cleanup every `every` until the process exits.
pub fn spawn_cleanup(service: Arc<AttachmentService>, every: Duration) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            match service.cleanup(chrono::Utc::now()).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(removed = n, "attachments cleanup"),
                Err(err) => tracing::warn!(error = %err, "attachments cleanup failed"),
            }
        }
    });
}
