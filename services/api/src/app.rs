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
use crate::common::storage::{S3Config, S3FileStore};
use crate::config::Config;
use crate::features::attachments::repository::PgAttachmentRepo;
use crate::features::attachments::service::{AttachmentService, Limits};
use crate::features::auth::identity::ZitadelClient;
use crate::features::auth::repository::PgAuthRepo;
use crate::features::auth::service::AuthService;
use crate::features::auth::tokens::TokenService;
use crate::features::calls::media::NatsMediaClient;
use crate::features::calls::service::CallService;
use crate::features::calls::store::MemoryCallStore;
use crate::features::conversations::repository::{ConversationRepo, ScyllaConversationRepo};
use crate::features::conversations::service::ConversationService;
use crate::features::friends::repository::PgFriendRepo;
use crate::features::friends::service::FriendService;
use crate::features::messages::repository::ScyllaMessageRepo;
use crate::features::messages::service::MessageService;
use crate::features::presence::service::PresenceService;
use crate::features::presence::store::RedisPresenceStore;
use crate::features::typing::service::TypingService;
use crate::features::users::repository::{PgUserRepo, UserRepo};
use crate::features::users::service::UserService;
use crate::features::{attachments, auth, friends, gateway, health, users};

#[derive(Clone)]
pub struct AppState {
    pub attachments: Arc<AttachmentService>,
    pub auth: Arc<AuthService>,
    pub users: Arc<UserService>,
    pub conversations: Arc<ConversationService>,
    pub friends: Arc<FriendService>,
    pub messages: Arc<MessageService>,
    pub calls: Arc<CallService>,
    pub presence: Arc<PresenceService>,
    pub typing: Arc<TypingService>,
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
    let redis = crate::common::redis::connect(&config.redis_url).await?;
    let events: Arc<dyn EventBus> = Arc::new(NatsEventBus::connect(&config.nats_url).await?);
    let ids = Arc::new(Snowflake::new(config.machine_id));
    let tokens = Arc::new(TokenService::from_key_file(
        &config.signing_key_file,
        !config.is_production(),
    )?);

    let user_repo: Arc<dyn UserRepo> = Arc::new(PgUserRepo::new(pool.clone()));
    let auth_repo = Arc::new(PgAuthRepo::new(pool.clone()));
    let identity = Arc::new(ZitadelClient::new(&config.zitadel_url, &config.zitadel_pat));

    let conversation_repo: Arc<dyn ConversationRepo> =
        Arc::new(ScyllaConversationRepo::new(scylla.clone()).await?);
    let message_repo = Arc::new(ScyllaMessageRepo::new(scylla).await?);
    let friend_repo = Arc::new(PgFriendRepo::new(pool.clone()));
    let presence_store = Arc::new(RedisPresenceStore::new(
        redis,
        crate::features::gateway::PRESENCE_TTL,
    ));

    let file_store: Arc<S3FileStore> = Arc::new(S3FileStore::new(&S3Config {
        endpoint: &config.s3_endpoint,
        public_endpoint: config.s3_public_endpoint.as_deref(),
        region: &config.s3_region,
        bucket: &config.s3_bucket,
        access_key: &config.s3_access_key,
        secret_key: &config.s3_secret_key,
    }));
    if !config.is_production() {
        file_store.ensure_bucket().await?;
    }
    let attachment_service = Arc::new(AttachmentService::new(
        Arc::new(PgAttachmentRepo::new(pool.clone())),
        conversation_repo.clone(),
        file_store.clone(),
        ids.clone(),
        Limits {
            max_bytes: config.attachment_max_bytes,
            ttl: std::time::Duration::from_secs(config.attachment_ttl_hours * 60 * 60),
        },
    ));
    attachments::spawn_cleanup(
        attachment_service.clone(),
        std::time::Duration::from_secs(60 * 60),
    );

    let state = AppState {
        attachments: attachment_service.clone(),
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
            attachment_service.clone(),
        )),
        conversations: Arc::new(ConversationService::new(
            conversation_repo.clone(),
            user_repo.clone(),
            events.clone(),
            ids.clone(),
        )),
        typing: Arc::new(TypingService::new(
            conversation_repo.clone(),
            events.clone(),
        )),
        calls: Arc::new(CallService::new(
            Arc::new(MemoryCallStore::default()),
            conversation_repo.clone(),
            Arc::new(NatsMediaClient::connect(&config.nats_url).await?),
            events.clone(),
            ids,
        )),
        presence: Arc::new(PresenceService::new(
            presence_store,
            friend_repo.clone(),
            conversation_repo.clone(),
            events.clone(),
        )),
        users: Arc::new(UserService::new(
            user_repo.clone(),
            file_store,
            friend_repo.clone(),
            conversation_repo.clone(),
            events.clone(),
        )),
        friends: Arc::new(FriendService::new(
            friend_repo,
            user_repo.clone(),
            events.clone(),
        )),
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
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::HeaderName::from_static(attachments::CHUNK_HASH_HEADER),
        ]);

    Ok(Router::new()
        .merge(health::routes(prometheus))
        .merge(auth::routes())
        .merge(users::routes())
        .merge(friends::routes())
        .merge(attachments::routes())
        .merge(gateway::routes())
        .layer(middleware::from_fn(http_metrics::track))
        .layer(cors)
        .with_state(state))
}
