use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("email already registered")]
    EmailTaken,
    #[error("weak password: {0}")]
    WeakPassword(String),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[async_trait]
pub trait IdentityProvider: Send + Sync {
    async fn create_user(&self, email: &str, password: &str) -> Result<String, IdentityError>;
    async fn verify_password(&self, email: &str, password: &str) -> Result<String, IdentityError>;
}

pub struct ZitadelClient {
    http: reqwest::Client,
    base_url: String,
    token: String,
}

#[derive(Deserialize)]
struct ZitadelError {
    code: i32,
    message: String,
}

impl ZitadelClient {
    pub fn new(base_url: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into(),
            token: token.into(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url.trim_end_matches('/'), path)
    }

    async fn error_of(res: reqwest::Response) -> ZitadelError {
        let status = res.status();
        tracing::Span::current().record("zitadel.status", status.as_u16());
        res.json::<ZitadelError>().await.unwrap_or(ZitadelError {
            code: -1,
            message: format!("zitadel returned {status}"),
        })
    }
}

#[async_trait]
impl IdentityProvider for ZitadelClient {
    #[tracing::instrument(name = "zitadel create_user", skip_all, fields(otel.kind = "client", peer.service = "zitadel", zitadel.status = tracing::field::Empty, outcome = tracing::field::Empty))]
    async fn create_user(&self, email: &str, password: &str) -> Result<String, IdentityError> {
        let given_name = email.split('@').next().unwrap_or("user");
        let res = self
            .http
            .post(self.url("/v2/users/human"))
            .bearer_auth(&self.token)
            .json(&json!({
                "username": email,
                "profile": { "givenName": given_name, "familyName": "-" },
                "email": { "email": email, "isVerified": false },
                "password": { "password": password, "changeRequired": false },
            }))
            .send()
            .await
            .map_err(anyhow::Error::from)?;

        if res.status().is_success() {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Created {
                user_id: String,
            }
            let created: Created = res.json().await.map_err(anyhow::Error::from)?;
            tracing::Span::current().record("outcome", "created");
            return Ok(created.user_id);
        }

        let err = Self::error_of(res).await;
        let result = match err.code {
            6 => IdentityError::EmailTaken,
            3 if err.message.contains("Password") => {
                IdentityError::WeakPassword(strip_id(&err.message))
            }
            _ => anyhow::anyhow!("zitadel create user: {} ({})", err.message, err.code).into(),
        };
        tracing::Span::current().record("outcome", identity_outcome(&result));
        Err(result)
    }

    #[tracing::instrument(name = "zitadel verify_password", skip_all, fields(otel.kind = "client", peer.service = "zitadel", zitadel.status = tracing::field::Empty, outcome = tracing::field::Empty))]
    async fn verify_password(&self, email: &str, password: &str) -> Result<String, IdentityError> {
        let res = self
            .http
            .post(self.url("/v2/sessions"))
            .bearer_auth(&self.token)
            .json(&json!({
                "checks": {
                    "user": { "loginName": email },
                    "password": { "password": password },
                }
            }))
            .send()
            .await
            .map_err(anyhow::Error::from)?;

        if !res.status().is_success() {
            let err = Self::error_of(res).await;
            let result = match err.code {
                3 | 5 | 9 => IdentityError::InvalidCredentials,
                _ => {
                    anyhow::anyhow!("zitadel create session: {} ({})", err.message, err.code).into()
                }
            };
            tracing::Span::current().record("outcome", identity_outcome(&result));
            return Err(result);
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Created {
            session_id: String,
            session_token: String,
        }
        let session: Created = res.json().await.map_err(anyhow::Error::from)?;

        let details: serde_json::Value = self
            .http
            .get(self.url(&format!("/v2/sessions/{}", session.session_id)))
            .bearer_auth(&self.token)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(anyhow::Error::from)?
            .json()
            .await
            .map_err(anyhow::Error::from)?;
        let user_id = details["session"]["factors"]["user"]["id"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("zitadel session has no user id"))?
            .to_string();

        let delete = self
            .http
            .delete(self.url(&format!("/v2/sessions/{}", session.session_id)))
            .bearer_auth(&self.token)
            .json(&json!({ "sessionToken": session.session_token }))
            .send()
            .await;
        if let Err(err) = delete {
            tracing::warn!(error = %err, "failed to delete zitadel session");
        }

        tracing::Span::current().record("outcome", "ok");
        Ok(user_id)
    }
}

fn identity_outcome(err: &IdentityError) -> &'static str {
    match err {
        IdentityError::InvalidCredentials => "invalid_credentials",
        IdentityError::EmailTaken => "email_taken",
        IdentityError::WeakPassword(_) => "weak_password",
        IdentityError::Other(_) => "error",
    }
}

fn strip_id(message: &str) -> String {
    message.split(" (").next().unwrap_or(message).to_string()
}
