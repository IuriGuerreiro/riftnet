use std::net::SocketAddr;
use std::path::PathBuf;

pub struct Config {
    pub env: String,
    pub addr: SocketAddr,
    pub database_url: String,
    pub nats_url: String,
    pub redis_url: String,
    pub scylla_nodes: Vec<String>,
    pub scylla_keyspace: String,
    pub scylla_replication: u8,
    pub zitadel_url: String,
    pub zitadel_pat: String,
    pub signing_key_file: PathBuf,
    pub machine_id: u16,
    pub cors_origins: Vec<String>,
    /// S3-compatible file store: MinIO locally, R2 in production.
    pub s3_endpoint: String,
    pub s3_public_endpoint: Option<String>,
    pub s3_region: String,
    pub s3_bucket: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub attachment_max_bytes: i64,
    pub attachment_ttl_hours: u64,
    /// `RATE_LIMITS=off` disables every rate limit and the per-user socket cap.
    /// For load tests only. Default: on.
    pub rate_limits: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let _ = dotenvy::dotenv();

        let zitadel_pat = match std::env::var("ZITADEL_PAT") {
            Ok(pat) => pat,
            Err(_) => {
                let path = env_or("ZITADEL_PAT_FILE", "infra/.secrets/api.pat");
                crate::common::secrets::read(path.as_ref())?
            }
        };

        Ok(Self {
            env: env_or("APP_ENV", "development"),
            addr: env_or("API_ADDR", "127.0.0.1:7100").parse()?,
            database_url: env_or("DATABASE_URL", "postgres://app:app@127.0.0.1:55432/app"),
            nats_url: env_or("NATS_URL", "nats://127.0.0.1:4222"),
            redis_url: env_or("REDIS_URL", "redis://127.0.0.1:6379"),
            scylla_nodes: env_or("SCYLLA_NODES", "127.0.0.1:9042")
                .split(',')
                .map(|s| s.trim().to_string())
                .collect(),
            scylla_keyspace: env_or("SCYLLA_KEYSPACE", "app"),
            scylla_replication: env_or("SCYLLA_REPLICATION", "1").parse()?,
            zitadel_url: env_or("ZITADEL_URL", "http://localhost:7102"),
            zitadel_pat,
            signing_key_file: env_or("API_SIGNING_KEY_FILE", "infra/.secrets/api_signing_key")
                .into(),
            machine_id: env_or("MACHINE_ID", "1").parse()?,
            s3_endpoint: env_or("S3_ENDPOINT", "http://127.0.0.1:7106"),
            s3_public_endpoint: std::env::var("S3_PUBLIC_ENDPOINT").ok(),
            s3_region: env_or("S3_REGION", "auto"),
            s3_bucket: env_or("S3_BUCKET", "attachments"),
            s3_access_key: env_or("S3_ACCESS_KEY", "minio"),
            s3_secret_key: env_or("S3_SECRET_KEY", "minio-dev-secret"),
            attachment_max_bytes: env_or("ATTACHMENT_MAX_BYTES", "104857600").parse()?, // 100 MiB
            attachment_ttl_hours: env_or("ATTACHMENT_TTL_HOURS", "168").parse()?,     // 7 days
            rate_limits: parse_switch("RATE_LIMITS", &env_or("RATE_LIMITS", "on"))?,
            cors_origins: env_or(
                "CORS_ORIGINS",
                "http://localhost:7104,https://server.tailcbbc1b.ts.net:7103,tauri://localhost,http://tauri.localhost",
            )
            .split(',')
            .map(|s| s.trim().to_string())
            .collect(),
        })
    }
}

impl Config {
    pub fn is_production(&self) -> bool {
        self.env == "production"
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn parse_switch(key: &str, value: &str) -> anyhow::Result<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "on" | "true" | "1" | "yes" => Ok(true),
        "off" | "false" | "0" | "no" => Ok(false),
        other => anyhow::bail!("{key} must be on or off, got {other:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_switch;

    #[test]
    fn switch_values() {
        assert!(parse_switch("X", "on").unwrap());
        assert!(parse_switch("X", "TRUE").unwrap());
        assert!(!parse_switch("X", "off").unwrap());
        assert!(!parse_switch("X", " 0 ").unwrap());
        assert!(parse_switch("X", "maybe").is_err());
    }
}
