use std::time::Duration;

use futures::StreamExt;

const TIMEOUT: Duration = Duration::from_secs(2);

pub fn is_probe(request: &[u8]) -> bool {
    request.starts_with(b"GET /ready ")
}

pub async fn nats_round_trip(client: Option<&async_nats::Client>) -> bool {
    let Some(client) = client else {
        return false;
    };
    tokio::time::timeout(TIMEOUT, async {
        let inbox = client.new_inbox();
        let mut sub = client.subscribe(inbox.clone()).await.ok()?;
        client.publish(inbox, "".into()).await.ok()?;
        client.flush().await.ok()?;
        sub.next().await
    })
    .await
    .ok()
    .flatten()
    .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ready_path_is_a_probe() {
        assert!(is_probe(b"GET /ready HTTP/1.1\r\n"));
        assert!(!is_probe(b"GET /metrics HTTP/1.1\r\n"));
        assert!(!is_probe(b"GET /readyz HTTP/1.1\r\n"));
        assert!(!is_probe(b""));
    }

    #[tokio::test]
    async fn not_ready_before_nats_connects() {
        assert!(!nats_round_trip(None).await);
    }
}
