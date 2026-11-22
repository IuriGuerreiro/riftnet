use std::time::Duration;

use redis::aio::ConnectionManager;

use crate::common::error::ApiError;

#[derive(Debug, Clone, Copy)]
pub struct Rule {
    pub name: &'static str,
    pub max: u32,
    pub window: Duration,
}

pub const SEND_MESSAGE: Rule = Rule {
    name: "send_message",
    max: 10,
    window: Duration::from_secs(10),
};
pub const GROUP_CHANGE: Rule = Rule {
    name: "group_change",
    max: 20,
    window: Duration::from_secs(60),
};
pub const FRIEND_REQUEST: Rule = Rule {
    name: "friend_request",
    max: 10,
    window: Duration::from_secs(60),
};

const HIT: &str = r"
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {n, ttl}
";

#[derive(Clone)]
pub struct UserLimiter {
    redis: ConnectionManager,
    script: redis::Script,
    enabled: bool,
}

impl UserLimiter {
    pub fn new(redis: ConnectionManager, enabled: bool) -> Self {
        Self {
            redis,
            script: redis::Script::new(HIT),
            enabled,
        }
    }

    pub async fn hit(&self, rule: Rule, user_id: i64) -> Result<(), ApiError> {
        if !self.enabled {
            return Ok(());
        }
        let key = format!("rl:{}:{user_id}", rule.name);
        let mut conn = self.redis.clone();
        let res: redis::RedisResult<(u32, i64)> = self
            .script
            .key(&key)
            .arg(rule.window.as_millis() as u64)
            .invoke_async(&mut conn)
            .await;
        match res {
            Ok((hits, ttl_ms)) => verdict(rule, hits, ttl_ms),
            Err(err) => {
                tracing::warn!(error = %err, rule = rule.name, "rate limit check failed, allowing");
                Ok(())
            }
        }
    }
}

fn verdict(rule: Rule, hits: u32, ttl_ms: i64) -> Result<(), ApiError> {
    if hits <= rule.max {
        return Ok(());
    }
    metrics::counter!("rate_limited_requests_total", "rule" => rule.name).increment(1);
    Err(ApiError::RateLimited {
        retry_after: Duration::from_millis(ttl_ms.max(1) as u64),
    })
}

pub const MAX_SOCKETS_PER_USER: usize = 10;

const ACQUIRE: &str = r"
local key, now, conn, ttl, max = KEYS[1], tonumber(ARGV[1]), ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
if redis.call('ZSCORE', key, conn) == false and redis.call('ZCARD', key) >= max then return 0 end
redis.call('ZADD', key, now + ttl, conn)
redis.call('PEXPIRE', key, ttl)
return 1
";

#[derive(Clone)]
pub struct SocketSlots {
    redis: ConnectionManager,
    script: redis::Script,
    ttl: Duration,
    enabled: bool,
}

impl SocketSlots {
    pub fn new(redis: ConnectionManager, ttl: Duration, enabled: bool) -> Self {
        Self {
            redis,
            script: redis::Script::new(ACQUIRE),
            ttl,
            enabled,
        }
    }

    pub async fn acquire(&self, user_id: i64, connection_id: u64) -> bool {
        if !self.enabled {
            return true;
        }
        let mut conn = self.redis.clone();
        let res: redis::RedisResult<i64> = self
            .script
            .key(slots_key(user_id))
            .arg(chrono::Utc::now().timestamp_millis())
            .arg(connection_id.to_string())
            .arg(self.ttl.as_millis() as u64)
            .arg(MAX_SOCKETS_PER_USER)
            .invoke_async(&mut conn)
            .await;
        match res {
            Ok(got) => got == 1,
            Err(err) => {
                tracing::warn!(error = %err, "socket slot check failed, allowing");
                true
            }
        }
    }

    pub async fn release(&self, user_id: i64, connection_id: u64) {
        if !self.enabled {
            return;
        }
        let mut conn = self.redis.clone();
        let res: redis::RedisResult<()> = redis::cmd("ZREM")
            .arg(slots_key(user_id))
            .arg(connection_id.to_string())
            .query_async(&mut conn)
            .await;
        if let Err(err) = res {
            tracing::warn!(error = %err, "socket slot release failed");
        }
    }
}

fn slots_key(user_id: i64) -> String {
    format!("ws:slots:{user_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULE: Rule = Rule {
        name: "test",
        max: 3,
        window: Duration::from_secs(10),
    };

    #[test]
    fn under_the_limit_is_allowed() {
        assert!(verdict(RULE, 1, 9_000).is_ok());
        assert!(verdict(RULE, 3, 9_000).is_ok());
    }

    #[test]
    fn over_the_limit_carries_retry_after() {
        let err = verdict(RULE, 4, 2_500).unwrap_err();
        assert_eq!(err.describe().1, "rate_limited");
        assert_eq!(err.retry_after(), Some(Duration::from_millis(2_500)));
    }

    async fn redis() -> Option<ConnectionManager> {
        let url = std::env::var("REDIS_URL").ok()?;
        crate::common::redis::connect(&url).await.ok()
    }

    #[tokio::test]
    async fn redis_limiter_blocks_after_max() {
        let Some(conn) = redis().await else { return };
        let limiter = UserLimiter::new(conn, true);
        let user = rand::random::<i64>().abs();
        for _ in 0..RULE.max {
            limiter.hit(RULE, user).await.unwrap();
        }
        let err = limiter.hit(RULE, user).await.unwrap_err();
        let wait = err.retry_after().unwrap();
        assert!(wait <= RULE.window && wait > Duration::ZERO);
    }

    #[tokio::test]
    async fn disabled_limits_always_allow() {
        let Some(conn) = redis().await else { return };
        let limiter = UserLimiter::new(conn.clone(), false);
        let slots = SocketSlots::new(conn, Duration::from_secs(30), false);
        let user = rand::random::<i64>().abs();
        for id in 0..(RULE.max as u64 + MAX_SOCKETS_PER_USER as u64 + 5) {
            limiter.hit(RULE, user).await.unwrap();
            assert!(slots.acquire(user, id).await);
        }
    }

    #[tokio::test]
    async fn socket_slots_cap_and_release() {
        let Some(conn) = redis().await else { return };
        let slots = SocketSlots::new(conn, Duration::from_secs(30), true);
        let user = rand::random::<i64>().abs();
        for id in 0..MAX_SOCKETS_PER_USER as u64 {
            assert!(slots.acquire(user, id).await);
        }
        assert!(!slots.acquire(user, 999).await, "one too many");
        assert!(
            slots.acquire(user, 0).await,
            "refreshing an owned slot is fine"
        );
        slots.release(user, 0).await;
        assert!(slots.acquire(user, 999).await, "freed slot is reusable");
        for id in (1..MAX_SOCKETS_PER_USER as u64).chain([999]) {
            slots.release(user, id).await;
        }
    }
}
