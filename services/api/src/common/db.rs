use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

pub async fn connect(url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(url)
        .await?;
    // WARN: rollbacks start an older api against newer migrations. Keep them backward compatible.
    sqlx::migrate!().set_ignore_missing(true).run(&pool).await?;
    Ok(pool)
}
