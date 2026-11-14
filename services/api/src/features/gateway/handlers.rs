//! The WebSocket "controller": one function per request type.
//! Unpack the payload → call a service → wrap the result in a reply payload.

use protocol::v1::{self, envelope::Payload};

use super::connection::Session;
use crate::app::AppState;
use crate::common::error::ApiError;

/// Routes one request to its handler. This `match` is the WebSocket's router.
pub async fn dispatch(
    state: &AppState,
    session: &Session,
    payload: Payload,
) -> Result<Payload, ApiError> {
    match payload {
        Payload::Ping(_) => Ok(Payload::Pong(v1::Pong {})),
        Payload::OpenDm(req) => open_dm(state, session, req).await,
        Payload::ListConversations(_) => list_conversations(state, session).await,
        Payload::Authenticate(_) => Err(ApiError::bad_request(
            "already_authenticated",
            "already authenticated",
        )),
        _ => Err(ApiError::bad_request(
            "not_implemented",
            "request type not implemented yet",
        )),
    }
}

async fn open_dm(
    state: &AppState,
    session: &Session,
    req: v1::OpenDm,
) -> Result<Payload, ApiError> {
    let conv = state
        .conversations
        .open_dm(session.user_id, &req.username)
        .await?;
    Ok(Payload::Conversation(v1::ConversationResult {
        conversation: Some((&conv).into()),
    }))
}

async fn list_conversations(state: &AppState, session: &Session) -> Result<Payload, ApiError> {
    let convs = state.conversations.list(session.user_id).await?;
    Ok(Payload::Conversations(v1::Conversations {
        conversations: convs.iter().map(Into::into).collect(),
    }))
}
