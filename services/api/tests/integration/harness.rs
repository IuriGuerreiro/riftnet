use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use api::config::Config;
use api::features::auth::tokens::TokenService;
use futures::{SinkExt, StreamExt};
use metrics_exporter_prometheus::PrometheusBuilder;
use protocol::Message as _;
use protocol::v1::{self, Envelope, envelope::Payload};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub const TEST_DB: &str = "api_it";
pub const TEST_KEYSPACE: &str = "api_it";
const WAIT: Duration = Duration::from_secs(5);

pub struct Server {
    pub addr: SocketAddr,
    pub tokens: Arc<TokenService>,
    pub database_url: String,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn admin_database_url() -> String {
    env_or("IT_DATABASE_URL", "postgres://app:app@127.0.0.1:55432/app")
}

fn test_database_url() -> String {
    let admin = admin_database_url();
    let base = admin.rsplit_once('/').map_or(admin.as_str(), |(b, _)| b);
    format!("{base}/{TEST_DB}")
}

fn scylla_nodes() -> Vec<String> {
    env_or("SCYLLA_NODES", "127.0.0.1:9042")
        .split(',')
        .map(|s| s.trim().to_string())
        .collect()
}

pub fn server() -> &'static Server {
    static SERVER: OnceLock<Server> = OnceLock::new();
    SERVER.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().expect("runtime");
            rt.block_on(async move {
                let ready = boot().await;
                let (listener, app, server) = match ready {
                    Ok(ok) => ok,
                    Err(err) => {
                        tx.send(Err(format!("{err:#}"))).ok();
                        return;
                    }
                };
                tx.send(Ok(server)).ok();
                axum::serve(
                    listener,
                    app.into_make_service_with_connect_info::<SocketAddr>(),
                )
                .await
                .expect("serve");
            });
        });
        match rx.recv().expect("server thread died") {
            Ok(server) => server,
            Err(err) => panic!("test server failed to start (is infra up?): {err}"),
        }
    })
}

