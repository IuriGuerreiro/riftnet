//! Redis connection. Shared by every feature that needs it (presence now,
//! cache decorators later).
//!
//! `ConnectionManager` is one multiplexed connection that reconnects on its
//! own. Cheap to clone: give each user its own clone.

use redis::aio::ConnectionManager;

/// Connects and checks Redis answers (`PING`), so a bad `REDIS_URL` fails at start.
pub async fn connect(url: &str) -> anyhow::Result<ConnectionManager> {
    let client = redis::Client::open(url)?;
    let mut conn = ConnectionManager::new(client).await?;
    let _: String = redis::cmd("PING").query_async(&mut conn).await?;
    Ok(conn)
}
