use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Context;
use api::features::auth::tokens::TokenService;
use futures::{SinkExt, StreamExt};
use protocol::Message as _;
use protocol::v1::{self, Envelope, envelope::Payload};
use tokio::net::TcpStream;
use tokio::sync::Barrier;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

const NAME: &str = "loadtest";
const REPLY_TIMEOUT: Duration = Duration::from_secs(15);
const DELIVERY_TIMEOUT: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_millis(200);
const SEND_TIMEOUT: Duration = Duration::from_secs(5);

struct Settings {
    admin_db: String,
    ws_url: String,
    key_file: PathBuf,
    scylla: Vec<String>,
    steps: Vec<usize>,
    messages: usize,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

impl Settings {
    fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            admin_db: env_or(
                "LT_ADMIN_DATABASE_URL",
                "postgres://app:app@127.0.0.1:55432/app",
            ),
            ws_url: env_or("LT_WS_URL", "ws://127.0.0.1:7171/ws"),
            key_file: env_or("API_SIGNING_KEY_FILE", "").into(),
            scylla: env_or("SCYLLA_NODES", "127.0.0.1:9042")
                .split(',')
                .map(|s| s.trim().to_string())
                .collect(),
            steps: env_or("LT_STEPS", "100,250,500,1000")
                .split(',')
                .map(|s| s.trim().parse())
                .collect::<Result<_, _>>()?,
            messages: env_or("LT_MESSAGES", "5").parse()?,
        })
    }

    fn test_db(&self) -> String {
        let base = self
            .admin_db
            .rsplit_once('/')
            .map_or(self.admin_db.as_str(), |(b, _)| b);
        format!("{base}/{NAME}")
    }
}

#[derive(Clone)]
struct User {
    id: i64,
    username: String,
    device_id: i64,
}

#[derive(Clone, Copy)]
enum Phase {
    Connect,
    Auth,
    OpenDm,
    Send,
    Delivery,
}

const PHASES: [(Phase, &str); 5] = [
    (Phase::Connect, "connect"),
    (Phase::Auth, "auth"),
    (Phase::OpenDm, "open_dm"),
    (Phase::Send, "send"),
    (Phase::Delivery, "delivery"),
];

#[derive(Default)]
struct Stats {
    attempts: [usize; 5],
    failures: [usize; 5],
    errors: BTreeMap<String, usize>,
    connect: Vec<Duration>,
    auth: Vec<Duration>,
    ack: Vec<Duration>,
    delivery: Vec<Duration>,
}

impl Stats {
    fn attempt(&mut self, phase: Phase) {
        self.attempts[phase as usize] += 1;
    }

    fn fail(&mut self, phase: Phase, kind: impl Into<String>, count: usize) {
        self.failures[phase as usize] += count;
        *self.errors.entry(kind.into()).or_default() += count;
    }

    fn total_attempts(&self) -> usize {
        self.attempts.iter().sum()
    }

    fn total_failures(&self) -> usize {
        self.failures.iter().sum()
    }
}

struct Shared {
    stats: Mutex<Stats>,
    acked: Vec<AtomicUsize>,
    done: Vec<AtomicBool>,
    barrier: Barrier,
    origin: Instant,
}

