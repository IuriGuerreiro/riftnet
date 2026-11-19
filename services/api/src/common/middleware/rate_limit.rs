use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::common::error::ApiError;

#[derive(Default)]
pub struct RateLimiter {
    windows: Mutex<HashMap<String, (Instant, u32)>>,
    /// Set by `RATE_LIMITS=off` (load tests). Every call then allows.
    disabled: bool,
}

impl RateLimiter {
    pub fn new(enabled: bool) -> Self {
        Self {
            disabled: !enabled,
            ..Self::default()
        }
    }

    pub fn check(&self, key: &str, limit: u32, window: Duration) -> Result<(), ApiError> {
        if self.disabled {
            return Ok(());
        }
        let mut windows = self.windows.lock().expect("rate limiter mutex poisoned");
        let now = Instant::now();

        if windows.len() > 10_000 {
            windows.retain(|_, (start, _)| now.duration_since(*start) < window);
        }

        let entry = windows.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        if entry.1 > limit {
            limited(key);
            return Err(ApiError::TooManyRequests);
        }
        Ok(())
    }

    pub fn ensure_below(&self, key: &str, limit: u32, window: Duration) -> Result<(), ApiError> {
        if self.disabled {
            return Ok(());
        }
        let windows = self.windows.lock().expect("rate limiter mutex poisoned");
        match windows.get(key) {
            Some((start, count)) if start.elapsed() < window && *count >= limit => {
                limited(key);
                Err(ApiError::TooManyRequests)
            }
            _ => Ok(()),
        }
    }

    pub fn record(&self, key: &str, window: Duration) {
        if self.disabled {
            return;
        }
        let mut windows = self.windows.lock().expect("rate limiter mutex poisoned");
        let now = Instant::now();
        let entry = windows.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        entry.1 += 1;
    }
}

fn limited(key: &str) {
    metrics::counter!("rate_limited_requests_total", "rule" => rule(key)).increment(1);
}

fn rule(key: &str) -> String {
    key.splitn(3, ':').take(2).collect::<Vec<_>>().join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_label_drops_ip_and_email() {
        assert_eq!(rule("login:ip-email:1.2.3.4:a@b.c"), "login:ip-email");
        assert_eq!(rule("register:ip:::1"), "register:ip");
    }

    #[test]
    fn blocks_after_limit() {
        let limiter = RateLimiter::default();
        let w = Duration::from_secs(60);
        for _ in 0..3 {
            assert!(limiter.check("k", 3, w).is_ok());
        }
        assert!(limiter.check("k", 3, w).is_err());
        assert!(limiter.check("other", 3, w).is_ok());
    }

    #[test]
    fn disabled_always_allows() {
        let limiter = RateLimiter::new(false);
        let w = Duration::from_secs(60);
        for _ in 0..100 {
            assert!(limiter.check("k", 1, w).is_ok());
            limiter.record("fail", w);
        }
        assert!(limiter.ensure_below("fail", 1, w).is_ok());
    }

    #[test]
    fn ensure_below_only_counts_recorded_hits() {
        let limiter = RateLimiter::default();
        let w = Duration::from_secs(60);
        for _ in 0..10 {
            assert!(
                limiter.ensure_below("fail", 2, w).is_ok(),
                "checking alone never blocks"
            );
        }
        limiter.record("fail", w);
        limiter.record("fail", w);
        assert!(limiter.ensure_below("fail", 2, w).is_err());
    }
}
