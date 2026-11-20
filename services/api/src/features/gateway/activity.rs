use std::time::Duration;

use protocol::v1::{self, envelope::Payload};

use super::connection::Session;
use crate::app::AppState;
use crate::common::error::ApiError;

pub async fn set(
    state: &AppState,
    session: &Session,
    req: v1::SetActivity,
) -> Result<Payload, ApiError> {
    state.limiter.check(
        &format!("activity:{}", session.user_id),
        30,
        Duration::from_secs(60),
    )?;
    state
        .presence
        .set_activity(session.user_id, session.connection_id, &req.label)
        .await?;
    Ok(Payload::Pong(v1::Pong {}))
}

pub async fn get(
    state: &AppState,
    session: &Session,
    req: v1::GetActivities,
) -> Result<Payload, ApiError> {
    state.limiter.check(
        &format!("activities:{}", session.user_id),
        120,
        Duration::from_secs(60),
    )?;
    let mut activities = Vec::new();
    for (id, connections) in state
        .presence
        .friend_activities(session.user_id, &req.user_ids)
        .await?
    {
        let mut selected = None;
        for (conn, label) in connections {
            let streaming = state.calls.is_streaming(id, conn).await;
            if selected.is_none() || streaming {
                selected = Some(v1::FriendActivity {
                    user_id: id as u64,
                    label,
                    streaming,
                    joinable: false,
                });
            }
            if streaming {
                break;
            }
        }
        if let Some(mut activity) = selected {
            activity.joinable = state.calls.friend_call(session.user_id, id).await.is_ok();
            activities.push(activity);
        }
    }
    Ok(Payload::Activities(v1::Activities { activities }))
}

pub async fn join(
    state: &AppState,
    session: &Session,
    req: v1::JoinFriendCall,
) -> Result<Payload, ApiError> {
    state.limiter.check(
        &format!("join_friend:{}", session.user_id),
        10,
        Duration::from_secs(60),
    )?;
    let friend = i64::try_from(req.friend_id).map_err(|_| ApiError::NotFound)?;
    state
        .presence
        .require_friend(session.user_id, friend)
        .await?;
    let call = state.calls.friend_call(session.user_id, friend).await?;
    let (call, sdp_answer) = state
        .calls
        .join(
            session.user_id,
            session.device_id,
            session.connection_id,
            call.id,
            req.sdp_offer,
        )
        .await?;
    // INVARIANT: recheck access after media admission; revoke the peer if it changed.
    let still_friends = state
        .presence
        .require_friend(session.user_id, friend)
        .await
        .is_ok();
    let same_call = state
        .calls
        .friend_call(session.user_id, friend)
        .await
        .is_ok_and(|current| current.id == call.id);
    if !still_friends || !same_call {
        let _ = state
            .calls
            .remove_connection(call.id, session.connection_id)
            .await;
        return Err(ApiError::NotFound);
    }
    Ok(Payload::CallJoined(v1::CallJoined {
        call: Some((&call).into()),
        sdp_answer,
    }))
}
