use serde::{Deserialize, Serialize};

use super::models::User;

// INVARIANT: IDs are strings in JSON because Snowflakes don't fit in a JS number.
#[derive(Debug, Serialize)]
pub struct UserDto {
    pub id: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub custom_status: Option<String>,
    pub avatar_hash: Option<String>,
    pub banner_hash: Option<String>,
    pub accent_color: Option<String>,
    pub pronouns: Option<String>,
}

impl From<User> for UserDto {
    fn from(u: User) -> Self {
        let avatar_hash = u.avatar_hex();
        let banner_hash = u.banner_hex();
        let accent_color = u.accent_hex();
        Self {
            id: u.id.to_string(),
            username: u.username,
            display_name: u.display_name,
            bio: u.bio,
            custom_status: u.custom_status,
            avatar_hash,
            banner_hash,
            accent_color,
            pronouns: u.pronouns,
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
            custom_status: u.custom_status.clone().unwrap_or_default(),
            banner_hash: u.banner_hex().unwrap_or_default(),
            accent_color: u.accent_hex().unwrap_or_default(),
            pronouns: u.pronouns.clone().unwrap_or_default(),
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

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub custom_status: Option<String>,
    pub pronouns: Option<String>,
    pub accent_color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImageQuery {
    pub size: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct ImageUrlDto {
    pub url: String,
}