async fn boot() -> anyhow::Result<(tokio::net::TcpListener, axum::Router, Server)> {
    reset_postgres().await?;
    reset_scylla().await?;

    let key_dir = std::env::temp_dir().join(format!("api-it-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&key_dir);
    let key_file = key_dir.join("signing_key");
    let database_url = test_database_url();
    let config = Config {
        env: "test".into(),
        addr: "127.0.0.1:0".parse()?,
        database_url: database_url.clone(),
        nats_url: env_or("NATS_URL", "nats://127.0.0.1:4222"),
        redis_url: env_or("REDIS_URL", "redis://127.0.0.1:6379"),
        scylla_nodes: scylla_nodes(),
        scylla_keyspace: TEST_KEYSPACE.into(),
        scylla_replication: 1,
        zitadel_url: "http://127.0.0.1:9".into(),
        zitadel_pat: "unused".into(),
        signing_key_file: key_file.clone(),
        machine_id: 1000,
        cors_origins: vec![],
        s3_endpoint: env_or("S3_ENDPOINT", "http://127.0.0.1:7106"),
        s3_public_endpoint: None,
        s3_region: "auto".into(),
        s3_bucket: "api-it".into(),
        s3_access_key: env_or("S3_ACCESS_KEY", "minio"),
        s3_secret_key: env_or("S3_SECRET_KEY", "minio-dev-secret"),
        attachment_max_bytes: 1024 * 1024,
        attachment_ttl_hours: 1,
    };
    let prometheus = PrometheusBuilder::new().build_recorder().handle();
    let app = api::app::build(&config, prometheus).await?;
    let tokens = Arc::new(TokenService::from_key_file(&key_file, false)?);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    Ok((
        listener,
        app,
        Server {
            addr,
            tokens,
            database_url,
        },
    ))
}

async fn reset_postgres() -> anyhow::Result<()> {
    let admin = sqlx::PgPool::connect(&admin_database_url()).await?;
    sqlx::query(&format!("DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)"))
        .execute(&admin)
        .await?;
    sqlx::query(&format!("CREATE DATABASE {TEST_DB}"))
        .execute(&admin)
        .await?;
    Ok(())
}

async fn reset_scylla() -> anyhow::Result<()> {
    let session = scylla::client::session_builder::SessionBuilder::new()
        .known_nodes(scylla_nodes())
        .build()
        .await?;
    session
        .query_unpaged(format!("DROP KEYSPACE IF EXISTS {TEST_KEYSPACE}"), ())
        .await?;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct TestUser {
    pub id: i64,
    pub username: String,
    pub token: String,
}

pub async fn seed_user() -> TestUser {
    let server = server();
    let db = sqlx::PgPool::connect(&server.database_url)
        .await
        .expect("connect test db");
    let id = (rand::random::<u32>() as i64) << 20 | rand::random::<u16>() as i64;
    let device_id = id + 1;
    let username = format!("it_{:x}", rand::random::<u64>());
    sqlx::query("INSERT INTO users (id, zitadel_id, username) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(format!("it-{id}"))
        .bind(&username)
        .execute(&db)
        .await
        .expect("insert user");
    sqlx::query("INSERT INTO devices (id, user_id, name, platform) VALUES ($1, $2, 'it', 'test')")
        .bind(device_id)
        .bind(id)
        .execute(&db)
        .await
        .expect("insert device");
    db.close().await;
    let (token, _) = server
        .tokens
        .issue_access(id, device_id, chrono::Utc::now().timestamp());
    TestUser {
        id,
        username,
        token,
    }
}

pub struct Http {
    client: reqwest::Client,
    base: String,
}

impl Http {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            base: format!("http://{}", server().addr),
        }
    }

    pub fn post(&self, user: &TestUser, path: &str) -> reqwest::RequestBuilder {
        self.client
            .post(format!("{}{path}", self.base))
            .bearer_auth(&user.token)
    }

    pub fn get(&self, user: &TestUser, path: &str) -> reqwest::RequestBuilder {
        self.client
            .get(format!("{}{path}", self.base))
            .bearer_auth(&user.token)
    }

    pub fn delete(&self, user: &TestUser, path: &str) -> reqwest::RequestBuilder {
        self.client
            .delete(format!("{}{path}", self.base))
            .bearer_auth(&user.token)
    }
}

pub struct Client {
    pub user: TestUser,
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    next_id: u64,
    pushes: VecDeque<Payload>,
}

impl Client {
    pub async fn connect(user: &TestUser) -> Self {
        let url = format!("ws://{}/ws", server().addr);
        let (ws, _) = tokio_tungstenite::connect_async(url)
            .await
            .expect("ws connect");
        let mut client = Self {
            user: user.clone(),
            ws,
            next_id: 1,
            pushes: VecDeque::new(),
        };
        let reply = client
            .request(Payload::Authenticate(v1::Authenticate {
                access_token: user.token.clone(),
            }))
            .await;
        assert!(
            matches!(reply, Payload::AuthOk(_)),
            "auth failed: {reply:?}"
        );
        client
    }

    async fn recv(&mut self) -> Option<Envelope> {
        loop {
            match tokio::time::timeout(WAIT, self.ws.next()).await {
                Err(_) => return None,
                Ok(None) | Ok(Some(Err(_))) => return None,
                Ok(Some(Ok(WsMessage::Binary(bytes)))) => {
                    return Some(Envelope::decode(bytes).expect("valid envelope"));
                }
                Ok(Some(Ok(_))) => continue,
            }
        }
    }

    pub async fn request(&mut self, payload: Payload) -> Payload {
        let id = self.next_id;
        self.next_id += 1;
        let env = Envelope {
            id,
            payload: Some(payload),
        };
        self.ws
            .send(WsMessage::Binary(env.encode_to_vec().into()))
            .await
            .expect("ws send");
        loop {
            let env = self.recv().await.expect("no reply before timeout");
            match (env.id, env.payload) {
                (got, Some(p)) if got == id => return p,
                (0, Some(p)) => self.pushes.push_back(p),
                _ => {}
            }
        }
    }

    pub async fn push<T>(&mut self, mut pick: impl FnMut(&Payload) -> Option<T>) -> T {
        self.try_push(&mut pick, WAIT)
            .await
            .unwrap_or_else(|| panic!("{}: expected push did not arrive", self.user.username))
    }

    pub async fn no_push<T>(&mut self, mut pick: impl FnMut(&Payload) -> Option<T>) {
        let got = self.try_push(&mut pick, Duration::from_millis(500)).await;
        assert!(
            got.is_none(),
            "{}: got an unexpected push",
            self.user.username
        );
    }

    async fn try_push<T>(
        &mut self,
        pick: &mut impl FnMut(&Payload) -> Option<T>,
        wait: Duration,
    ) -> Option<T> {
        if let Some(i) = self.pushes.iter().position(|p| pick(p).is_some()) {
            let p = self.pushes.remove(i).expect("index valid");
            return pick(&p);
        }
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            let frame = tokio::time::timeout(left, self.ws.next()).await.ok()??;
            let Ok(WsMessage::Binary(bytes)) = frame else {
                continue;
            };
            let env = Envelope::decode(bytes).expect("valid envelope");
            if let Some(p) = env.payload {
                if let Some(found) = pick(&p) {
                    return Some(found);
                }
                self.pushes.push_back(p);
            }
        }
    }

    pub async fn close(mut self) {
        let _ = self.ws.close(None).await;
    }
}

pub fn error_code(p: &Payload) -> &str {
    match p {
        Payload::Error(e) => &e.code,
        other => panic!("expected an error, got {other:?}"),
    }
}

pub fn conversation(p: Payload) -> v1::Conversation {
    match p {
        Payload::Conversation(r) => r.conversation.expect("conversation"),
        other => panic!("expected a conversation, got {other:?}"),
    }
}

pub fn conversation_update(
    conversation_id: u64,
) -> impl FnMut(&Payload) -> Option<v1::Conversation> {
    move |p| match p {
        Payload::ConversationUpdated(u) => {
            u.conversation.clone().filter(|c| c.id == conversation_id)
        }
        _ => None,
    }
}

pub fn member_ids(c: &v1::Conversation) -> Vec<u64> {
    let mut ids: Vec<u64> = c.members.iter().map(|m| m.id).collect();
    ids.sort_unstable();
    ids
}

pub async fn open_dm(client: &mut Client, other: &TestUser) -> v1::Conversation {
    conversation(
        client
            .request(Payload::OpenDm(v1::OpenDm {
                username: other.username.clone(),
            }))
            .await,
    )
}

pub async fn send_text(client: &mut Client, conversation_id: u64, text: &str) -> v1::Message {
    let reply = client
        .request(Payload::SendMessage(v1::SendMessage {
            conversation_id,
            content: text.as_bytes().to_vec(),
            nonce: format!("n-{:x}", rand::random::<u64>()),
            attachment_ids: vec![],
        }))
        .await;
    match reply {
        Payload::MessageAck(ack) => ack.message.expect("message"),
        other => panic!("send failed: {other:?}"),
    }
}
