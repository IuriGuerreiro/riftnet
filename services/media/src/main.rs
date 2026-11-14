#[tokio::main]
async fn main() {
    let _telemetry = common::telemetry::init("media", env!("CARGO_PKG_VERSION"));
    tracing::warn!("media server not implemented yet (SFU via str0m)");
}
