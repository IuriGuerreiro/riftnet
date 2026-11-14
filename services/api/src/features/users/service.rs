use std::sync::Arc;

use super::models::User;
use super::repository::UserRepo;
use crate::common::error::{ApiError, RepoError};

pub struct UserService {
    repo: Arc<dyn UserRepo>,
}

impl UserService {
    pub fn new(repo: Arc<dyn UserRepo>) -> Self {
        Self { repo }
    }

    #[tracing::instrument(name = "users.get", skip_all, fields(user.id = id))]
    pub async fn get(&self, id: i64) -> Result<User, ApiError> {
        self.repo.find_by_id(id).await?.ok_or(ApiError::NotFound)
    }

    #[tracing::instrument(name = "users.set_username", skip_all, fields(user.id = id))]
    pub async fn set_username(&self, id: i64, raw: &str) -> Result<User, ApiError> {
        let username = normalize_username(raw)?;
        match self.repo.set_username(id, &username).await {
            Ok(Some(user)) => Ok(user),
            Ok(None) => Err(ApiError::NotFound),
            Err(RepoError::Conflict) => Err(ApiError::conflict(
                "username_taken",
                "that username is taken",
            )),
            Err(e) => Err(e.into()),
        }
    }

    /// Finds users whose username starts with `raw_query` (case-insensitive),
    /// never including `me`.
    #[tracing::instrument(name = "users.search", skip_all, fields(user.id = me))]
    pub async fn search(
        &self,
        me: i64,
        raw_query: &str,
        limit: Option<u32>,
    ) -> Result<Vec<User>, ApiError> {
        let prefix = normalize_search_query(raw_query)?;
        Ok(self
            .repo
            .search_by_username_prefix(
                &prefix,
                &prefix_upper_bound(&prefix),
                me,
                search_limit(limit),
            )
            .await?)
    }
}

pub const SEARCH_DEFAULT_LIMIT: u32 = 20;
pub const SEARCH_MAX_LIMIT: u32 = 50;

/// Missing → 20. Clamped to 1..=50.
fn search_limit(requested: Option<u32>) -> i64 {
    requested
        .unwrap_or(SEARCH_DEFAULT_LIMIT)
        .clamp(1, SEARCH_MAX_LIMIT)
        .into()
}

/// Same characters as a username, but 1–32 long (it's a prefix).
fn normalize_search_query(raw: &str) -> Result<String, ApiError> {
    let query = raw.trim().to_lowercase();
    let len_ok = (1..=32).contains(&query.chars().count());
    let chars_ok = query
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.');
    if !len_ok || !chars_ok {
        return Err(ApiError::bad_request(
            "invalid_query",
            "1–32 characters: letters, numbers, _ and .",
        ));
    }
    Ok(query)
}

/// The first string after every string that starts with `prefix`:
/// "mon" → "moo". Safe because the query is plain ASCII (checked above).
fn prefix_upper_bound(prefix: &str) -> String {
    let mut bytes = prefix.as_bytes().to_vec();
    if let Some(last) = bytes.last_mut() {
        *last += 1;
    }
    String::from_utf8(bytes).expect("ascii stays ascii")
}

/// 3–32 chars, lowercase letters, digits, `_` and `.`. Stored lowercase.
pub fn normalize_username(raw: &str) -> Result<String, ApiError> {
    let username = raw.trim().to_lowercase();
    let len_ok = (3..=32).contains(&username.chars().count());
    let chars_ok = username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.');
    if !len_ok || !chars_ok {
        return Err(ApiError::bad_request(
            "invalid_username",
            "3–32 characters: letters, numbers, _ and .",
        ));
    }
    Ok(username)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_rules() {
        assert_eq!(normalize_username("  Monke_99 ").unwrap(), "monke_99");
        assert!(normalize_username("ab").is_err());
        assert!(normalize_username("has space").is_err());
        assert!(normalize_username("émoji").is_err());
        assert!(normalize_username(&"a".repeat(33)).is_err());
    }

    #[test]
    fn search_query_rules() {
        assert_eq!(normalize_search_query("  MoN ").unwrap(), "mon");
        assert_eq!(normalize_search_query("a").unwrap(), "a");
        assert!(normalize_search_query("   ").is_err());
        assert!(normalize_search_query("a%").is_err());
        assert!(normalize_search_query("a b").is_err());
        assert!(normalize_search_query(&"a".repeat(33)).is_err());
    }

    #[test]
    fn search_limit_defaults_and_caps() {
        assert_eq!(search_limit(None), 20);
        assert_eq!(search_limit(Some(0)), 1);
        assert_eq!(search_limit(Some(10)), 10);
        assert_eq!(search_limit(Some(500)), 50);
    }

    #[test]
    fn upper_bound_bumps_last_char() {
        assert_eq!(prefix_upper_bound("mon"), "moo");
        assert_eq!(prefix_upper_bound("az"), "a{");
        assert_eq!(prefix_upper_bound("a_"), "a`");
    }
}
