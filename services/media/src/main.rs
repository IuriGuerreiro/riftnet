#[tokio::main]
async fn main() {
    common::telemetry::init("media");
    tracing::warn!("media server not implemented yet (SFU via str0m)");
}
