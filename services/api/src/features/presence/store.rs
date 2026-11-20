use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use async_trait::async_trait;

use super::models::{Change, Conn, Snapshot, Status, status_of};
use super::repository::SavedPreference;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Touch,
    Idle,
    Active,
    Drop,
}

#[async_trait]
pub trait PresenceStore: Send + Sync {
    async fn apply(&self, user_id: i64, connection_id: u64, op: Op) -> anyhow::Result<Change>;
    async fn snapshots(&self, user_ids: &[i64]) -> anyhow::Result<Vec<Snapshot>>;
    async fn set_preference(&self, preference: &SavedPreference) -> anyhow::Result<Change>;
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub struct RedisPresenceStore {
    redis: redis::aio::ConnectionManager,
    ttl: Duration,
    script: redis::Script,
}

const APPLY_LUA: &str = r#"
local key, pref = KEYS[1], KEYS[2]
local now, op, conn, ttl = tonumber(ARGV[1]), ARGV[2], ARGV[3], tonumber(ARGV[4])
local function status()
  local preference = redis.call('HGET', pref, 'preference') or 'invisible'
  if preference == 'invisible' then return 0 end
  local any, active = false, false
  for _, value in ipairs(redis.call('HVALS', key)) do
    local exp, idle = string.match(value, '^(%d+):(%d)$')
    if exp and tonumber(exp) > now then
      any = true
      if idle == '0' then active = true end
    end
  end
  if not any then return 0 end
  if preference == 'do_not_disturb' then return 3 end
  if preference == 'idle' or not active then return 2 end
  return 1
end
local before = status()
if op == 'preference' then
  local version = tonumber(redis.call('HGET', pref, 'version') or '-1')
  if tonumber(ARGV[6]) >= version then
    redis.call('HSET', pref, 'preference', ARGV[5], 'version', ARGV[6])
  end
elseif op ~= 'read' then
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
end
local time = redis.call('TIME')
local revision = math.max(tonumber(redis.call('HGET', pref, 'revision') or '0') + 1,
                          tonumber(time[1]) * 1000000 + tonumber(time[2]))
redis.call('HSET', pref, 'revision', string.format('%.0f', revision))
return {before, status(), revision, redis.call('HEXISTS', pref, 'preference')}
"#;

impl RedisPresenceStore {
    pub fn new(redis: redis::aio::ConnectionManager, ttl: Duration) -> Self {
        Self {
            redis,
            ttl,
            script: redis::Script::new(APPLY_LUA),
        }
    }
}

impl RedisPresenceStore {
    async fn run(
        &self,
        user_id: i64,
        connection_id: u64,
        op: &str,
        preference: Option<&SavedPreference>,
    ) -> anyhow::Result<Change> {
        let (before, after, revision, preference_loaded): (i64, i64, u64, bool) = self
            .script
            .key(key(user_id))
            .key(preference_key(user_id))
            .arg(now_ms())
            .arg(op)
            .arg(connection_id.to_string())
            .arg(self.ttl.as_millis() as i64)
            .arg(preference.map_or("", |p| p.preference.as_str()))
            .arg(preference.map_or(0, |p| p.version))
            .invoke_async(&mut self.redis.clone())
            .await?;
        Ok(Change {
            before: from_code(before),
            after: from_code(after),
            revision,
            preference_loaded,
        })
    }
}

fn preference_key(user_id: i64) -> String {
    format!("presence-preference:{user_id}")
}

fn key(user_id: i64) -> String {
    format!("presence:{user_id}")
}

fn from_code(code: i64) -> Status {
    match code {
        1 => Status::Online,
        2 => Status::Idle,
        3 => Status::DoNotDisturb,
        _ => Status::Offline,
    }
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

        self.run(user_id, connection_id, op, None).await
    }

    async fn snapshots(&self, user_ids: &[i64]) -> anyhow::Result<Vec<Snapshot>> {
        let mut pipe = redis::pipe();
        for id in user_ids {
            pipe.cmd("EVAL")
                .arg(APPLY_LUA)
                .arg(2)
                .arg(key(*id))
                .arg(preference_key(*id))
                .arg(now_ms())
                .arg("read")
                .arg("0")
                .arg(0);
        }
        if user_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows: Vec<(i64, i64, u64, bool)> = pipe.query_async(&mut self.redis.clone()).await?;
        Ok(rows
            .into_iter()
            .map(|(_, status, revision, preference_loaded)| Snapshot {
                status: from_code(status),
                revision,
                preference_loaded,
            })
            .collect())
    }

    async fn set_preference(&self, preference: &SavedPreference) -> anyhow::Result<Change> {
        self.run(preference.user_id, 0, "preference", Some(preference))
            .await
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub struct MemoryPresenceStore {
    users: Mutex<HashMap<i64, HashMap<u64, Conn>>>,
    ttl_ms: i64,
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
        Ok(Change {
            before,
            after,
            revision: 0,
            preference_loaded: true,
        })
    }

    async fn snapshots(&self, user_ids: &[i64]) -> anyhow::Result<Vec<Snapshot>> {
        let now = self.now();
        let users = self.users.lock().unwrap();
        Ok(user_ids
            .iter()
            .map(|id| Snapshot {
                status: users
                    .get(id)
                    .map_or(Status::Offline, |c| status_of(c.values().copied(), now)),
                revision: 0,
                preference_loaded: true,
            })
            .collect())
    }
    async fn set_preference(&self, _: &SavedPreference) -> anyhow::Result<Change> {
        anyhow::bail!("memory presence preferences are not supported")
    }
}

#[cfg(test)]
mod redis_tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn redis_store_matches_the_rules() {
        let url = std::env::var("REDIS_URL").unwrap_or("redis://127.0.0.1:6379".into());
        let redis = crate::common::redis::connect(&url).await.unwrap();
        let store = RedisPresenceStore::new(redis, Duration::from_millis(500));
        let user: i64 = -(rand::random::<u32>() as i64) - 1;
        store
            .set_preference(&SavedPreference {
                user_id: user,
                preference: super::super::models::PresencePreference::Online,
                version: 0,
            })
            .await
            .unwrap();
        let change = |before, after| (before, after);
        use Status::*;

