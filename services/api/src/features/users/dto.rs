use serde::{Deserialize, Serialize};

use super::models::User;

// INVARIANT: IDs are strings in JSON because Snowflakes don't fit in a JS number.
#[derive(Debug, Serialize)]
pub struct UserDto {
    pub id: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    /// Hex BLAKE3. Image: GET /users/{id}/avatar/{avatar_hash}?size=128|512
    pub avatar_hash: Option<String>,
}

impl From<User> for UserDto {
    fn from(u: User) -> Self {
        let avatar_hash = u.avatar_hex();
        Self {
            id: u.id.to_string(),
            username: u.username,
            display_name: u.display_name,
            bio: u.bio,
            avatar_hash,
        }
    }
}

impl From<&User> for protocol::v1::User {
    fn from(u: &User) -> Self {
        Self {
            id: u.id as u64,
            username: u.username.clone().unwrap_or_default(),
            display_name: u.display_name.clone().unwrap_or_default(),
            avatar_hash: u.avatar_hex().unwrap_or_default(),
            bio: u.bio.clone().unwrap_or_default(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SetUsernameRequest {
    pub username: String,
}

#[derive(Debug, Deserialize)]
pub struct SearchUsersQuery {
    pub q: String,
    pub limit: Option<u32>,
}

/// PATCH /me. A missing field is left alone; "" clears it.
#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub bio: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AvatarQuery {
    pub size: Option<u32>,
}
