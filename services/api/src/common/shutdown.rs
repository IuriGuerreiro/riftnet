use std::time::Duration;

use tokio::sync::watch;

pub struct Shutdown {
    stop: watch::Sender<bool>,
    live: watch::Sender<usize>,
}

impl Default for Shutdown {
    fn default() -> Self {
        Self {
            stop: watch::Sender::new(false),
            live: watch::Sender::new(0),
        }
    }
}

impl Shutdown {
    pub fn trigger(&self) {
        self.stop.send_replace(true);
    }

    pub fn is_stopping(&self) -> bool {
        *self.stop.borrow()
    }

    pub async fn stopped(&self) {
        let mut rx = self.stop.subscribe();
        let _ = rx.wait_for(|stopping| *stopping).await;
    }

    pub fn track(&self) -> SocketGuard<'_> {
        self.live.send_modify(|n| *n += 1);
        SocketGuard(self)
    }

    pub async fn drained(&self, limit: Duration) -> usize {
        let mut rx = self.live.subscribe();
        let _ = tokio::time::timeout(limit, rx.wait_for(|n| *n == 0)).await;
        *self.live.borrow()
    }
}

pub struct SocketGuard<'a>(&'a Shutdown);

impl Drop for SocketGuard<'_> {
    fn drop(&mut self) {
        self.0.live.send_modify(|n| *n -= 1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stopped_fires_after_trigger() {
        let s = Shutdown::default();
        assert!(!s.is_stopping());
        s.trigger();
        tokio::time::timeout(Duration::from_secs(1), s.stopped())
            .await
            .unwrap();
        assert!(s.is_stopping());
    }

    #[tokio::test]
    async fn drained_waits_for_guards() {
        let s = std::sync::Arc::new(Shutdown::default());
        let s2 = s.clone();
        let task = tokio::spawn(async move {
            let _guard = s2.track();
            s2.stopped().await;
        });
        tokio::task::yield_now().await;
        s.trigger();
        assert_eq!(s.drained(Duration::from_secs(1)).await, 0);
        task.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn drained_gives_up_after_limit() {
        let s = Shutdown::default();
        let _stuck = s.track();
        assert_eq!(s.drained(Duration::from_secs(10)).await, 1);
    }
}
