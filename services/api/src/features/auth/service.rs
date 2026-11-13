use std::sync::Arc;

use chrono::{Duration, Utc};
use common::snowflake::Snowflake;

use super::identity::{IdentityError, IdentityProvider};
use super::metrics;
use super::models::NewDevice;
use super::repository::AuthRepo;
use super::tokens::{REFRESH_TTL_DAYS, TokenService, hash_refresh_token};
use crate::common::error::ApiError;
use crate::features::users::models::User;
use crate::features::users::repository::UserRepo;

/// What a successful login / register / refresh returns.
pub struct Session {
    pub access_token: String,
    pub access_expires_at: i64,
    pub refresh_token: String,
    pub user: User,
}

pub struct AuthService {
    identity: Arc<dyn IdentityProvider>,
    users: Arc<dyn UserRepo>,
    repo: Arc<dyn AuthRepo>,
    tokens: Arc<TokenService>,
    ids: Arc<Snowflake>,
}

impl AuthService {
    pub fn new(
        identity: Arc<dyn IdentityProvider>,
        users: Arc<dyn UserRepo>,
        repo: Arc<dyn AuthRepo>,
        tokens: Arc<TokenService>,
        ids: Arc<Snowflake>,
    ) -> Self {
        Self {
            identity,
            users,
            repo,
            tokens,
            ids,
        }
    }

    pub async fn register(
        &self,
        email: &str,
        password: &str,
        device: NewDevice,
    ) -> Result<Session, ApiError> {
        let result = self.register_inner(email, password, device).await;
        metrics::registration(match &result {
            Ok(_) => "ok",
            Err(ApiError::BadRequest { .. } | ApiError::Conflict { .. }) => "rejected",
            Err(_) => "error",
        });
        result
    }

    async fn register_inner(
        &self,
        email: &str,
        password: &str,
        device: NewDevice,
    ) -> Result<Session, ApiError> {
        let email = validate_email(email)?;
        validate_password(password)?;
        let device = validate_device(device)?;

        let zitadel_id =
            self.identity
                .create_user(&email, password)
                .await
                .map_err(|e| match e {
                    IdentityError::EmailTaken => {
                        ApiError::conflict("email_taken", "that email is already registered")
                    }
                    IdentityError::WeakPassword(msg) => ApiError::bad_request("weak_password", msg),
                    other => identity_internal(other),
                })?;

        let user = self.find_or_create_user(&zitadel_id).await?;
        self.start_session(user, device).await
    }

    pub async fn login(
        &self,
        email: &str,
        password: &str,
        device: NewDevice,
    ) -> Result<Session, ApiError> {
        let result = self.login_inner(email, password, device).await;
        metrics::login(match &result {
            Ok(_) => "ok",
            Err(ApiError::Unauthorized(_) | ApiError::BadRequest { .. }) => "failed",
            Err(_) => "error",
        });
        result
    }

    async fn login_inner(
        &self,
        email: &str,
        password: &str,
        device: NewDevice,
    ) -> Result<Session, ApiError> {
        let email = validate_email(email)?;
        let device = validate_device(device)?;

        let zitadel_id = self
            .identity
            .verify_password(&email, password)
            .await
            .map_err(|e| match e {
                IdentityError::InvalidCredentials => ApiError::Unauthorized("invalid_credentials"),
                other => identity_internal(other),
            })?;

        let user = self.find_or_create_user(&zitadel_id).await?;
        self.start_session(user, device).await
    }

    pub async fn refresh(&self, refresh_token: &str) -> Result<Session, ApiError> {
        let result = self.refresh_inner(refresh_token).await;
        metrics::refresh(refresh_outcome(&result));
        result
    }

    async fn refresh_inner(&self, refresh_token: &str) -> Result<Session, ApiError> {
        let hash = hash_refresh_token(refresh_token);
        let record = self
            .repo
            .find_refresh_token(&hash)
            .await?
            .ok_or(ApiError::Unauthorized("invalid_refresh_token"))?;

        if record.device_revoked_at.is_some() {
            return Err(ApiError::Unauthorized("session_revoked"));
        }
        if let Some(used_at) = record.used_at {
            // Used a moment ago: another tab / a retry of the same app got there
            // first. Not theft; the client should pick up the newer token.
            if Utc::now() - used_at <= Duration::seconds(REUSE_GRACE_SECS) {
                return Err(superseded());
            }
            // An old token came back much later: someone has a stolen copy. Kill the device.
            self.repo.revoke_device(record.device_id).await?;
            tracing::warn!(
                device_id = record.device_id,
                "refresh token reuse, device revoked"
            );
            return Err(ApiError::Unauthorized("refresh_token_reused"));
        }
        if record.expires_at <= Utc::now() {
            return Err(ApiError::Unauthorized("refresh_token_expired"));
        }

        let (new_token, new_hash) = self.tokens.new_refresh_token();
        let rotated = self
            .repo
            .rotate_refresh_token(
                record.id,
                self.next_id(),
                record.device_id,
                &new_hash,
                Utc::now() + Duration::days(REFRESH_TTL_DAYS),
            )
            .await?;
        if !rotated {
            // Two refreshes raced with the same token at the same instant.
            return Err(superseded());
        }

        let user = self
            .users
            .find_by_id(record.user_id)
            .await?
            .ok_or(ApiError::NotFound)?;
        let (access_token, access_expires_at) =
            self.tokens
                .issue_access(user.id, record.device_id, Utc::now().timestamp());
        Ok(Session {
            access_token,
            access_expires_at,
            refresh_token: new_token,
            user,
        })
    }

