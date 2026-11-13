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

#[derive(Debug, Deserialize)]
pub struct SetUsernameRequest {
    pub username: String,
}
