use std::sync::Arc;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use common::snowflake::Snowflake;
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};

use super::models::{Bot, KeyMetadata};
use super::repository::BotRepo;
use crate::common::error::ApiError;

const KEY_PREFIX: &str = "d2_bot_";

pub struct BotService {
    repo: Arc<dyn BotRepo>,
    ids: Arc<Snowflake>,
}

pub struct IssuedKey {
    pub key: KeyMetadata,
    pub token: String,
}

impl BotService {
    pub fn new(repo: Arc<dyn BotRepo>, ids: Arc<Snowflake>) -> Self {
        Self { repo, ids }
    }

    pub async fn create(&self, owner: i64, name: &str) -> Result<Bot, ApiError> {
        Ok(self
            .repo
            .create(owner, validate_name(name)?, self.ids.next_id() as i64)
            .await?)
    }

    pub async fn list(&self, owner: i64) -> Result<Vec<Bot>, ApiError> {
        Ok(self.repo.list(owner).await?)
    }

    pub async fn issue_key(
        &self,
        owner: i64,
        bot_id: i64,
        name: &str,
    ) -> Result<IssuedKey, ApiError> {
        let name = validate_name(name)?;
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        let token = format!("{KEY_PREFIX}{}", URL_SAFE_NO_PAD.encode(secret));
        let hash = Sha256::digest(token.as_bytes());
        let key = self
            .repo
            .insert_key(owner, bot_id, name, self.ids.next_id() as i64, &hash)
            .await?
            .ok_or(ApiError::NotFound)?;
        Ok(IssuedKey { key, token })
    }

    pub async fn list_keys(&self, owner: i64, bot_id: i64) -> Result<Vec<KeyMetadata>, ApiError> {
        self.repo
            .list_keys(owner, bot_id)
            .await?
            .ok_or(ApiError::NotFound)
    }

    pub async fn revoke_key(&self, owner: i64, bot_id: i64, key_id: i64) -> Result<(), ApiError> {
        if !self.repo.revoke_key(owner, bot_id, key_id).await? {
            return Err(ApiError::NotFound);
        }
        Ok(())
    }

    pub async fn authenticate(&self, token: &str) -> Result<Bot, ApiError> {
        if token
            .strip_prefix(KEY_PREFIX)
            .is_none_or(|secret| secret.len() != 43)
        {
            return Err(ApiError::Unauthorized("invalid_bot_token"));
        }
        self.repo
            .find_by_token_hash(&Sha256::digest(token.as_bytes()))
            .await?
            .ok_or(ApiError::Unauthorized("invalid_bot_token"))
    }
}

fn validate_name(name: &str) -> Result<&str, ApiError> {
    let name = name.trim();
    if !(1..=100).contains(&name.chars().count()) || name.contains('\0') {
        return Err(ApiError::bad_request(
            "invalid_name",
            "Name must be 1 to 100 characters and cannot contain null characters",
        ));
    }
    Ok(name)
}