impl Shared {
    fn record(&self, f: impl FnOnce(&mut Stats)) {
        f(&mut self.stats.lock().expect("stats lock"));
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let settings = Settings::from_env()?;
    match std::env::args().nth(1).as_deref() {
        Some("reset") => reset(&settings).await,
        Some("run") => run(&settings).await,
        _ => anyhow::bail!("usage: loadtest reset|run"),
    }
}

async fn reset(s: &Settings) -> anyhow::Result<()> {
    let admin = sqlx::PgPool::connect(&s.admin_db).await?;
    sqlx::query(&format!("DROP DATABASE IF EXISTS {NAME} WITH (FORCE)"))
        .execute(&admin)
        .await?;
    sqlx::query(&format!("CREATE DATABASE {NAME}"))
        .execute(&admin)
        .await?;
    let scylla = scylla::client::session_builder::SessionBuilder::new()
        .known_nodes(&s.scylla)
        .build()
        .await?;
    scylla
        .query_unpaged(format!("DROP KEYSPACE IF EXISTS {NAME}"), ())
        .await?;
    println!("reset database and keyspace '{NAME}'");
    Ok(())
}

async fn seed(s: &Settings, n: usize) -> anyhow::Result<Vec<User>> {
    let db = sqlx::PgPool::connect(&s.test_db()).await?;
    let run = rand::random::<u32>();
    let users: Vec<User> = (0..n)
        .map(|i| {
            let id = ((run as i64) << 24) | ((i as i64) << 1);
            User {
                id,
                username: format!("lt_{run:x}_{i}"),
                device_id: id | 1,
            }
        })
        .collect();
    let ids: Vec<i64> = users.iter().map(|u| u.id).collect();
    let names: Vec<String> = users.iter().map(|u| u.username.clone()).collect();
    let zitadel: Vec<String> = users.iter().map(|u| format!("lt-{}", u.id)).collect();
    let devices: Vec<i64> = users.iter().map(|u| u.device_id).collect();
    sqlx::query(
        "INSERT INTO users (id, zitadel_id, username) SELECT * FROM UNNEST($1::bigint[], $2::text[], $3::text[])",
    )
    .bind(&ids)
    .bind(&zitadel)
    .bind(&names)
    .execute(&db)
    .await?;
    sqlx::query(
        "INSERT INTO devices (id, user_id, name, platform) SELECT d, u, 'loadtest', 'loadtest' FROM UNNEST($1::bigint[], $2::bigint[]) AS t(d, u)",
    )
    .bind(&devices)
    .bind(&ids)
    .execute(&db)
    .await?;
    Ok(users)
}
async fn run(s: &Settings) -> anyhow::Result<()> {
    let tokens = Arc::new(
        TokenService::from_key_file(&s.key_file, false)
            .context("API_SIGNING_KEY_FILE must point at the key the api under test uses")?,
    );
    println!(
        "target {}  steps {:?}  messages/socket {}",
        s.ws_url, s.steps, s.messages
    );
    println!(
        "{:>6} {:>13} {:>7} {:>22} {:>22} {:>22} {:>22}",
        "socks",
        "fail/ops",
        "err%",
        "connect p50/p95/p99",
        "auth p50/p95/p99",
        "ack p50/p95/p99",
        "deliver p50/p95/p99"
    );
    let mut broke = None;
    for &requested in &s.steps {
        let users = seed(s, requested + requested % 2).await?;
        let sockets = users.len();
        let stats = step(s, &tokens, users).await;
        let (fails, ops) = (stats.total_failures(), stats.total_attempts());
        let err_pct = 100.0 * fails as f64 / ops.max(1) as f64;
        println!(
            "{:>6} {:>13} {:>6.2}% {:>22} {:>22} {:>22} {:>22}",
            sockets,
            format!("{fails}/{ops}"),
            err_pct,
            pcts(&stats.connect),
            pcts(&stats.auth),
            pcts(&stats.ack),
            pcts(&stats.delivery),
        );
        for (phase, name) in PHASES {
            let (f, a) = (
                stats.failures[phase as usize],
                stats.attempts[phase as usize],
            );
            if f > 0 {
                println!("         {name}: {f}/{a} failed");
            }
        }
        for (kind, count) in &stats.errors {
            println!("         {count:>6} x {kind}");
        }
        let p99_ack = pct(&stats.ack, 0.99).unwrap_or(Duration::MAX);
        if broke.is_none() && (err_pct > 1.0 || p99_ack > Duration::from_secs(1)) {
            broke = Some(sockets);
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    match broke {
        Some(n) => println!("\nBREAKS at {n} sockets (errors > 1% or p99 ack > 1s)"),
        None => println!("\nheld up at every step (errors <= 1%, p99 ack <= 1s)"),
    }
    Ok(())
}

async fn step(s: &Settings, tokens: &Arc<TokenService>, users: Vec<User>) -> Stats {
    let n = users.len();
    let shared = Arc::new(Shared {
        stats: Mutex::new(Stats::default()),
        acked: (0..n).map(|_| AtomicUsize::new(0)).collect(),
        done: (0..n).map(|_| AtomicBool::new(false)).collect(),
        barrier: Barrier::new(n),
        origin: Instant::now(),
    });
    let mut tasks = Vec::new();
    for (i, me) in users.iter().enumerate() {
        let partner = users[i ^ 1].clone();
        let me = me.clone();
        let (token, _) = tokens.issue_access(me.id, me.device_id, chrono::Utc::now().timestamp());
        let url = s.ws_url.clone();
        let shared = shared.clone();
        let messages = s.messages;
        tasks.push(tokio::spawn(async move {
            socket(i, url, token, me, partner, messages, &shared).await;
            shared.done[i].store(true, Relaxed);
        }));
    }
    for t in tasks {
        if t.await.is_err() {
            shared.record(|s| s.fail(Phase::Connect, "task panicked", 1));
        }
    }
    Arc::try_unwrap(shared)
        .ok()
        .expect("all tasks done")
        .stats
        .into_inner()
        .expect("stats lock")
}

async fn connect_and_auth(url: String, token: String, shared: &Shared) -> Option<Ws> {
    shared.record(|s| s.attempt(Phase::Connect));
    let started = Instant::now();
    let mut ws =
        match tokio::time::timeout(REPLY_TIMEOUT, tokio_tungstenite::connect_async(url)).await {
            Ok(Ok((ws, _))) => {
                let took = started.elapsed();
                shared.record(|s| s.connect.push(took));
                ws
            }
            Ok(Err(err)) => {
                shared.record(|s| {
                    s.fail(
                        Phase::Connect,
                        format!("connect: {}", short(&err.to_string())),
                        1,
                    )
                });
                return None;
            }
            Err(_) => {
                shared.record(|s| s.fail(Phase::Connect, "connect: timeout", 1));
                return None;
            }
        };

    shared.record(|s| s.attempt(Phase::Auth));
    let started = Instant::now();
    let auth = Payload::Authenticate(v1::Authenticate {
        access_token: token,
    });
    match request(&mut ws, 1, auth, &mut |_| {}).await {
        Ok(Payload::AuthOk(_)) => {}
        Ok(other) => {
            shared.record(|s| s.fail(Phase::Auth, format!("auth: {}", kind(&other)), 1));
            return None;
        }
        Err(err) => {
            shared.record(|s| s.fail(Phase::Auth, format!("auth: {err}"), 1));
            return None;
        }
    }
    match request(&mut ws, 2, Payload::Ping(v1::Ping {}), &mut |_| {}).await {
        Ok(Payload::Pong(_)) => {
            let took = started.elapsed();
            shared.record(|s| s.auth.push(took));
            Some(ws)
        }
        Ok(other) => {
            shared.record(|s| s.fail(Phase::Auth, format!("auth: {}", kind(&other)), 1));
            None
        }
        Err(err) => {
            shared.record(|s| s.fail(Phase::Auth, format!("auth: {err}"), 1));
            None
        }
    }
}

async fn open_dm(ws: &mut Ws, partner: &User, shared: &Shared) -> Option<u64> {
    shared.record(|s| s.attempt(Phase::OpenDm));
    let open = Payload::OpenDm(v1::OpenDm {
        username: partner.username.clone(),
    });
    match request(ws, 3, open, &mut |_| {}).await {
        Ok(Payload::Conversation(c)) => c.conversation.map(|c| c.id),
        Ok(other) => {
            shared.record(|s| s.fail(Phase::OpenDm, format!("open_dm: {}", kind(&other)), 1));
            None
        }
        Err(err) => {
            shared.record(|s| s.fail(Phase::OpenDm, format!("open_dm: {err}"), 1));
            None
        }
    }
}

async fn socket(
    i: usize,
    url: String,
    token: String,
    me: User,
    partner: User,
    messages: usize,
    shared: &Shared,
) {
    let mut ws = connect_and_auth(url, token, shared).await;
    let mut conv = None;
    if let Some(w) = ws.as_mut() {
        conv = open_dm(w, &partner, shared).await;
    }

    shared.barrier.wait().await;

    let (Some(mut w), Some(conv)) = (ws, conv) else {
        return;
    };

    let mut seen = HashSet::new();
    let mut deliveries = Vec::new();
    let got = AtomicUsize::new(0);
    let mut on_push = |p: Payload| {
        if let Payload::MessageCreated(m) = p
            && let Some(m) = m.message
            && m.conversation_id == conv
            && m.author_id == partner.id as u64
            && seen.insert(m.id)
            && let Some(sent_at) = std::str::from_utf8(&m.content)
                .ok()
                .and_then(|c| c.parse::<u64>().ok())
        {
            got.fetch_add(1, Relaxed);
            deliveries.push(
                shared
                    .origin
                    .elapsed()
                    .saturating_sub(Duration::from_micros(sent_at)),
            );
        }
    };

    let mut acks = Vec::new();
    for n in 0..messages {
        let sent_at = shared.origin.elapsed().as_micros() as u64;
        let send = Payload::SendMessage(v1::SendMessage {
            conversation_id: conv,
            content: sent_at.to_string().into_bytes(),
            nonce: format!("{}-{n}", me.id),
            attachment_ids: vec![],
            reply_to: 0,
        });
        let started = Instant::now();
        shared.record(|s| s.attempt(Phase::Send));
        match request(&mut w, 10 + n as u64, send, &mut on_push).await {
            Ok(Payload::MessageAck(_)) => {
                acks.push(started.elapsed());
                shared.acked[i].fetch_add(1, Relaxed);
            }
            Ok(other) => {
                shared.record(|s| s.fail(Phase::Send, format!("send: {}", kind(&other)), 1))
            }
            Err(err) => shared.record(|s| s.fail(Phase::Send, format!("send: {err}"), 1)),
        }
    }
    shared.done[i].store(true, Relaxed);

    let p = i ^ 1;
    let deadline = tokio::time::Instant::now() + DELIVERY_TIMEOUT;
    loop {
        let partner_done = shared.done[p].load(Relaxed);
        let expected = shared.acked[p].load(Relaxed);
        if partner_done && got.load(Relaxed) >= expected {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        match tokio::time::timeout(POLL, w.next()).await {
            Ok(Some(Ok(WsMessage::Binary(b)))) => {
                if let Some(p) = Envelope::decode(b).ok().and_then(|e| e.payload) {
                    on_push(p);
                }
            }
            Ok(Some(Ok(_))) | Err(_) => {}
            Ok(None) | Ok(Some(Err(_))) => break,
        }
    }
    let expected = shared.acked[p].load(Relaxed);
    let missing = expected.saturating_sub(deliveries.len());
    shared.record(|s| {
        s.attempts[Phase::Delivery as usize] += expected;
        if missing > 0 {
            s.fail(Phase::Delivery, "delivery: missing", missing);
        }
        s.ack.extend(acks);
        s.delivery.extend(deliveries);
    });
    let _ = tokio::time::timeout(Duration::from_secs(2), w.close(None)).await;
}

async fn request(
    ws: &mut Ws,
    id: u64,
    payload: Payload,
    on_push: &mut (dyn FnMut(Payload) + Send),
) -> Result<Payload, String> {
    let env = Envelope {
        id,
        payload: Some(payload),
    };
    tokio::time::timeout(
        SEND_TIMEOUT,
        ws.send(WsMessage::Binary(env.encode_to_vec().into())),
    )
    .await
    .map_err(|_| "send timeout".to_string())?
    .map_err(|e| short(&e.to_string()))?;
    let deadline = tokio::time::Instant::now() + REPLY_TIMEOUT;
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        let frame = tokio::time::timeout(left, ws.next())
            .await
            .map_err(|_| "timeout".to_string())?;
        match frame {
            None => return Err("closed".into()),
            Some(Err(e)) => return Err(short(&e.to_string())),
            Some(Ok(WsMessage::Binary(b))) => {
                let env = Envelope::decode(b).map_err(|_| "bad frame".to_string())?;
                match (env.id, env.payload) {
                    (got, Some(p)) if got == id => return Ok(p),
                    (0, Some(p)) => on_push(p),
                    _ => {}
                }
            }
            Some(Ok(WsMessage::Close(_))) => return Err("closed by server".into()),
            Some(Ok(_)) => {}
        }
    }
}

fn kind(p: &Payload) -> String {
    match p {
        Payload::Error(e) => e.code.clone(),
        _ => "unexpected reply".into(),
    }
}

fn short(s: &str) -> String {
    s.chars().take(60).collect()
}

fn pct(samples: &[Duration], q: f64) -> Option<Duration> {
    if samples.is_empty() {
        return None;
    }
    let mut v = samples.to_vec();
    v.sort_unstable();
    let i = ((v.len() as f64 * q).ceil() as usize).clamp(1, v.len()) - 1;
    Some(v[i])
}

fn pcts(samples: &[Duration]) -> String {
    let ms = |q| pct(samples, q).map_or("-".into(), |d| format!("{:.0}", d.as_secs_f64() * 1000.0));
    format!("{}/{}/{} ms", ms(0.5), ms(0.95), ms(0.99))
}
