use serde::{Deserialize, Serialize};

use crate::features::users::dto::UserDto;

#[derive(Deserialize)]
pub struct DeviceInfo {
    pub name: String,
    pub platform: String,
}

/// Login and register take the same body.
#[derive(Deserialize)]
pub struct CredentialsRequest {
    pub email: String,
    pub password: String,
    pub device: DeviceInfo,
}

// Never print the password, even by accident in a debug log.
impl std::fmt::Debug for CredentialsRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CredentialsRequest")
            .field("email", &self.email)
            .field("password", &"<redacted>")
            .finish()
    }
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Serialize)]
pub struct SessionResponse {
    pub access_token: String,
    /// Unix seconds.
    pub access_expires_at: i64,
    pub refresh_token: String,
    pub user: UserDto,
}
