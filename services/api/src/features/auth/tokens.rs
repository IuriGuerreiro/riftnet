//! Our tokens.
//! - Access token: a JWT signed with Ed25519 (`alg: EdDSA`), 15 min, verified
//!   with no DB lookup.
//! - Refresh token: 32 random bytes, only its SHA-256 hash is stored.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

pub const ACCESS_TTL_SECS: i64 = 15 * 60;
pub const REFRESH_TTL_DAYS: i64 = 30;
const ISSUER: &str = "api";

pub struct TokenService {
    signing: SigningKey,
    verifying: VerifyingKey,
    kid: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Header {
    alg: String,
    typ: String,
    kid: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    did: String,
    iat: i64,
    exp: i64,
    iss: String,
}

#[derive(Debug, Clone, Copy)]
pub struct AccessClaims {
    pub user_id: i64,
    pub device_id: i64,
    #[allow(dead_code)] // used by the WebSocket gateway later
    pub expires_at: i64,
}

#[derive(Debug, thiserror::Error)]
#[error("invalid token")]
pub struct InvalidToken;

impl TokenService {
    pub fn new(signing: SigningKey) -> Self {
        let verifying = signing.verifying_key();
        let kid = hex(&Sha256::digest(verifying.as_bytes())[..8]);
        Self {
            signing,
            verifying,
            kid,
        }
    }

    /// Loads the key from `path`. If it doesn't exist and `allow_create` is set
    /// (dev only), creates one. In production a missing key is an error, so
    /// we never silently invalidate everyone's tokens.
    pub fn from_key_file(path: &Path, allow_create: bool) -> anyhow::Result<Self> {
        let seed: [u8; 32] = if path.exists() {
            B64.decode(crate::common::secrets::read(path)?)?
                .try_into()
                .map_err(|_| anyhow::anyhow!("signing key must be 32 bytes"))?
        } else if allow_create {
            let mut seed = [0u8; 32];
            OsRng.fill_bytes(&mut seed);
            crate::common::secrets::create(path, &B64.encode(seed))?;
            tracing::warn!(path = %path.display(), "created a new token signing key (dev)");
            seed
        } else {
            anyhow::bail!("signing key not found at {}", path.display());
        };
        Ok(Self::new(SigningKey::from_bytes(&seed)))
    }

    pub fn issue_access(&self, user_id: i64, device_id: i64, now: i64) -> (String, i64) {
        let exp = now + ACCESS_TTL_SECS;
        let header = Header {
            alg: "EdDSA".into(),
            typ: "JWT".into(),
            kid: self.kid.clone(),
        };
        let claims = Claims {
            sub: user_id.to_string(),
            did: device_id.to_string(),
            iat: now,
            exp,
            iss: ISSUER.into(),
        };
        let signed = format!("{}.{}", encode_json(&header), encode_json(&claims));
        let sig = self.signing.sign(signed.as_bytes());
        (format!("{signed}.{}", B64.encode(sig.to_bytes())), exp)
    }

    pub fn verify_access(&self, token: &str) -> Result<AccessClaims, InvalidToken> {
        self.verify_access_at(token, chrono::Utc::now().timestamp())
    }

    pub fn verify_access_at(&self, token: &str, now: i64) -> Result<AccessClaims, InvalidToken> {
        let (signed, sig) = token.rsplit_once('.').ok_or(InvalidToken)?;
        let (header, claims) = signed.split_once('.').ok_or(InvalidToken)?;

        let sig: [u8; 64] = B64
            .decode(sig)
            .map_err(|_| InvalidToken)?
            .try_into()
            .map_err(|_| InvalidToken)?;
        self.verifying
            .verify(signed.as_bytes(), &Signature::from_bytes(&sig))
            .map_err(|_| InvalidToken)?;

        let header: Header = decode_json(header)?;
        let claims: Claims = decode_json(claims)?;
        if header.alg != "EdDSA"
            || header.kid != self.kid
            || claims.iss != ISSUER
            || claims.exp <= now
        {
            return Err(InvalidToken);
        }
        Ok(AccessClaims {
            user_id: claims.sub.parse().map_err(|_| InvalidToken)?,
            device_id: claims.did.parse().map_err(|_| InvalidToken)?,
            expires_at: claims.exp,
        })
    }

    /// Returns `(token for the client, hash to store)`.
    pub fn new_refresh_token(&self) -> (String, Vec<u8>) {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let token = B64.encode(bytes);
        let hash = hash_refresh_token(&token);
        (token, hash)
    }
}

pub fn hash_refresh_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn encode_json<T: Serialize>(value: &T) -> String {
    B64.encode(serde_json::to_vec(value).expect("serializable"))
}

fn decode_json<T: for<'de> Deserialize<'de>>(part: &str) -> Result<T, InvalidToken> {
    let bytes = B64.decode(part).map_err(|_| InvalidToken)?;
    serde_json::from_slice(&bytes).map_err(|_| InvalidToken)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> TokenService {
        TokenService::new(SigningKey::from_bytes(&[7u8; 32]))
    }

    #[test]
    fn roundtrip() {
        let tokens = service();
        let (token, exp) = tokens.issue_access(42, 9, 1_000);
        let claims = tokens.verify_access_at(&token, 1_001).unwrap();
        assert_eq!(
            (claims.user_id, claims.device_id, claims.expires_at),
            (42, 9, exp)
        );
    }

    #[test]
    fn rejects_expired() {
        let tokens = service();
        let (token, exp) = tokens.issue_access(1, 1, 1_000);
        assert!(tokens.verify_access_at(&token, exp).is_err());
    }

    #[test]
    fn rejects_tampered_claims() {
        let tokens = service();
        let (token, _) = tokens.issue_access(1, 1, 1_000);
        let parts: Vec<&str> = token.split('.').collect();
        let forged = Claims {
            sub: "999".into(),
            did: "1".into(),
            iat: 1_000,
            exp: 9_999_999_999,
            iss: ISSUER.into(),
        };
        let forged = format!("{}.{}.{}", parts[0], encode_json(&forged), parts[2]);
        assert!(tokens.verify_access_at(&forged, 1_001).is_err());
    }

    #[test]
    fn rejects_other_key() {
        let (token, _) = service().issue_access(1, 1, 1_000);
        let other = TokenService::new(SigningKey::from_bytes(&[8u8; 32]));
        assert!(other.verify_access_at(&token, 1_001).is_err());
    }

    #[test]
    fn refresh_hash_matches() {
        let (token, hash) = service().new_refresh_token();
        assert_eq!(hash_refresh_token(&token), hash);
        assert_ne!(token.as_bytes(), hash.as_slice());
    }
}
