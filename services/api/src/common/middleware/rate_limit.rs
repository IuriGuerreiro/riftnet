//! Simple in-memory fixed-window rate limiter. Good enough for one api
//! instance; move to Redis when we run several.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::common::error::ApiError;

#[derive(Default)]
pub struct RateLimiter {
    windows: Mutex<HashMap<String, (Instant, u32)>>,
}

impl RateLimiter {
    /// Allows `limit` hits per `window` for `key`, else `TooManyRequests`.
    pub fn check(&self, key: &str, limit: u32, window: Duration) -> Result<(), ApiError> {
        let mut windows = self.windows.lock().expect("rate limiter mutex poisoned");
        let now = Instant::now();

        // Drop old entries now and then so the map doesn't grow forever.
        if windows.len() > 10_000 {
            windows.retain(|_, (start, _)| now.duration_since(*start) < window);
        }

        let entry = windows.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        if entry.1 > limit {
            return Err(ApiError::TooManyRequests);
        }
        Ok(())
    }

    /// Like `check`, but doesn't count this hit. Pair with `record` to only
    /// count some outcomes (e.g. failed logins).
    pub fn ensure_below(&self, key: &str, limit: u32, window: Duration) -> Result<(), ApiError> {
        let windows = self.windows.lock().expect("rate limiter mutex poisoned");
        match windows.get(key) {
            Some((start, count)) if start.elapsed() < window && *count >= limit => {
                Err(ApiError::TooManyRequests)
            }
            _ => Ok(()),
        }
    }

    /// Counts one hit for `key` without checking a limit.
    pub fn record(&self, key: &str, window: Duration) {
        let mut windows = self.windows.lock().expect("rate limiter mutex poisoned");
        let now = Instant::now();
        let entry = windows.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        entry.1 += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
