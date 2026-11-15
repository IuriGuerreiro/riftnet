use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

pub async fn connect(url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(url)
        .await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}
