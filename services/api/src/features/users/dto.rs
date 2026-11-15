use serde::{Deserialize, Serialize};

use super::models::User;

/// IDs are strings in JSON: Snowflakes don't fit in a JS number.
#[derive(Debug, Serialize)]
pub struct UserDto {
    pub id: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
}

impl From<User> for UserDto {
    fn from(u: User) -> Self {
        Self {
            id: u.id.to_string(),
            username: u.username,
            display_name: u.display_name,
        }
    }
}

/// For the WebSocket (protobuf). IDs are real numbers there.
impl From<&User> for protocol::v1::User {
    fn from(u: &User) -> Self {
        Self {
            id: u.id as u64,
            username: u.username.clone().unwrap_or_default(),
            display_name: u.display_name.clone().unwrap_or_default(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SetUsernameRequest {
    pub username: String,
}

/// `GET /users/search?q=mon&limit=20`
#[derive(Debug, Deserialize)]
pub struct SearchUsersQuery {
    pub q: String,
    pub limit: Option<u32>,
}