        assert_eq!(
            {
                let c = store.apply(user, 1, Op::Touch).await.unwrap();
                (c.before, c.after)
            },
            change(Offline, Online)
        );
        assert_eq!(
            {
                let c = store.apply(user, 2, Op::Touch).await.unwrap();
                (c.before, c.after)
            },
            change(Online, Online)
        );
        assert_eq!(
            {
                let c = store.apply(user, 1, Op::Idle).await.unwrap();
                (c.before, c.after)
            },
            change(Online, Online)
        );
        assert_eq!(
            {
                let c = store.apply(user, 2, Op::Idle).await.unwrap();
                (c.before, c.after)
            },
            change(Online, Idle)
        );
        assert_eq!(
            {
                let c = store.apply(user, 2, Op::Touch).await.unwrap();
                (c.before, c.after)
            },
            change(Idle, Idle)
        );
        assert_eq!(
            store
                .snapshots(&[user, user - 1])
                .await
                .unwrap()
                .into_iter()
                .map(|s| s.status)
                .collect::<Vec<_>>(),
            vec![Idle, Offline]
        );
        assert_eq!(
            {
                let c = store.apply(user, 1, Op::Active).await.unwrap();
                (c.before, c.after)
            },
            change(Idle, Online)
        );
        assert_eq!(
            {
                let c = store.apply(user, 1, Op::Drop).await.unwrap();
                (c.before, c.after)
            },
            change(Online, Idle)
        );
        assert_eq!(
            {
                let c = store.apply(user, 2, Op::Drop).await.unwrap();
                (c.before, c.after)
            },
            change(Idle, Offline)
        );

        store.apply(user, 3, Op::Touch).await.unwrap();
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(
            store
                .snapshots(&[user])
                .await
                .unwrap()
                .into_iter()
                .map(|s| s.status)
                .collect::<Vec<_>>(),
            vec![Offline]
        );
        assert_eq!(
            {
                let c = store.apply(user, 4, Op::Touch).await.unwrap();
                (c.before, c.after)
            },
            change(Offline, Online)
        );
        store.apply(user, 4, Op::Drop).await.unwrap();
    }
    #[tokio::test]
    #[ignore = "needs Redis"]
    async fn preferences_and_connections_are_atomic_and_old_hydration_cannot_reveal_invisible_users()
     {
        use super::super::models::PresencePreference as P;
        let url = std::env::var("REDIS_URL").unwrap_or("redis://127.0.0.1:6379".into());
        let redis = crate::common::redis::connect(&url).await.unwrap();
        let store = RedisPresenceStore::new(redis.clone(), Duration::from_secs(90));
        let user = -(rand::random::<u32>() as i64) - 1;
        let saved = |preference, version| SavedPreference {
            user_id: user,
            preference,
            version,
        };
        let unknown = store.apply(user, 1, Op::Touch).await.unwrap();
        assert_eq!(unknown.after, Status::Offline);
        assert!(!unknown.preference_loaded);
        let visible = store.set_preference(&saved(P::Online, 1)).await.unwrap();
        assert_eq!(visible.after, Status::Online);
        let invisible = saved(P::Invisible, 2);
        let (hidden, connection) = tokio::join!(
            store.set_preference(&invisible),
            store.apply(user, 2, Op::Touch)
        );
        let hidden = hidden.unwrap();
        let connection = connection.unwrap();
        assert_eq!(hidden.after, Status::Offline);
        if connection.revision > hidden.revision {
            assert_eq!(connection.after, Status::Offline);
        }
        let stale = store.set_preference(&saved(P::Online, 1)).await.unwrap();
        assert_eq!(stale.after, Status::Offline);
        assert!(stale.revision > hidden.revision);
        for op in [Op::Active, Op::Idle, Op::Touch] {
            assert_eq!(
                store.apply(user, 1, op).await.unwrap().after,
                Status::Offline
            );
        }
        for (preference, version, expected) in [
            (P::Idle, 3, Status::Idle),
            (P::DoNotDisturb, 4, Status::DoNotDisturb),
        ] {
            assert_eq!(
                store
                    .set_preference(&saved(preference, version))
                    .await
                    .unwrap()
                    .after,
                expected
            );
            assert_eq!(
                store.apply(user, 2, Op::Active).await.unwrap().after,
                expected
            );
            assert_eq!(store.snapshots(&[user]).await.unwrap()[0].status, expected);
        }
        assert_eq!(
            store.apply(user, 1, Op::Drop).await.unwrap().after,
            Status::DoNotDisturb
        );
        assert_eq!(
            store.apply(user, 2, Op::Drop).await.unwrap().after,
            Status::Offline
        );
        redis::cmd("DEL")
            .arg(key(user))
            .arg(preference_key(user))
            .query_async::<()>(&mut redis.clone())
            .await
            .unwrap();
    }
}
