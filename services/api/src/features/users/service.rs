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
}

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
}
