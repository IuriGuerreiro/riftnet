use std::time::Duration;

use anyhow::{Context, bail};
use async_trait::async_trait;
use protocol::Message;
use protocol::v1::{MediaJoin, MediaJoinReply, MediaLeave};

const JOIN: &str = "media.join";
const LEAVE: &str = "media.leave";
const TIMEOUT: Duration = Duration::from_secs(5);

#[async_trait]
pub trait MediaClient: Send + Sync {
    async fn join(&self, room_id: i64, sdp_offer: String) -> anyhow::Result<(u64, String)>;
    async fn leave(&self, peer_id: u64) -> anyhow::Result<()>;
}

pub struct NatsMediaClient {
    client: async_nats::Client,
}

impl NatsMediaClient {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        Ok(Self {
            client: async_nats::connect(url).await?,
        })
    }
}

#[async_trait]
impl MediaClient for NatsMediaClient {
    #[tracing::instrument(name = "media join", skip_all, err(Display), fields(otel.kind = "client", messaging.system = "nats", room.id = room_id))]
    async fn join(&self, room_id: i64, sdp_offer: String) -> anyhow::Result<(u64, String)> {
        let req = MediaJoin {
            room_id: room_id as u64,
            sdp_offer,
        };
        let msg = tokio::time::timeout(
            TIMEOUT,
            self.client.request(JOIN, req.encode_to_vec().into()),
        )
        .await
        .context("media server timed out")?
        .context("media server unreachable")?;
        let reply = MediaJoinReply::decode(msg.payload).context("bad reply from media server")?;
        if !reply.error.is_empty() {
            bail!("media server: {}", reply.error);
        }
        Ok((reply.peer_id, reply.sdp_answer))
    }

    async fn leave(&self, peer_id: u64) -> anyhow::Result<()> {
        let req = MediaLeave { peer_id };
        self.client
            .publish(LEAVE, req.encode_to_vec().into())
            .await?;
        Ok(())
    }
}