    pub async fn logout(&self, device_id: i64) -> Result<(), ApiError> {
        self.repo.revoke_device(device_id).await?;
        Ok(())
    }

    async fn find_or_create_user(&self, zitadel_id: &str) -> Result<User, ApiError> {
        if let Some(user) = self.users.find_by_zitadel_id(zitadel_id).await? {
            return Ok(user);
        }
        Ok(self.users.create(self.next_id(), zitadel_id).await?)
    }

    async fn start_session(&self, user: User, device: NewDevice) -> Result<Session, ApiError> {
        let device_id = self.next_id();
        self.repo.create_device(device_id, user.id, &device).await?;

        let (refresh_token, hash) = self.tokens.new_refresh_token();
        self.repo
            .insert_refresh_token(
                self.next_id(),
                device_id,
                &hash,
                Utc::now() + Duration::days(REFRESH_TTL_DAYS),
            )
            .await?;

        let (access_token, access_expires_at) =
            self.tokens
                .issue_access(user.id, device_id, Utc::now().timestamp());
        Ok(Session {
            access_token,
            access_expires_at,
            refresh_token,
            user,
        })
    }

    fn next_id(&self) -> i64 {
        // Snowflakes use 63 bits, so they always fit in a signed BIGINT.
        self.ids.next_id() as i64
    }
}

/// How long after a refresh token is rotated we still treat its reuse as a
/// harmless race (two tabs, a retry) instead of theft.
const REUSE_GRACE_SECS: i64 = 30;

fn superseded() -> ApiError {
    ApiError::conflict(
        "refresh_superseded",
        "this refresh token was just rotated by another request; use the newer one",
    )
}

fn refresh_outcome(result: &Result<Session, ApiError>) -> &'static str {
    match result {
        Ok(_) => "ok",
        Err(ApiError::Conflict {
            code: "refresh_superseded",
            ..
        }) => "superseded",
        Err(ApiError::Unauthorized("refresh_token_reused")) => "reused",
        Err(ApiError::Unauthorized("session_revoked")) => "revoked",
        Err(ApiError::Unauthorized("refresh_token_expired")) => "expired",
        Err(ApiError::Unauthorized(_)) => "invalid",
        Err(_) => "error",
    }
}

fn identity_internal(err: IdentityError) -> ApiError {
    ApiError::Internal(anyhow::anyhow!(err))
}

fn validate_email(raw: &str) -> Result<String, ApiError> {
    let email = raw.trim().to_lowercase();
    let valid = email.len() <= 254
        && email
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'));
    if !valid {
        return Err(ApiError::bad_request(
            "invalid_email",
            "that doesn't look like an email",
        ));
    }
    Ok(email)
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    let len = password.chars().count();
    if !(8..=128).contains(&len) {
        return Err(ApiError::bad_request(
            "weak_password",
            "password must be 8–128 characters",
        ));
    }
    Ok(())
}

fn validate_device(device: NewDevice) -> Result<NewDevice, ApiError> {
    let name = device.name.trim().chars().take(64).collect::<String>();
    if !matches!(device.platform.as_str(), "desktop" | "web" | "mobile") {
        return Err(ApiError::bad_request(
            "invalid_device",
            "platform must be desktop, web or mobile",
        ));
    }
    Ok(NewDevice {
        name: if name.is_empty() {
            "Unknown device".into()
        } else {
            name
        },
        platform: device.platform,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_outcomes() {
        assert_eq!(refresh_outcome(&Err(superseded())), "superseded");
        assert_eq!(
            refresh_outcome(&Err(ApiError::Unauthorized("refresh_token_reused"))),
            "reused"
        );
        assert_eq!(
            refresh_outcome(&Err(ApiError::Unauthorized("invalid_refresh_token"))),
            "invalid"
        );
    }

    #[test]
    fn email_rules() {
        assert_eq!(validate_email("  G@Example.COM ").unwrap(), "g@example.com");
        assert!(validate_email("nope").is_err());
        assert!(validate_email("@example.com").is_err());
        assert!(validate_email("a@localhost").is_err());
    }

    #[test]
    fn password_length() {
        assert!(validate_password("short").is_err());
        assert!(validate_password("long enough").is_ok());
    }

    #[test]
    fn device_rules() {
        let ok = validate_device(NewDevice {
            name: "  ".into(),
            platform: "web".into(),
        })
        .unwrap();
        assert_eq!(ok.name, "Unknown device");
        assert!(
            validate_device(NewDevice {
                name: "x".into(),
                platform: "toaster".into()
            })
            .is_err()
        );
    }
}
