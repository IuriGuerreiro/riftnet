use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use common::snowflake::Snowflake;
use rand::{RngCore, rngs::OsRng};
use std::sync::Arc;

use super::models::{CreatedServer, Server, ServerMembership};
use super::repository::ServerRepo;
use crate::common::error::ApiError;

const DEFAULT_CHANNEL_NAME: &str = "general";

pub struct ServerService {
    repo: Arc<dyn ServerRepo>,
    ids: Arc<Snowflake>,
}
impl ServerService {
    pub fn new(repo: Arc<dyn ServerRepo>, ids: Arc<Snowflake>) -> Self {
        Self { repo, ids }
    }
    pub async fn create(&self, user_id: i64, name: &str) -> Result<CreatedServer, ApiError> {
        let name = name.trim();
        if !(1..=100).contains(&name.chars().count()) || name.contains('\0') {
            return Err(ApiError::bad_request(
                "invalid_server_name",
                "Server name must be 1 to 100 characters and cannot contain null characters",
            ));
        }

        let server_id = self.ids.next_id() as i64;
        let channel_id = self.ids.next_id() as i64;
        self.repo
            .create(user_id, server_id, channel_id, name)
            .await?;
        Ok(CreatedServer {
            server: Server {
                id: server_id,
                name: name.into(),
            },
            default_channel: Server {
                id: channel_id,
                name: DEFAULT_CHANNEL_NAME.into(),
            },
        })
    }
    pub async fn list(&self, user_id: i64) -> Result<Vec<ServerMembership>, ApiError> {
        Ok(self.repo.list(user_id).await?)
    }
    pub async fn list_channels(
        &self,
        user_id: i64,
        server_id: i64,
    ) -> Result<Vec<Server>, ApiError> {
        self.repo
            .list_channels(user_id, server_id)
            .await?
            .ok_or(ApiError::NotFound)
    }
    pub async fn invite(&self, user_id: i64, server_id: i64) -> Result<String, ApiError> {
        let mut bytes = [0; 24];
        OsRng.fill_bytes(&mut bytes);
        let token = format!("si_{}", URL_SAFE_NO_PAD.encode(bytes));
        self.repo
            .invite(user_id, server_id, &token)
            .await?
            .ok_or(ApiError::NotFound)
    }
    pub async fn revoke_invite(&self, user_id: i64, server_id: i64) -> Result<(), ApiError> {
        if !self.repo.revoke_invite(user_id, server_id).await? {
            return Err(ApiError::NotFound);
        }
        Ok(())
    }
    pub async fn join(&self, user_id: i64, token: &str) -> Result<Server, ApiError> {
        self.repo.join(user_id, token).await?.ok_or_else(|| {
            ApiError::bad_request("invalid_invite", "This invite link is invalid or revoked")
        })
    }
}
