//! Live events between api servers, via NATS.
//!
//! Each connected socket subscribes to `user.<user_id>`. To reach someone,
//! publish to their subject: NATS delivers it to every api server where they
//! have a socket open (all their devices), and those push it down the socket.
//!
//! The payload is a ready-to-send `Envelope` (protobuf bytes), so sockets
//! forward it without decoding.

use async_trait::async_trait;
use bytes::Bytes;
use futures::StreamExt;
use futures::stream::BoxStream;

#[async_trait]
pub trait EventBus: Send + Sync {
    /// Sends `payload` to every open socket of each user.
    async fn publish_to_users(&self, user_ids: &[i64], payload: Bytes) -> anyhow::Result<()>;
    /// Everything published to `user_id`, as it arrives.
    async fn subscribe_user(&self, user_id: i64) -> anyhow::Result<BoxStream<'static, Bytes>>;
}

pub struct NatsEventBus {
    client: async_nats::Client,
}

impl NatsEventBus {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        Ok(Self {
            client: async_nats::connect(url).await?,
        })
    }
}

fn user_subject(user_id: i64) -> String {
    format!("user.{user_id}")
}

#[async_trait]
impl EventBus for NatsEventBus {
    #[tracing::instrument(name = "nats publish", skip_all, err(Display), fields(otel.kind = "producer", messaging.system = "nats", users = user_ids.len()))]
    async fn publish_to_users(&self, user_ids: &[i64], payload: Bytes) -> anyhow::Result<()> {
        for id in user_ids {
            // Bytes clones are cheap (shared buffer, no copy).
            self.client
                .publish(user_subject(*id), payload.clone())
                .await?;
        }
        self.client.flush().await?;
        Ok(())
    }

    async fn subscribe_user(&self, user_id: i64) -> anyhow::Result<BoxStream<'static, Bytes>> {
        let sub = self.client.subscribe(user_subject(user_id)).await?;
        // When the stream is dropped (socket closed), NATS unsubscribes.
        Ok(sub.map(|msg| msg.payload).boxed())
    }
}
