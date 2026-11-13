//! Identity provider: checks passwords and owns accounts. Only this file
//! knows about Zitadel; swapping providers means a new `IdentityProvider` impl.

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
    /// Creates an account. Returns the provider's user id.
    async fn create_user(&self, email: &str, password: &str) -> Result<String, IdentityError>;
    /// Checks email + password. Returns the provider's user id.
    async fn verify_password(&self, email: &str, password: &str) -> Result<String, IdentityError>;
}

/// Talks to Zitadel's v2 User and Session APIs with a service account token.
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
        res.json::<ZitadelError>().await.unwrap_or(ZitadelError {
            code: -1,
            message: format!("zitadel returned {status}"),
        })
    }
}

#[async_trait]
impl IdentityProvider for ZitadelClient {
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
            return Ok(created.user_id);
        }

        let err = Self::error_of(res).await;
        Err(match err.code {
            6 => IdentityError::EmailTaken, // ALREADY_EXISTS
            3 if err.message.contains("Password") => {
                IdentityError::WeakPassword(strip_id(&err.message))
            }
            _ => anyhow::anyhow!("zitadel create user: {} ({})", err.message, err.code).into(),
        })
    }

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
            return Err(match err.code {
                // INVALID_ARGUMENT (wrong password), NOT_FOUND (no user),
                // FAILED_PRECONDITION (locked/inactive): all look the same to the client.
                3 | 5 | 9 => IdentityError::InvalidCredentials,
                _ => {
                    anyhow::anyhow!("zitadel create session: {} ({})", err.message, err.code).into()
                }
            });
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Created {
            session_id: String,
            session_token: String,
        }
        let session: Created = res.json().await.map_err(anyhow::Error::from)?;

        // Read the session to learn which user it belongs to.
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

        // We only needed the password check; don't leave sessions lying around.
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

        Ok(user_id)
    }
}

/// "Password is too short (COMMA-HuJf6)" -> "Password is too short"
fn strip_id(message: &str) -> String {
    message.split(" (").next().unwrap_or(message).to_string()
}
