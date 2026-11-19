use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("authentication busy")]
    Busy,
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
    async fn verify_password(
        &self,
        email: &str,
        password: &str,
        user_id: Option<&str>,
    ) -> Result<String, IdentityError>;
}

pub struct ZitadelClient {
    http: reqwest::Client,
    base_url: String,
    token: String,
    checks: tokio::sync::Semaphore,
}

#[derive(Deserialize)]
struct ZitadelError {
    code: i32,
    message: String,
}

impl ZitadelClient {
    pub fn new(base_url: impl Into<String>, token: impl Into<String>, concurrency: usize) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("HTTP client"),
            checks: tokio::sync::Semaphore::new(concurrency),
            base_url: base_url.into(),
            token: token.into(),
        }
    }

    async fn permit(&self) -> Result<tokio::sync::SemaphorePermit<'_>, IdentityError> {
        let start = std::time::Instant::now();
        let result =
            tokio::time::timeout(std::time::Duration::from_millis(250), self.checks.acquire())
                .await;
        metrics::histogram!("auth_identity_queue_seconds").record(start.elapsed().as_secs_f64());
        match result {
            Ok(Ok(permit)) => Ok(permit),
            _ => {
                metrics::counter!("auth_identity_overload_total").increment(1);
                tracing::Span::current().record("outcome", "busy");
                Err(IdentityError::Busy)
            }
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
        let _permit = self.permit().await?;
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
    async fn verify_password(
        &self,
        email: &str,
        password: &str,
        user_id: Option<&str>,
    ) -> Result<String, IdentityError> {
        let _permit = self.permit().await?;
        let user_check = match user_id {
            Some(id) => json!({ "userId": id }),
            None => json!({ "loginName": email }),
        };
        let res = self
            .http
            .post(self.url("/v2/sessions"))
            .bearer_auth(&self.token)
            .json(&json!({
                "checks": {
                    "user": user_check,
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

        let user_id = if let Some(id) = user_id {
            id.to_owned()
        } else {
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
            details["session"]["factors"]["user"]["id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("zitadel session has no user id"))?
                .to_string()
        };

        let delete = self
            .http
            .delete(self.url(&format!("/v2/sessions/{}", session.session_id)))
            .bearer_auth(&self.token)
            .json(&json!({ "sessionToken": session.session_token }))
            .send()
            .await
            .and_then(|r| r.error_for_status());
        if let Err(err) = delete {
            tracing::warn!(error = %err, "failed to delete zitadel session");
        }

        tracing::Span::current().record("outcome", "ok");
        Ok(user_id)
    }
}

fn identity_outcome(err: &IdentityError) -> &'static str {
    match err {
        IdentityError::Busy => "busy",
        IdentityError::InvalidCredentials => "invalid_credentials",
        IdentityError::EmailTaken => "email_taken",
        IdentityError::WeakPassword(_) => "weak_password",
        IdentityError::Other(_) => "error",
    }
}

fn strip_id(message: &str) -> String {
    message.split(" (").next().unwrap_or(message).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn existing_account_without_email_uses_login_name_and_session_get() {
        use axum::{
            Json, Router,
            routing::{get, post},
        };
        let app = Router::new()
            .route(
                "/v2/sessions",
                post(|Json(body): Json<serde_json::Value>| async move {
                    assert_eq!(body["checks"]["user"]["loginName"], "old@example.com");
                    Json(json!({"sessionId": "session", "sessionToken": "token"}))
                }),
            )
            .route(
                "/v2/sessions/session",
                get(|| async { Json(json!({"session": {"factors": {"user": {"id": "old"}}}})) })
                    .delete(|| async { axum::http::StatusCode::OK }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = ZitadelClient::new(format!("http://{addr}"), "unused", 2);
        assert_eq!(
            client
                .verify_password("old@example.com", "secret", None)
                .await
                .unwrap(),
            "old"
        );
        server.abort();
    }

    #[tokio::test]
    async fn invalid_password_never_returns_cached_identity() {
        use axum::{Router, routing::post};
        let app = Router::new().route(
            "/v2/sessions",
            post(|| async {
                (
                    axum::http::StatusCode::BAD_REQUEST,
                    axum::Json(json!({"code": 3, "message": "invalid password"})),
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = ZitadelClient::new(format!("http://{addr}"), "unused", 2);
        assert!(matches!(
            client
                .verify_password("user@example.com", "wrong", Some("known"))
                .await,
            Err(IdentityError::InvalidCredentials)
        ));
        assert_eq!(client.checks.available_permits(), 2);
        server.abort();
    }

    #[tokio::test]
    async fn known_user_skips_session_get_and_checks_password() {
        use axum::{
            Json, Router,
            routing::{delete, post},
        };
        let app = Router::new()
            .route(
                "/v2/sessions",
                post(|Json(body): Json<serde_json::Value>| async move {
                    assert_eq!(body["checks"]["user"]["userId"], "known");
                    assert_eq!(body["checks"]["password"]["password"], "secret");
                    Json(json!({"sessionId": "session", "sessionToken": "token"}))
                }),
            )
            .route(
                "/v2/sessions/session",
                delete(|| async { axum::http::StatusCode::OK }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = ZitadelClient::new(format!("http://{addr}"), "unused", 2);
        assert_eq!(
            client
                .verify_password("user@example.com", "secret", Some("known"))
                .await
                .unwrap(),
            "known"
        );
        server.abort();
    }

    #[tokio::test]
    async fn saturated_checks_reject_and_recover() {
        let client = ZitadelClient::new("http://localhost", "unused", 2);
        let first = client.permit().await.unwrap();
        let second = client.permit().await.unwrap();
        assert!(matches!(client.permit().await, Err(IdentityError::Busy)));
        drop(first);
        let recovered = client.permit().await.unwrap();
        drop((second, recovered));
        assert_eq!(client.checks.available_permits(), 2);
    }
}
