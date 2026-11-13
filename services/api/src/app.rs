//! Wiring: build every repository, client and service once, then mount
//! each feature's routes.

use std::sync::Arc;

use axum::Router;
use axum::http::{HeaderValue, Method, header};
use common::snowflake::Snowflake;
use metrics_exporter_prometheus::PrometheusHandle;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::common::middleware::rate_limit::RateLimiter;
use crate::config::Config;
use crate::features::auth::identity::ZitadelClient;
use crate::features::auth::repository::PgAuthRepo;
use crate::features::auth::service::AuthService;
use crate::features::auth::tokens::TokenService;
use crate::features::users::repository::{PgUserRepo, UserRepo};
use crate::features::users::service::UserService;
use crate::features::{auth, gateway, health, users};

#[derive(Clone)]
pub struct AppState {
    pub auth: Arc<AuthService>,
    pub users: Arc<UserService>,
    pub tokens: Arc<TokenService>,
    pub limiter: Arc<RateLimiter>,
}

pub async fn build(config: &Config, prometheus: PrometheusHandle) -> anyhow::Result<Router> {
    let pool = crate::common::db::connect(&config.database_url).await?;
    let ids = Arc::new(Snowflake::new(config.machine_id));
    let tokens = Arc::new(TokenService::from_key_file(&config.signing_key_file)?);

    // Repositories (swap in cached versions here later)
    let user_repo: Arc<dyn UserRepo> = Arc::new(PgUserRepo::new(pool.clone()));
    let auth_repo = Arc::new(PgAuthRepo::new(pool.clone()));
    let identity = Arc::new(ZitadelClient::new(&config.zitadel_url, &config.zitadel_pat));

    let state = AppState {
        auth: Arc::new(AuthService::new(
            identity,
            user_repo.clone(),
            auth_repo,
            tokens.clone(),
            ids,
        )),
        users: Arc::new(UserService::new(user_repo)),
        tokens,
        limiter: Arc::new(RateLimiter::default()),
    };

    let origins: Vec<HeaderValue> = config
        .cors_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    Ok(Router::new()
        .merge(health::routes(prometheus))
        .merge(auth::routes())
        .merge(users::routes())
        .merge(gateway::routes())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state))
}
