//! Where live sockets are kept, per user: `connection_id → (expires_at, idle)`.
//!
//! Redis in real use, so every api server sees the same thing. One hash per
//! user (`presence:<user_id>`). Each socket's entry must be refreshed by a
//! heartbeat before `ttl`, or it counts as gone: a crashed api server can't
//! leave people "online" forever.
//!
//! Every write returns the status before and after, computed in the same
//! atomic step, so two devices connecting at once can't both miss (or both
//! send) the "came online" push.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use async_trait::async_trait;

use super::models::{Change, Conn, Status, status_of};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// New socket, or heartbeat of an existing one (keeps its idle flag).
    Touch,
    Idle,
    Active,
    /// Socket closed.
    Drop,
}

#[async_trait]
pub trait PresenceStore: Send + Sync {
    async fn apply(&self, user_id: i64, connection_id: u64, op: Op) -> anyhow::Result<Change>;
    /// Current status of each user, same order as `user_ids`.
    async fn statuses(&self, user_ids: &[i64]) -> anyhow::Result<Vec<Status>>;
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// --- Redis ---

pub struct RedisPresenceStore {
    redis: redis::aio::ConnectionManager,
    ttl: Duration,
    script: redis::Script,
}

/// KEYS[1] = presence:<user>. ARGV = now_ms, op, connection_id, ttl_ms.
/// Returns {before, after}: 0 offline, 1 online, 2 idle.
const APPLY_LUA: &str = r#"
local key, now, op, conn, ttl = KEYS[1], tonumber(ARGV[1]), ARGV[2], ARGV[3], tonumber(ARGV[4])
local function status()
  local h = redis.call('HGETALL', key)
  local any = false
  for i = 1, #h, 2 do
    local exp, idle = string.match(h[i + 1], '^(%d+):(%d)$')
    if exp and tonumber(exp) > now then
      if idle == '0' then return 1 end
      any = true
    end
  end
  if any then return 2 end
  return 0
end
local before = status()
-- forget sockets nobody refreshed (their api server died)
local h = redis.call('HGETALL', key)
for i = 1, #h, 2 do
  local exp = string.match(h[i + 1], '^(%d+):')
  if not exp or tonumber(exp) <= now then redis.call('HDEL', key, h[i]) end
end
if op == 'drop' then
  redis.call('HDEL', key, conn)
else
  local idle = '0'
  local cur = redis.call('HGET', key, conn)
  if cur then idle = string.sub(cur, -1) end
  if op == 'idle' then idle = '1' elseif op == 'active' then idle = '0' end
  redis.call('HSET', key, conn, string.format('%d', now + ttl) .. ':' .. idle)
end
if redis.call('HLEN', key) > 0 then redis.call('PEXPIRE', key, ttl) end
return {before, status()}
"#;

impl RedisPresenceStore {
    /// `redis` comes from `common::redis::connect`.
    pub fn new(redis: redis::aio::ConnectionManager, ttl: Duration) -> Self {
        Self {
            redis,
            ttl,
            script: redis::Script::new(APPLY_LUA),
        }
    }
}

fn key(user_id: i64) -> String {
    format!("presence:{user_id}")
}

fn from_code(code: i64) -> Status {
    match code {
        1 => Status::Online,
        2 => Status::Idle,
        _ => Status::Offline,
    }
}

/// Parses a stored `"<expires_at>:<idle 0|1>"`.
fn parse_conn(value: &str) -> Option<Conn> {
    let (exp, idle) = value.split_once(':')?;
    Some(Conn {
        expires_at: exp.parse().ok()?,
        idle: idle == "1",
    })
}

#[async_trait]
impl PresenceStore for RedisPresenceStore {
    #[tracing::instrument(name = "redis presence apply", skip_all, err(Display), fields(otel.kind = "client", db.system = "redis", op = ?op))]
    async fn apply(&self, user_id: i64, connection_id: u64, op: Op) -> anyhow::Result<Change> {
        let op = match op {
            Op::Touch => "touch",
            Op::Idle => "idle",
            Op::Active => "active",
            Op::Drop => "drop",
        };

        let mut redis = self.redis.clone();

        let (before, after): (i64, i64) = self
            .script
            .key(key(user_id))
            .arg(now_ms())
            .arg(op)
            .arg(connection_id.to_string())
            .arg(self.ttl.as_millis() as i64)
            .invoke_async(&mut redis)
            .await?;
        Ok(Change {
            before: from_code(before),
            after: from_code(after),
        })
    }

