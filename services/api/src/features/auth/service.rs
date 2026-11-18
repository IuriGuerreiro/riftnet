use std::sync::Arc;

use chrono::{Duration, Utc};
use common::snowflake::Snowflake;

use super::identity::{IdentityError, IdentityProvider};
use super::metrics;
use super::models::NewDevice;
use super::repository::AuthRepo;
use super::tokens::{REFRESH_TTL_DAYS, TokenService, hash_refresh_token};
use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::users::models::User;
use crate::features::users::repository::UserRepo;

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
    events: Arc<dyn EventBus>,
}

impl AuthService {
    pub fn new(
        identity: Arc<dyn IdentityProvider>,
        users: Arc<dyn UserRepo>,
        repo: Arc<dyn AuthRepo>,
        tokens: Arc<TokenService>,
        ids: Arc<Snowflake>,
        events: Arc<dyn EventBus>,
    ) -> Self {
        Self {
            identity,
            users,
            repo,
            tokens,
            ids,
            events,
        }
    }

    #[tracing::instrument(name = "auth.register", skip_all, fields(user.id = tracing::field::Empty, device.id = tracing::field::Empty, outcome = tracing::field::Empty))]
    pub async fn register(
        &self,
        email: &str,
        password: &str,
        device: NewDevice,
    ) -> Result<Session, ApiError> {
        let result = self.register_inner(email, password, device).await;
        let outcome = match &result {
            Ok(_) => "ok",
            Err(ApiError::BadRequest { .. } | ApiError::Conflict { .. }) => "rejected",
            Err(_) => "error",
        };
        tracing::Span::current().record("outcome", outcome);
        metrics::registration(outcome);
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

    #[tracing::instrument(name = "auth.login", skip_all, fields(user.id = tracing::field::Empty, device.id = tracing::field::Empty, outcome = tracing::field::Empty))]
    pub async fn login(
        &self,
        email: &str,
        password: &str,
        device: NewDevice,
    ) -> Result<Session, ApiError> {
        let result = self.login_inner(email, password, device).await;
        let outcome = match &result {
            Ok(_) => "ok",
            Err(ApiError::Unauthorized(_) | ApiError::BadRequest { .. }) => "failed",
            Err(_) => "error",
        };
        tracing::Span::current().record("outcome", outcome);
        metrics::login(outcome);
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

    #[tracing::instrument(name = "auth.refresh", skip_all, fields(user.id = tracing::field::Empty, device.id = tracing::field::Empty, outcome = tracing::field::Empty))]
    pub async fn refresh(&self, refresh_token: &str) -> Result<Session, ApiError> {
        let result = self.refresh_inner(refresh_token).await;
        let outcome = refresh_outcome(&result);
        tracing::Span::current().record("outcome", outcome);
        metrics::refresh(outcome);
        result
    }

    async fn refresh_inner(&self, refresh_token: &str) -> Result<Session, ApiError> {
        let hash = hash_refresh_token(refresh_token);
        let record = self
            .repo
            .find_refresh_token(&hash)
            .await?
            .ok_or(ApiError::Unauthorized("invalid_refresh_token"))?;

        let span = tracing::Span::current();
        span.record("user.id", record.user_id);
        span.record("device.id", record.device_id);
        if record.device_revoked_at.is_some() {
            return Err(ApiError::Unauthorized("session_revoked"));
        }
        if let Some(used_at) = record.used_at {
            if Utc::now() - used_at <= Duration::seconds(REUSE_GRACE_SECS) {
                return Err(superseded());
            }
            self.revoke(record.device_id).await?;
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

    #[tracing::instrument(name = "auth.logout", skip_all, fields(device.id = device_id))]
    pub async fn logout(&self, device_id: i64) -> Result<(), ApiError> {
        self.revoke(device_id).await
    }

    pub async fn is_device_revoked(&self, device_id: i64) -> Result<bool, ApiError> {
        Ok(self.repo.is_device_revoked(device_id).await?)
    }

    // WARN: a failed publish is only logged; the socket then lives until its token expires.
    async fn revoke(&self, device_id: i64) -> Result<(), ApiError> {
        self.repo.revoke_device(device_id).await?;
        if let Err(err) = self.events.publish_device_revoked(device_id).await {
            tracing::warn!(error = %err, device.id = device_id, "revoke publish failed");
        }
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
        let span = tracing::Span::current();
        span.record("user.id", user.id);
        span.record("device.id", device_id);
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
        self.ids.next_id() as i64
    }
}

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

    mod revoke {
        use std::sync::Mutex;

        use async_trait::async_trait;
        use bytes::Bytes;
        use chrono::DateTime;
        use ed25519_dalek::SigningKey;
        use futures::stream::BoxStream;

        use super::*;
        use crate::common::error::RepoError;
        use crate::features::auth::models::RefreshTokenRecord;

        struct NoIdentity;
        #[async_trait]
        impl IdentityProvider for NoIdentity {
            async fn create_user(&self, _: &str, _: &str) -> Result<String, IdentityError> {
                unimplemented!()
            }
            async fn verify_password(&self, _: &str, _: &str) -> Result<String, IdentityError> {
                unimplemented!()
            }
        }

        struct NoUsers;
        #[async_trait]
        impl UserRepo for NoUsers {
            async fn find_by_id(&self, _: i64) -> Result<Option<User>, RepoError> {
                unimplemented!()
            }
            async fn find_by_zitadel_id(&self, _: &str) -> Result<Option<User>, RepoError> {
                unimplemented!()
            }
            async fn find_by_ids(&self, _: &[i64]) -> Result<Vec<User>, RepoError> {
                unimplemented!()
            }
            async fn find_by_username(&self, _: &str) -> Result<Option<User>, RepoError> {
                unimplemented!()
            }
            async fn search_by_username_prefix(
                &self,
                _: &str,
                _: &str,
                _: i64,
                _: i64,
            ) -> Result<Vec<User>, RepoError> {
                unimplemented!()
            }
            async fn create(&self, _: i64, _: &str) -> Result<User, RepoError> {
                unimplemented!()
            }
            async fn set_username(&self, _: i64, _: &str) -> Result<Option<User>, RepoError> {
                unimplemented!()
            }
            async fn set_profile(
                &self,
                _: i64,
                _: Option<Option<&str>>,
                _: Option<Option<&str>>,
            ) -> Result<Option<User>, RepoError> {
                unimplemented!()
            }
            async fn set_avatar(
                &self,
                _: i64,
                _: Option<&[u8]>,
            ) -> Result<Option<(User, Option<Vec<u8>>)>, RepoError> {
                unimplemented!()
            }
        }

        #[derive(Default)]
        struct FakeRepo {
            revoked: Mutex<Vec<i64>>,
            token: Mutex<Option<RefreshTokenRecord>>,
        }
        #[async_trait]
        impl AuthRepo for FakeRepo {
            async fn create_device(&self, _: i64, _: i64, _: &NewDevice) -> Result<(), RepoError> {
                unimplemented!()
            }
            async fn insert_refresh_token(
                &self,
                _: i64,
                _: i64,
                _: &[u8],
                _: DateTime<Utc>,
            ) -> Result<(), RepoError> {
                unimplemented!()
            }
            async fn find_refresh_token(
                &self,
                _: &[u8],
            ) -> Result<Option<RefreshTokenRecord>, RepoError> {
                Ok(self.token.lock().unwrap().clone())
            }
            async fn rotate_refresh_token(
                &self,
                _: i64,
                _: i64,
                _: i64,
                _: &[u8],
                _: DateTime<Utc>,
            ) -> Result<bool, RepoError> {
                unimplemented!()
            }
            async fn revoke_device(&self, device_id: i64) -> Result<(), RepoError> {
                self.revoked.lock().unwrap().push(device_id);
                Ok(())
            }
            async fn is_device_revoked(&self, device_id: i64) -> Result<bool, RepoError> {
                Ok(self.revoked.lock().unwrap().contains(&device_id))
            }
        }

        #[derive(Default)]
        struct FakeEvents {
            revoked: Mutex<Vec<i64>>,
        }
        #[async_trait]
        impl EventBus for FakeEvents {
            async fn publish_to_users(&self, _: &[i64], _: Bytes) -> anyhow::Result<()> {
                unimplemented!()
            }
            async fn subscribe_user(&self, _: i64) -> anyhow::Result<BoxStream<'static, Bytes>> {
                unimplemented!()
            }
            async fn publish_device_revoked(&self, device_id: i64) -> anyhow::Result<()> {
                self.revoked.lock().unwrap().push(device_id);
                Ok(())
            }
        }

        fn setup() -> (AuthService, Arc<FakeRepo>, Arc<FakeEvents>) {
            let repo = Arc::new(FakeRepo::default());
            let events = Arc::new(FakeEvents::default());
            let service = AuthService::new(
                Arc::new(NoIdentity),
                Arc::new(NoUsers),
                repo.clone(),
                Arc::new(TokenService::new(SigningKey::from_bytes(&[7u8; 32]))),
                Arc::new(Snowflake::new(1)),
                events.clone(),
            );
            (service, repo, events)
        }

        #[tokio::test]
        async fn logout_revokes_and_tells_sockets() {
            let (service, repo, events) = setup();
            assert!(!service.is_device_revoked(42).await.unwrap());
            service.logout(42).await.unwrap();
            assert_eq!(*repo.revoked.lock().unwrap(), vec![42]);
            assert_eq!(*events.revoked.lock().unwrap(), vec![42]);
            assert!(service.is_device_revoked(42).await.unwrap());
        }

        #[tokio::test]
        async fn refresh_reuse_revokes_and_tells_sockets() {
            let (service, repo, events) = setup();
            *repo.token.lock().unwrap() = Some(RefreshTokenRecord {
                id: 1,
                device_id: 7,
                user_id: 3,
                expires_at: Utc::now() + Duration::days(1),
                used_at: Some(Utc::now() - Duration::minutes(5)),
                device_revoked_at: None,
            });
            let err = service.refresh("stolen").await.err().unwrap();
            assert!(matches!(
                err,
                ApiError::Unauthorized("refresh_token_reused")
            ));
            assert_eq!(*events.revoked.lock().unwrap(), vec![7]);
        }
    }
}
