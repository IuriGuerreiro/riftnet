use protocol::v1::{self, envelope::Payload};

use super::connection::Session;
use crate::app::AppState;
use crate::common::error::ApiError;
use crate::common::user_limits::{GROUP_CHANGE, SEND_MESSAGE};
use crate::features::conversations::models::Conversation;
use crate::features::presence::service::update as presence_update;

pub async fn dispatch(
    state: &AppState,
    session: &Session,
    payload: Payload,
) -> Result<Payload, ApiError> {
    match payload {
        Payload::Ping(_) => Ok(Payload::Pong(v1::Pong {})),
        Payload::OpenDm(req) => open_dm(state, session, req).await,
        Payload::ListConversations(_) => list_conversations(state, session).await,
        Payload::SendMessage(req) => {
            state.user_limits.hit(SEND_MESSAGE, session.user_id).await?;
            send_message(state, session, req).await
        }
        Payload::GetHistory(req) => get_history(state, session, req).await,
        Payload::Sync(req) => sync(state, session, req).await,
        Payload::EditMessage(req) => edit_message(state, session, req).await,
        Payload::DeleteMessage(req) => delete_message(state, session, req).await,
        Payload::CreateGroup(req) => {
            state.user_limits.hit(GROUP_CHANGE, session.user_id).await?;
            create_group(state, session, req).await
        }
        Payload::AddMember(req) => {
            state.user_limits.hit(GROUP_CHANGE, session.user_id).await?;
            add_member(state, session, req).await
        }
        Payload::LeaveGroup(req) => {
            state.user_limits.hit(GROUP_CHANGE, session.user_id).await?;
            leave_group(state, session, req).await
        }
        Payload::RenameGroup(req) => {
            state.user_limits.hit(GROUP_CHANGE, session.user_id).await?;
            rename_group(state, session, req).await
        }
        Payload::SetIdle(req) => {
            state
                .presence
                .set_idle(session.user_id, session.connection_id, req.idle)
                .await;
            Ok(Payload::Pong(v1::Pong {}))
        }
        Payload::GetPresence(req) => get_presence(state, session, req).await,
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
        Payload::CallScreenShare(req) => call_result(
            state
                .calls
                .screen_share(
                    session.user_id,
                    session.connection_id,
                    req.call_id as i64,
                    req.sharing,
                )
                .await,
        ),
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

async fn get_presence(
    state: &AppState,
    session: &Session,
    req: v1::GetPresence,
) -> Result<Payload, ApiError> {
    let ids: Vec<i64> = req.user_ids.iter().map(|id| *id as i64).collect();
    let found = state.presence.get(session.user_id, &ids).await?;
    Ok(Payload::Presences(v1::Presences {
        presences: found
            .into_iter()
            .map(|(id, status)| presence_update(id, status))
            .collect(),
    }))
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
            &req.attachment_ids
                .iter()
                .map(|id| *id as i64)
                .collect::<Vec<_>>(),
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
    let r = state
        .messages
        .sync(
            session.user_id,
            req.conversation_id as i64,
            req.after_seq as i64,
        )
        .await?;

    Ok(Payload::SyncResult(v1::SyncResult {
        messages: r.messages.iter().map(Into::into).collect(),
        complete: r.complete,
        edited: r.edited.iter().map(Into::into).collect(),
        deleted_ids: r.deleted_ids.iter().map(|id| *id as u64).collect(),
        last_seq: r.last_seq as u64,
    }))
}

async fn edit_message(
    state: &AppState,
    session: &Session,
    req: v1::EditMessage,
) -> Result<Payload, ApiError> {
    let (message, seq) = state
        .messages
        .edit(
            session.user_id,
            req.conversation_id as i64,
            req.message_id as i64,
            req.content,
        )
        .await?;
    Ok(Payload::EditMessageAck(v1::EditMessageAck {
        message: Some((&message).into()),
        seq: seq as u64,
    }))
}

async fn delete_message(
    state: &AppState,
    session: &Session,
    req: v1::DeleteMessage,
) -> Result<Payload, ApiError> {
    let seq = state
        .messages
        .delete(
            session.user_id,
            req.conversation_id as i64,
            req.message_id as i64,
        )
        .await?;
    Ok(Payload::DeleteMessageAck(v1::DeleteMessageAck {
        conversation_id: req.conversation_id,
        message_id: req.message_id,
        seq: seq.unwrap_or(0) as u64,
    }))
}

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
