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
        Payload::SendMessage(req) => send_message(state, session, req).await,
        Payload::GetHistory(req) => get_history(state, session, req).await,
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

async fn send_message(
    state: &AppState,
    session: &Session,
    req: v1::SendMessage,
) -> Result<Payload, ApiError> {
    let message = state
        .messages
        .send(
            session.user_id,
            req.conversation_id as i64,
            req.content,
            &req.nonce,
        )
        .await?;
    Ok(Payload::MessageAck(v1::MessageAck {
        nonce: req.nonce,
        message: Some((&message).into()),
    }))
}

async fn get_history(
    state: &AppState,
    session: &Session,
    req: v1::GetHistory,
) -> Result<Payload, ApiError> {
    let before = (req.before_id != 0).then_some(req.before_id as i64);
    let messages = state
        .messages
        .history(
            session.user_id,
            req.conversation_id as i64,
            before,
            req.limit,
        )
        .await?;
    Ok(Payload::History(v1::History {
        messages: messages.iter().map(Into::into).collect(),
    }))
}