    #[tracing::instrument(name = "redis presence statuses", skip_all, err(Display), fields(otel.kind = "client", db.system = "redis", users = user_ids.len()))]
    async fn statuses(&self, user_ids: &[i64]) -> anyhow::Result<Vec<Status>> {
        if user_ids.is_empty() {
            return Ok(vec![]);
        }
        let mut pipe = redis::pipe();
        for id in user_ids {
            pipe.hvals(key(*id));
        }
        let mut redis = self.redis.clone();
        let rows: Vec<Vec<String>> = pipe.query_async(&mut redis).await?;
        let now = now_ms();
        Ok(rows
            .iter()
            .map(|values| status_of(values.iter().filter_map(|v| parse_conn(v)), now))
            .collect())
    }
}

// --- in memory (tests) ---

#[cfg_attr(not(test), allow(dead_code))]
pub struct MemoryPresenceStore {
    users: Mutex<HashMap<i64, HashMap<u64, Conn>>>,
    ttl_ms: i64,
    /// Fake clock for tests (ms). 0 = real time.
    clock: AtomicI64,
}

#[cfg_attr(not(test), allow(dead_code))]
impl MemoryPresenceStore {
    pub fn new(ttl: Duration) -> Self {
        Self {
            users: Mutex::default(),
            ttl_ms: ttl.as_millis() as i64,
            clock: AtomicI64::new(0),
        }
    }

    #[cfg(test)]
    pub fn set_clock(&self, now_ms: i64) {
        self.clock.store(now_ms, Ordering::SeqCst);
    }

    fn now(&self) -> i64 {
        match self.clock.load(Ordering::SeqCst) {
            0 => now_ms(),
            fake => fake,
        }
    }
}

#[async_trait]
impl PresenceStore for MemoryPresenceStore {
    async fn apply(&self, user_id: i64, connection_id: u64, op: Op) -> anyhow::Result<Change> {
        let now = self.now();
        let mut users = self.users.lock().unwrap();
        let conns = users.entry(user_id).or_default();
        let before = status_of(conns.values().copied(), now);
        conns.retain(|_, c| c.expires_at > now);
        if op == Op::Drop {
            conns.remove(&connection_id);
        } else {
            let mut idle = conns.get(&connection_id).is_some_and(|c| c.idle);
            match op {
                Op::Idle => idle = true,
                Op::Active => idle = false,
                _ => {}
            }
            conns.insert(
                connection_id,
                Conn {
                    expires_at: now + self.ttl_ms,
                    idle,
                },
            );
        }
        let after = status_of(conns.values().copied(), now);
        if conns.is_empty() {
            users.remove(&user_id);
        }
        Ok(Change { before, after })
    }

    async fn statuses(&self, user_ids: &[i64]) -> anyhow::Result<Vec<Status>> {
        let now = self.now();
        let users = self.users.lock().unwrap();
        Ok(user_ids
            .iter()
            .map(|id| {
                users
                    .get(id)
                    .map_or(Status::Offline, |c| status_of(c.values().copied(), now))
            })
            .collect())
    }
}

/// Needs a running Redis: `cargo test -p api presence -- --ignored`.
#[cfg(test)]
mod redis_tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn redis_store_matches_the_rules() {
        let url = std::env::var("REDIS_URL").unwrap_or("redis://127.0.0.1:6379".into());
        let redis = crate::common::redis::connect(&url).await.unwrap();
        let store = RedisPresenceStore::new(redis, Duration::from_millis(500));
        let user: i64 = -(rand::random::<u32>() as i64) - 1; // never a real id
        let change = |before, after| Change { before, after };
        use Status::*;

        assert_eq!(
            store.apply(user, 1, Op::Touch).await.unwrap(),
            change(Offline, Online)
        );
        assert_eq!(
            store.apply(user, 2, Op::Touch).await.unwrap(),
            change(Online, Online)
        );
        assert_eq!(
            store.apply(user, 1, Op::Idle).await.unwrap(),
            change(Online, Online)
        );
        assert_eq!(
            store.apply(user, 2, Op::Idle).await.unwrap(),
            change(Online, Idle)
        );
        assert_eq!(
            store.apply(user, 2, Op::Touch).await.unwrap(),
            change(Idle, Idle)
        );
        assert_eq!(
            store.statuses(&[user, user - 1]).await.unwrap(),
            vec![Idle, Offline]
        );
        assert_eq!(
            store.apply(user, 1, Op::Active).await.unwrap(),
            change(Idle, Online)
        );
        assert_eq!(
            store.apply(user, 1, Op::Drop).await.unwrap(),
            change(Online, Idle)
        );
        assert_eq!(
            store.apply(user, 2, Op::Drop).await.unwrap(),
            change(Idle, Offline)
        );

        // No heartbeat for longer than the TTL → offline.
        store.apply(user, 3, Op::Touch).await.unwrap();
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(store.statuses(&[user]).await.unwrap(), vec![Offline]);
        assert_eq!(
            store.apply(user, 4, Op::Touch).await.unwrap(),
            change(Offline, Online)
        );
        store.apply(user, 4, Op::Drop).await.unwrap();
    }
}
