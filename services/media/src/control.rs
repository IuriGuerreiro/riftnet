use futures::StreamExt;
use protocol::Message;
use protocol::v1::{MediaJoin, MediaJoinReply, MediaLeave};

use crate::sfu::Sfu;

pub const JOIN: &str = "media.join";
pub const LEAVE: &str = "media.leave";

pub async fn serve(nats: async_nats::Client, sfu: Sfu) -> anyhow::Result<()> {
    let mut joins = nats.subscribe(JOIN).await?;
    let mut leaves = nats.subscribe(LEAVE).await?;

    loop {
        tokio::select! {
            Some(msg) = joins.next() => {
                let reply = match MediaJoin::decode(msg.payload) {
                    Ok(req) => join(&sfu, req),
                    Err(e) => MediaJoinReply { error: format!("bad request: {e}"), ..Default::default() },
                };
                if let Some(to) = msg.reply {
                    nats.publish(to, reply.encode_to_vec().into()).await?;
                }
            }
            Some(msg) = leaves.next() => {
                if let Ok(req) = MediaLeave::decode(msg.payload) {
                    sfu.remove(req.peer_id);
                }
            }
            else => anyhow::bail!("NATS subscription closed"),
        }
    }
}

#[tracing::instrument(name = "media.join", skip_all, fields(room.id = req.room_id))]
fn join(sfu: &Sfu, req: MediaJoin) -> MediaJoinReply {
    match sfu.add(req.room_id, &req.sdp_offer) {
        Ok((peer_id, sdp_answer)) => MediaJoinReply {
            peer_id,
            sdp_answer,
            error: String::new(),
        },
        Err(e) => {
            tracing::warn!(error = %e, "join failed");
            MediaJoinReply {
                error: e.to_string(),
                ..Default::default()
            }
        }
    }
}
