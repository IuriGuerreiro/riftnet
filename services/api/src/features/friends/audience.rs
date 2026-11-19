use std::collections::HashSet;

use super::models::FriendshipStatus;
use super::repository::FriendRepo;
use crate::common::error::ApiError;
use crate::features::conversations::repository::ConversationRepo;

/// Who sees a user's live updates (presence, profile): accepted friends and
/// everyone they share a conversation with. Never includes the user.
pub async fn audience(
    friends: &dyn FriendRepo,
    conversations: &dyn ConversationRepo,
    user_id: i64,
) -> Result<HashSet<i64>, ApiError> {
    let mut ids: HashSet<i64> = friends
        .list_for_user(user_id)
        .await?
        .iter()
        .filter(|row| row.status == FriendshipStatus::Accepted)
        .map(|row| row.other(user_id))
        .collect();
    for conv in conversations.list_for_user(user_id).await? {
        ids.extend(conv.member_ids);
    }
    ids.remove(&user_id);
    Ok(ids)
}
