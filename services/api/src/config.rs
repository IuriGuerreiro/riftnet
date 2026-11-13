//! Configuration from env vars (and `.env`). Defaults work for local dev
//! when the api runs from the repo root.

use std::net::SocketAddr;
use std::path::PathBuf;

pub struct Config {
    /// `development` (default) or `production`.
    pub env: String,
    pub addr: SocketAddr,
    pub database_url: String,
    pub zitadel_url: String,
    pub zitadel_pat: String,
    pub signing_key_file: PathBuf,
    pub machine_id: u16,
    pub cors_origins: Vec<String>,
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
            zitadel_url: env_or("ZITADEL_URL", "http://localhost:7102"),
            zitadel_pat,
            signing_key_file: env_or("API_SIGNING_KEY_FILE", "infra/.secrets/api_signing_key")
                .into(),
            machine_id: env_or("MACHINE_ID", "1").parse()?,
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
