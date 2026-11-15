//! The WebSocket "controller": one function per request type.
//! Unpack the payload → call a service → wrap the result in a reply payload.

use protocol::v1::{self, envelope::Payload};

use super::connection::Session;
use crate::app::AppState;
use crate::common::error::ApiError;
use crate::features::conversations::models::Conversation;

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
        Payload::Sync(req) => sync(state, session, req).await,
        Payload::CreateGroup(req) => create_group(state, session, req).await,
        Payload::AddMember(req) => add_member(state, session, req).await,
        Payload::LeaveGroup(req) => leave_group(state, session, req).await,
        Payload::RenameGroup(req) => rename_group(state, session, req).await,
        Payload::CallStart(req) => call_start(state, session, req).await,
        Payload::CallAccept(req) => call_result(
            state
                .calls
                .accept(session.user_id, req.call_id as i64)
                .await,
        ),
        Payload::CallDecline(req) => call_result(
            state
                .calls
                .decline(session.user_id, req.call_id as i64)
                .await,
        ),
        Payload::CallJoin(req) => call_join(state, session, req).await,
        Payload::CallLeave(req) => call_result(
            state
                .calls
                .leave(session.user_id, session.connection_id, req.call_id as i64)
                .await,
        ),
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

async fn sync(state: &AppState, session: &Session, req: v1::Sync) -> Result<Payload, ApiError> {
    let (messages, complete) = state
        .messages
        .sync(
            session.user_id,
            req.conversation_id as i64,
            req.after_seq as i64,
        )
        .await?;

    Ok(Payload::SyncResult(v1::SyncResult {
        messages: messages.iter().map(Into::into).collect(),
        complete,
    }))
}

// --- group DMs ---
// Create, add and rename all answer with the updated conversation.

async fn create_group(
    state: &AppState,
    session: &Session,
    req: v1::CreateGroup,
) -> Result<Payload, ApiError> {
    let group = state
        .conversations
        .create_group(session.user_id, &req.name, &req.usernames)
        .await?;
    Ok(conversation_result(&group))
}

async fn add_member(
    state: &AppState,
    session: &Session,
    req: v1::AddMember,
) -> Result<Payload, ApiError> {
    let group = state
        .conversations
        .add_member(session.user_id, req.conversation_id as i64, &req.username)
        .await?;
    Ok(conversation_result(&group))
}

async fn leave_group(
    state: &AppState,
    session: &Session,
    req: v1::LeaveGroup,
) -> Result<Payload, ApiError> {
    state
        .conversations
        .leave_group(session.user_id, req.conversation_id as i64)
        .await?;
    // Nothing to send back: you're not in it anymore.
    Ok(Payload::Conversation(v1::ConversationResult {
        conversation: None,
    }))
}

async fn rename_group(
    state: &AppState,
    session: &Session,
    req: v1::RenameGroup,
) -> Result<Payload, ApiError> {
    let group = state
        .conversations
        .rename_group(session.user_id, req.conversation_id as i64, &req.name)
        .await?;
    Ok(conversation_result(&group))
}

fn conversation_result(conversation: &Conversation) -> Payload {
    Payload::Conversation(v1::ConversationResult {
        conversation: Some(conversation.into()),
    })
}

async fn call_start(
    state: &AppState,
    session: &Session,
    req: v1::CallStart,
) -> Result<Payload, ApiError> {
    call_result(
        state
            .calls
            .start(session.user_id, req.conversation_id as i64)
            .await,
    )
}

async fn call_join(
    state: &AppState,
    session: &Session,
    req: v1::CallJoin,
) -> Result<Payload, ApiError> {
    let (call, sdp_answer) = state
        .calls
        .join(
            session.user_id,
            session.device_id,
            session.connection_id,
            req.call_id as i64,
            req.sdp_offer,
        )
        .await?;
    Ok(Payload::CallJoined(v1::CallJoined {
        call: Some((&call).into()),
        sdp_answer,
    }))
}

fn call_result(
    call: Result<crate::features::calls::models::Call, ApiError>,
) -> Result<Payload, ApiError> {
    Ok(Payload::CallResult(v1::CallResult {
        call: Some((&call?).into()),
    }))
}
