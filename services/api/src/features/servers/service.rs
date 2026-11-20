use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use common::snowflake::Snowflake;
use rand::{RngCore, rngs::OsRng};
use std::sync::Arc;

use super::models::{
    ChannelWrite, CreatedServer, LeaveOutcome, Server, ServerMember, ServerMembership,
};
use super::repository::ServerRepo;
use crate::common::error::{ApiError, RepoError};
use crate::common::events::EventBus;
use protocol::Message as _;
use protocol::v1::{Envelope, ServerRemoved, envelope::Payload};

const DEFAULT_CHANNEL_NAME: &str = "general";

pub struct ServerService {
    repo: Arc<dyn ServerRepo>,
    ids: Arc<Snowflake>,
    events: Arc<dyn EventBus>,
}
impl ServerService {
    pub fn new(repo: Arc<dyn ServerRepo>, ids: Arc<Snowflake>, events: Arc<dyn EventBus>) -> Self {
        Self { repo, ids, events }
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
    pub async fn create_channel(
        &self,
        user_id: i64,
        server_id: i64,
        name: &str,
    ) -> Result<Server, ApiError> {
        let name = channel_name(name)?;
        match self
            .repo
            .create_channel(user_id, server_id, self.ids.next_id() as i64, name)
            .await
            .map_err(channel_error)?
        {
            ChannelWrite::Saved(channel) => Ok(channel),
            ChannelWrite::NotFound => Err(ApiError::NotFound),
            ChannelWrite::LimitReached => Err(ApiError::conflict(
                "channel_limit",
                "A server can have up to 100 text channels",
            )),
        }
    }
    pub async fn rename_channel(
        &self,
        user_id: i64,
        server_id: i64,
        channel_id: i64,
        name: &str,
    ) -> Result<Server, ApiError> {
        self.repo
            .rename_channel(user_id, server_id, channel_id, channel_name(name)?)
            .await
            .map_err(channel_error)?
            .ok_or(ApiError::NotFound)
    }
    pub async fn list_members(
        &self,
        user_id: i64,
        server_id: i64,
        after_id: i64,
    ) -> Result<Vec<ServerMember>, ApiError> {
        if after_id < 0 {
            return Err(ApiError::bad_request("bad_cursor", "Invalid member cursor"));
        }
        self.repo
            .list_members(user_id, server_id, after_id)
            .await?
            .ok_or(ApiError::NotFound)
    }
    pub async fn remove_member(
        &self,
        owner_id: i64,
        server_id: i64,
        user_id: i64,
    ) -> Result<(), ApiError> {
        if !self
            .repo
            .remove_member(owner_id, server_id, user_id)
            .await?
        {
            return Err(ApiError::NotFound);
        }
        if owner_id == user_id {
            return Err(ApiError::conflict(
                "owner_cannot_leave",
                "The server owner cannot leave or remove themselves",
            ));
        }
        self.notify_removed(user_id, server_id).await;
        Ok(())
    }
    pub async fn leave(&self, user_id: i64, server_id: i64) -> Result<(), ApiError> {
        match self.repo.leave(user_id, server_id).await? {
            LeaveOutcome::Left => self.notify_removed(user_id, server_id).await,
            LeaveOutcome::Owner => {
                return Err(ApiError::conflict(
                    "owner_cannot_leave",
                    "The server owner cannot leave",
                ));
            }
            LeaveOutcome::NotFound => return Err(ApiError::NotFound),
        }
        Ok(())
    }
    async fn notify_removed(&self, user_id: i64, server_id: i64) {
        let envelope = Envelope {
            id: 0,
            payload: Some(Payload::ServerRemoved(ServerRemoved {
                server_id: server_id as u64,
            })),
        };
        if let Err(error) = self
            .events
            .publish_to_users(&[user_id], envelope.encode_to_vec().into())
            .await
        {
            tracing::warn!(%error, server.id = server_id, "server removal notification failed");
        }
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

fn channel_name(name: &str) -> Result<&str, ApiError> {
    let name = name.trim();
    if !(1..=100).contains(&name.chars().count()) || name.contains('\0') {
        return Err(ApiError::bad_request(
            "invalid_channel_name",
            "Channel name must be 1 to 100 characters and contain no null characters",
        ));
    }
    Ok(name)
}

fn channel_error(error: RepoError) -> ApiError {
    match error {
        RepoError::Conflict => ApiError::conflict(
            "channel_name_taken",
            "A channel with that name already exists",
        ),
        other => other.into(),
    }
}
