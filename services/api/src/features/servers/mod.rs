use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use common::snowflake::Snowflake;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::app::AppState;
use crate::common::error::{ApiError, RepoError};
use crate::common::middleware::auth::AuthUser;

const DEFAULT_CHANNEL_NAME: &str = "general";

pub struct ServerService {
    pool: PgPool,
    ids: Arc<Snowflake>,
}

impl ServerService {
    pub fn new(pool: PgPool, ids: Arc<Snowflake>) -> Self {
        Self { pool, ids }
    }

    async fn create(&self, user_id: i64, name: &str) -> Result<CreatedServer, ApiError> {
        let name = name.trim();
        if !(1..=100).contains(&name.chars().count()) || name.contains('\0') {
            return Err(ApiError::bad_request(
                "invalid_server_name",
                "Server name must be 1 to 100 characters and cannot contain null characters",
            ));
        }

        let server_id = self.ids.next_id() as i64;
        let channel_id = self.ids.next_id() as i64;
        let mut transaction = self.pool.begin().await.map_err(RepoError::from)?;
        sqlx::query("INSERT INTO servers (id, name) VALUES ($1, $2)")
            .bind(server_id)
            .bind(name)
            .execute(&mut *transaction)
            .await
            .map_err(RepoError::from)?;
        sqlx::query(
            "INSERT INTO server_members (server_id, user_id, role) VALUES ($1, $2, 'owner')",
        )
        .bind(server_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(RepoError::from)?;
        sqlx::query("INSERT INTO server_channels (id, server_id, name) VALUES ($1, $2, $3)")
            .bind(channel_id)
            .bind(server_id)
            .bind(DEFAULT_CHANNEL_NAME)
            .execute(&mut *transaction)
            .await
            .map_err(RepoError::from)?;
        transaction.commit().await.map_err(RepoError::from)?;

        Ok(CreatedServer {
            server: NamedResource::new(server_id, name.into()),
            default_channel: NamedResource::new(channel_id, DEFAULT_CHANNEL_NAME.into()),
        })
    }

    async fn list(&self, user_id: i64) -> Result<Vec<NamedResource>, RepoError> {
        let servers = sqlx::query_as::<_, (i64, String)>(
            "SELECT s.id, s.name
             FROM server_members m JOIN servers s ON s.id = m.server_id
             WHERE m.user_id = $1 ORDER BY s.id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(servers
            .into_iter()
            .map(|(id, name)| NamedResource::new(id, name))
            .collect())
    }

    async fn list_channels(
        &self,
        user_id: i64,
        server_id: i64,
    ) -> Result<Vec<NamedResource>, ApiError> {
        let rows = sqlx::query_as::<_, (Option<i64>, Option<String>)>(
            "SELECT c.id, c.name
             FROM server_members m LEFT JOIN server_channels c ON c.server_id = m.server_id
             WHERE m.user_id = $1 AND m.server_id = $2 ORDER BY c.id",
        )
        .bind(user_id)
        .bind(server_id)
        .fetch_all(&self.pool)
        .await
        .map_err(RepoError::from)?;
        if rows.is_empty() {
            return Err(ApiError::NotFound);
        }
        Ok(rows
            .into_iter()
            .filter_map(|(id, name)| Some(NamedResource::new(id?, name?)))
            .collect())
    }
}

#[derive(Deserialize)]
struct CreateServer {
    name: String,
}

#[derive(Serialize)]
struct NamedResource {
    id: String,
    name: String,
}

impl NamedResource {
    fn new(id: i64, name: String) -> Self {
        Self {
            id: id.to_string(),
            name,
        }
    }
}

#[derive(Serialize)]
struct CreatedServer {
    server: NamedResource,
    default_channel: NamedResource,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/servers", get(list).post(create))
        .route("/servers/{server_id}/channels", get(list_channels))
}

async fn create(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateServer>,
) -> Result<(StatusCode, Json<CreatedServer>), ApiError> {
    let created = state.servers.create(auth.user_id, &body.name).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn list(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<NamedResource>>, ApiError> {
    Ok(Json(state.servers.list(auth.user_id).await?))
}

async fn list_channels(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
) -> Result<Json<Vec<NamedResource>>, ApiError> {
    Ok(Json(
        state.servers.list_channels(auth.user_id, server_id).await?,
    ))
}
