//! Wiring: build every repository, client and service once, then mount
//! each feature's routes.

use std::sync::Arc;

use axum::Router;
use axum::http::{HeaderValue, Method, header};
use axum::middleware;
use common::snowflake::Snowflake;
use metrics_exporter_prometheus::PrometheusHandle;
use tower_http::cors::CorsLayer;

use crate::common::events::{EventBus, NatsEventBus};
use crate::common::middleware::http_metrics;
use crate::common::middleware::rate_limit::RateLimiter;
use crate::config::Config;
use crate::features::auth::identity::ZitadelClient;
use crate::features::auth::repository::PgAuthRepo;
use crate::features::auth::service::AuthService;
use crate::features::auth::tokens::TokenService;
use crate::features::calls::media::NatsMediaClient;
use crate::features::calls::service::CallService;
use crate::features::calls::store::MemoryCallStore;
use crate::features::conversations::repository::{ConversationRepo, ScyllaConversationRepo};
use crate::features::conversations::service::ConversationService;
use crate::features::messages::repository::ScyllaMessageRepo;
use crate::features::messages::service::MessageService;
use crate::features::users::repository::{PgUserRepo, UserRepo};
use crate::features::users::service::UserService;
use crate::features::{auth, gateway, health, users};

#[derive(Clone)]
pub struct AppState {
    pub auth: Arc<AuthService>,
    pub users: Arc<UserService>,
    pub conversations: Arc<ConversationService>,
    pub messages: Arc<MessageService>,
    pub calls: Arc<CallService>,
    pub tokens: Arc<TokenService>,
    pub limiter: Arc<RateLimiter>,
    pub events: Arc<dyn EventBus>,
}

pub async fn build(config: &Config, prometheus: PrometheusHandle) -> anyhow::Result<Router> {
    let pool = crate::common::db::connect(&config.database_url).await?;
    let scylla = crate::common::scylla::connect(
        &config.scylla_nodes,
        &config.scylla_keyspace,
        config.scylla_replication,
    )
    .await?;
    let events: Arc<dyn EventBus> = Arc::new(NatsEventBus::connect(&config.nats_url).await?);
    let ids = Arc::new(Snowflake::new(config.machine_id));
    let tokens = Arc::new(TokenService::from_key_file(
        &config.signing_key_file,
        !config.is_production(),
    )?);

    // Repositories (swap in cached versions here later)
    let user_repo: Arc<dyn UserRepo> = Arc::new(PgUserRepo::new(pool.clone()));
    let auth_repo = Arc::new(PgAuthRepo::new(pool.clone()));
    let identity = Arc::new(ZitadelClient::new(&config.zitadel_url, &config.zitadel_pat));

    let conversation_repo: Arc<dyn ConversationRepo> =
        Arc::new(ScyllaConversationRepo::new(scylla.clone()).await?);
    let message_repo = Arc::new(ScyllaMessageRepo::new(scylla).await?);

    let state = AppState {
        auth: Arc::new(AuthService::new(
            identity,
            user_repo.clone(),
            auth_repo,
            tokens.clone(),
            ids.clone(),
        )),
        messages: Arc::new(MessageService::new(
            message_repo,
            conversation_repo.clone(),
            events.clone(),
            ids.clone(),
        )),
        conversations: Arc::new(ConversationService::new(
            conversation_repo.clone(),
            user_repo.clone(),
            events.clone(),
            ids.clone(),
        )),
        calls: Arc::new(CallService::new(
            Arc::new(MemoryCallStore::default()),
            conversation_repo.clone(),
            Arc::new(NatsMediaClient::connect(&config.nats_url).await?),
            events.clone(),
            ids,
        )),
        users: Arc::new(UserService::new(user_repo)),
        tokens,
        limiter: Arc::new(RateLimiter::default()),
        events,
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
        .layer(middleware::from_fn(http_metrics::track))
        .layer(cors)
        .with_state(state))
}
