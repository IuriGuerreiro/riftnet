use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::models::FriendState;
use super::service::FriendEntry;
use crate::features::users::dto::UserDto;

#[derive(Debug, Deserialize)]
pub struct SendRequestBody {
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct FriendDto {
    pub user: UserDto,
    pub state: &'static str,
    pub since: DateTime<Utc>,
}

impl From<FriendEntry> for FriendDto {
    fn from(entry: FriendEntry) -> Self {
        Self {
            user: entry.user.into(),
            state: match entry.state {
                FriendState::None => "none",
                FriendState::Incoming => "incoming",
                FriendState::Outgoing => "outgoing",
                FriendState::Friend => "friend",
            },
            since: entry.since,
        }
    }
}

#[derive(Debug, Serialize, Default)]
pub struct FriendsResponse {
    pub friends: Vec<FriendDto>,
    pub incoming: Vec<FriendDto>,
    pub outgoing: Vec<FriendDto>,
}

impl From<Vec<FriendEntry>> for FriendsResponse {
    fn from(entries: Vec<FriendEntry>) -> Self {
        let mut response = Self::default();
        for entry in entries {
            let list = match entry.state {
                FriendState::Friend => &mut response.friends,
                FriendState::Incoming => &mut response.incoming,
                FriendState::Outgoing => &mut response.outgoing,
                FriendState::None => continue,
            };
            list.push(entry.into());
        }
        response
    }
}
