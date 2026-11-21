use futures::StreamExt;
use protocol::Message;
use protocol::v1::{MediaEvent, MediaEventKind, MediaJoin, MediaJoinReply, MediaLeave, MediaRoute};

use crate::sfu::{Notice, Route, Sfu};

pub const JOIN: &str = "media.join";
pub const LEAVE: &str = "media.leave";
pub const ROUTE: &str = "media.route";
pub const EVENT: &str = "media.event";

pub fn encode_notice(n: Notice) -> MediaEvent {
    match n {
        Notice::PeerGone { peer_id } => MediaEvent {
            kind: MediaEventKind::PeerGone as i32,
            peer_id,
            room_id: 0,
            grant_id: 0,
        },
        Notice::RouteFailed { room, grant } => MediaEvent {
            kind: MediaEventKind::RouteFailed as i32,
            peer_id: 0,
            room_id: room,
            grant_id: grant,
        },
    }
}

pub async fn serve(
    nats: async_nats::Client,
    sfu: Sfu,
    mut notices: tokio::sync::mpsc::UnboundedReceiver<Notice>,
) -> anyhow::Result<()> {
    let mut joins = nats.subscribe(JOIN).await?;
    let mut leaves = nats.subscribe(LEAVE).await?;
    let mut routes = nats.subscribe(ROUTE).await?;

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
            Some(msg) = routes.next() => {
                if let Ok(req) = MediaRoute::decode(msg.payload) {
                    let route = (req.controller_peer_id != 0).then_some(Route {
                        controller: req.controller_peer_id,
                        host: req.host_peer_id,
                        grant: req.grant_id,
                    });
                    sfu.route(req.room_id, route);
                }
            }
            Some(n) = notices.recv() => {
                nats.publish(EVENT, encode_notice(n).encode_to_vec().into()).await?;
            }
            else => anyhow::bail!("NATS subscription closed"),
        }
    }
}

#[tracing::instrument(name = "media.join", skip_all, fields(room.id = req.room_id))]
fn join(sfu: &Sfu, req: MediaJoin) -> MediaJoinReply {
    match sfu.add(req.room_id, req.user_id, &req.sdp_offer) {
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
