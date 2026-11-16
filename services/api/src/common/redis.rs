use redis::aio::ConnectionManager;

pub async fn connect(url: &str) -> anyhow::Result<ConnectionManager> {
    let client = redis::Client::open(url)?;
    let mut conn = ConnectionManager::new(client).await?;
    let _: String = redis::cmd("PING").query_async(&mut conn).await?;
    Ok(conn)
}
