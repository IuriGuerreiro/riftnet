use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{message}")]
    BadRequest { code: &'static str, message: String },
    #[error("unauthorized: {0}")]
    Unauthorized(&'static str),
    #[error("{message}")]
    Conflict { code: &'static str, message: String },
    #[error("not found")]
    NotFound,
    #[error("too many requests")]
    TooManyRequests,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl ApiError {
    pub fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self::BadRequest {
            code,
            message: message.into(),
        }
    }

    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self::Conflict {
            code,
            message: message.into(),
        }
    }
}

impl From<RepoError> for ApiError {
    fn from(err: RepoError) -> Self {
        match err {
            RepoError::Conflict => Self::conflict("conflict", "already exists"),
            RepoError::Other(e) => Self::Internal(e),
        }
    }
}

impl ApiError {
    pub fn describe(&self) -> (StatusCode, &'static str, String) {
        match self {
            Self::BadRequest { code, message } => (StatusCode::BAD_REQUEST, *code, message.clone()),
            Self::Unauthorized(code) => (StatusCode::UNAUTHORIZED, *code, "unauthorized".into()),
            Self::Conflict { code, message } => (StatusCode::CONFLICT, *code, message.clone()),
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found", "not found".into()),
            Self::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "too many requests, slow down".into(),
            ),
            Self::Internal(err) => {
                tracing::error!(error = ?err, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "something went wrong".into(),
                )
            }
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = self.describe();
        tracing::Span::current().record("error.code", code);
        (status, Json(json!({ "code": code, "message": message }))).into_response()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RepoError {
    #[error("conflict")]
    Conflict,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl From<sqlx::Error> for RepoError {
    fn from(err: sqlx::Error) -> Self {
        if let sqlx::Error::Database(db) = &err
            && db.is_unique_violation()
        {
            return Self::Conflict;
        }
        Self::Other(err.into())
    }
}
