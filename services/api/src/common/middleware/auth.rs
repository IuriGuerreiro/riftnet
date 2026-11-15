use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;

use crate::app::AppState;
use crate::common::error::ApiError;

#[derive(Debug, Clone, Copy)]
pub struct AuthUser {
    pub user_id: i64,
    pub device_id: i64,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(ApiError::Unauthorized("missing_token"))?;

        let claims = state
            .tokens
            .verify_access(token)
            .map_err(|_| ApiError::Unauthorized("invalid_token"))?;

        let span = tracing::Span::current();
        span.record("user.id", claims.user_id);
        span.record("device.id", claims.device_id);
        Ok(AuthUser {
            user_id: claims.user_id,
            device_id: claims.device_id,
        })
    }
}
