use std::time::Duration;

use anyhow::{Context, bail};
use async_trait::async_trait;
use futures::StreamExt;
use protocol::Message;
use protocol::v1::{MediaEvent, MediaEventKind, MediaJoin, MediaJoinReply, MediaLeave, MediaRoute};

const JOIN: &str = "media.join";
const LEAVE: &str = "media.leave";
const ROUTE: &str = "media.route";
const EVENT: &str = "media.event";
const TIMEOUT: Duration = Duration::from_secs(5);

#[async_trait]
pub trait MediaClient: Send + Sync {
    async fn join(
        &self,
        room_id: i64,
        user_id: i64,
        sdp_offer: String,
    ) -> anyhow::Result<(u64, String)>;
    async fn leave(&self, peer_id: u64) -> anyhow::Result<()>;
    /// Share Play: set (or clear with None) the one input route of a room.
    async fn route(
        &self,
        room_id: i64,
        revision: u64,
        route: Option<(u64, u64, u64)>,
    ) -> anyhow::Result<()>;
}

/// What the SFU tells us about peers it dropped on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaNotice {
    PeerGone { peer_id: u64 },
    RouteFailed { room_id: i64, grant_id: i64 },
}

impl MediaNotice {
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        let e = MediaEvent::decode(bytes).ok()?;
        match MediaEventKind::try_from(e.kind).ok()? {
            MediaEventKind::PeerGone => Some(Self::PeerGone { peer_id: e.peer_id }),
            MediaEventKind::RouteFailed => Some(Self::RouteFailed {
                room_id: e.room_id as i64,
                grant_id: e.grant_id as i64,
            }),
            MediaEventKind::Unspecified => None,
        }
    }
}

pub struct NatsMediaClient {
    client: async_nats::Client,
}

impl NatsMediaClient {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        Ok(Self {
            client: common::nats::connect(url).await?,
        })
    }

    /// Feed SFU notices (peer lost, route failed) to `on_notice`.
    pub async fn notices<F, Fut>(&self, on_notice: F) -> anyhow::Result<()>
    where
        F: Fn(MediaNotice) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let mut sub = self.client.subscribe(EVENT).await?;
        tokio::spawn(async move {
            while let Some(msg) = sub.next().await {
                if let Some(n) = MediaNotice::decode(&msg.payload) {
                    on_notice(n).await;
                }
            }
        });
        Ok(())
    }
}

#[async_trait]
impl MediaClient for NatsMediaClient {
    #[tracing::instrument(name = "media join", skip_all, err(Display), fields(otel.kind = "client", messaging.system = "nats", room.id = room_id))]
    async fn join(
        &self,
        room_id: i64,
        user_id: i64,
        sdp_offer: String,
    ) -> anyhow::Result<(u64, String)> {
        let req = MediaJoin {
            room_id: room_id as u64,
            sdp_offer,
            user_id: user_id as u64,
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

    async fn route(
        &self,
        room_id: i64,
        revision: u64,
        route: Option<(u64, u64, u64)>,
    ) -> anyhow::Result<()> {
        let (controller_peer_id, host_peer_id, grant_id) = route.unwrap_or((0, 0, 0));
        let req = MediaRoute {
            revision,
            room_id: room_id as u64,
            controller_peer_id,
            host_peer_id,
            grant_id,
        };
        self.client
            .publish(ROUTE, req.encode_to_vec().into())
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_notices() {
        let gone = MediaEvent {
            kind: MediaEventKind::PeerGone as i32,
            peer_id: 4,
            room_id: 0,
            grant_id: 0,
        };
        assert_eq!(
            MediaNotice::decode(&gone.encode_to_vec()),
            Some(MediaNotice::PeerGone { peer_id: 4 })
        );
        let failed = MediaEvent {
            kind: MediaEventKind::RouteFailed as i32,
            peer_id: 0,
            room_id: 9,
            grant_id: 5,
        };
        assert_eq!(
            MediaNotice::decode(&failed.encode_to_vec()),
            Some(MediaNotice::RouteFailed {
                room_id: 9,
                grant_id: 5
            })
        );
        assert_eq!(
            MediaNotice::decode(&MediaEvent::default().encode_to_vec()),
            None
        );
    }
}
