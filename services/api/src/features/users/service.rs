use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use protocol::Message as _;
use protocol::v1::{Envelope, UserUpdated, envelope::Payload};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::avatar::{self, AVATAR_CONTENT_TYPE, AVATAR_SIZES};
use super::models::{User, hex};
use super::repository::UserRepo;
use crate::common::error::{ApiError, RepoError};
use crate::common::events::EventBus;
use crate::common::storage::FileStore;
use crate::features::conversations::repository::ConversationRepo;
use crate::features::friends::audience::audience;
use crate::features::friends::repository::FriendRepo;

pub const MAX_DISPLAY_NAME_CHARS: usize = 32;
pub const MAX_BIO_CHARS: usize = 190;
/// How long an avatar link works once handed out.
const AVATAR_URL_TTL: Duration = Duration::from_secs(5 * 60);
/// Avatars processed at once, across all users (CPU + ~150 MiB each).
/// Extra uploads are turned away, not queued, before their body is read.
const AVATARS_IN_FLIGHT: usize = 2;

/// PATCH /me input. None = leave alone, Some("") = clear.
#[derive(Debug, Default)]
pub struct ProfileChanges {
    pub display_name: Option<String>,
    pub bio: Option<String>,
}

pub struct UserService {
    repo: Arc<dyn UserRepo>,
    store: Arc<dyn FileStore>,
    friends: Arc<dyn FriendRepo>,
    conversations: Arc<dyn ConversationRepo>,
    events: Arc<dyn EventBus>,
    avatar_slots: Arc<Semaphore>,
}

impl UserService {
    pub fn new(
        repo: Arc<dyn UserRepo>,
        store: Arc<dyn FileStore>,
        friends: Arc<dyn FriendRepo>,
        conversations: Arc<dyn ConversationRepo>,
        events: Arc<dyn EventBus>,
    ) -> Self {
        Self {
            repo,
            store,
            friends,
            conversations,
            events,
            avatar_slots: Arc::new(Semaphore::new(AVATARS_IN_FLIGHT)),
        }
    }

    /// Any logged-in user may read any profile: search already shows everyone.
    #[tracing::instrument(name = "users.get", skip_all, fields(user.id = id))]
    pub async fn get(&self, id: i64) -> Result<User, ApiError> {
        self.repo.find_by_id(id).await?.ok_or(ApiError::NotFound)
    }

    #[tracing::instrument(name = "users.set_username", skip_all, fields(user.id = id))]
    pub async fn set_username(&self, id: i64, raw: &str) -> Result<User, ApiError> {
        let username = normalize_username(raw)?;
        let user = match self.repo.set_username(id, &username).await {
            Ok(Some(user)) => user,
            Ok(None) => return Err(ApiError::NotFound),
            Err(RepoError::Conflict) => {
                return Err(ApiError::conflict(
                    "username_taken",
                    "that username is taken",
                ));
            }
            Err(e) => return Err(e.into()),
        };
        self.announce(&user).await;
        Ok(user)
    }

    #[tracing::instrument(name = "users.update_profile", skip_all, fields(user.id = me))]
    pub async fn update_profile(&self, me: i64, changes: ProfileChanges) -> Result<User, ApiError> {
        let display_name = changes
            .display_name
            .as_deref()
            .map(|raw| clean_text(raw, MAX_DISPLAY_NAME_CHARS, false, "invalid_display_name"))
            .transpose()?;
        let bio = changes
            .bio
            .as_deref()
            .map(|raw| clean_text(raw, MAX_BIO_CHARS, true, "invalid_bio"))
            .transpose()?;

        let user = self
            .repo
            .set_profile(
                me,
                display_name.as_ref().map(Option::as_deref),
                bio.as_ref().map(Option::as_deref),
            )
            .await?
            .ok_or(ApiError::NotFound)?;
        self.announce(&user).await;
        Ok(user)
    }

    /// A free avatar slot, or "busy" right away. Take it before reading the
    /// upload body so waiting uploads never pile up in memory.
    pub fn avatar_slot(&self) -> Result<OwnedSemaphorePermit, ApiError> {
        self.avatar_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| ApiError::TooManyRequests)
    }

    /// Checks and re-encodes the image, stores every size, then swaps it in
    /// and deletes the old files.
    #[tracing::instrument(name = "users.set_avatar", skip_all, fields(user.id = me, bytes = data.len()))]
    pub async fn set_avatar(
        &self,
        me: i64,
        data: Bytes,
        slot: OwnedSemaphorePermit,
    ) -> Result<User, ApiError> {
        // The slot moves into the job: a cancelled request can't free it
        // while the decode is still running.
        let processed = tokio::task::spawn_blocking(move || {
            let _slot = slot;
            avatar::process(&data)
        })
        .await
        .map_err(anyhow::Error::from)??;

        // Every upload gets its own id, so its files are never shared with
        // another upload. Cleanup of an old avatar can't hit the live one,
        // even when the same image is uploaded twice at once.
        let hash = upload_id(&processed.hash);
        let hash_hex = hex(&hash);
        for (size, bytes) in processed.files {
            if let Err(err) = self
                .store
                .put_object(&avatar_key(me, &hash_hex, size), AVATAR_CONTENT_TYPE, bytes)
                .await
            {
                self.delete_files(me, &hash).await;
                return Err(err.into());
            }
        }

        let (user, old) = match self.repo.set_avatar(me, Some(&hash)).await {
            Ok(Some(swap)) => swap,
            Ok(None) => {
                self.delete_files(me, &hash).await;
                return Err(ApiError::NotFound);
            }
            Err(err) => {
                self.delete_files(me, &hash).await;
                return Err(err.into());
            }
        };
        if let Some(old) = old {
            self.delete_files(me, &old).await;
        }
        self.announce(&user).await;
        Ok(user)
    }

    #[tracing::instrument(name = "users.remove_avatar", skip_all, fields(user.id = me))]
    pub async fn remove_avatar(&self, me: i64) -> Result<User, ApiError> {
        let (user, old) = self
            .repo
            .set_avatar(me, None)
            .await?
            .ok_or(ApiError::NotFound)?;
        if let Some(old) = old {
            self.delete_files(me, &old).await;
            self.announce(&user).await;
        }
        Ok(user)
    }

    /// A short-lived link to `user_id`'s avatar, only while `hash_hex` is current.
    #[tracing::instrument(name = "users.avatar_url", skip_all, fields(user.id = user_id))]
    pub async fn avatar_url(
        &self,
        user_id: i64,
        hash_hex: &str,
        size: Option<u32>,
    ) -> Result<String, ApiError> {
        let size = size.unwrap_or(AVATAR_SIZES[0]);
        if !AVATAR_SIZES.contains(&size) {
            return Err(ApiError::bad_request("bad_size", "size must be 128 or 512"));
        }
        let user = self.get(user_id).await?;
        if user.avatar_hex().as_deref() != Some(hash_hex) {
            return Err(ApiError::NotFound);
        }
        Ok(self
            .store
            .view_url(&avatar_key(user_id, hash_hex, size), AVATAR_URL_TTL)
            .await?)
    }

    /// Best effort: a leftover file is only wasted space, never shown.
    async fn delete_files(&self, user_id: i64, hash: &[u8]) {
        let hash_hex = hex(hash);
        for size in AVATAR_SIZES {
            if let Err(err) = self
                .store
                .delete(&avatar_key(user_id, &hash_hex, size))
                .await
            {
                tracing::warn!(error = %err, "old avatar delete failed");
            }
        }
    }

    /// Pushes UserUpdated to the user, their friends and conversation members.
    async fn announce(&self, user: &User) {
        let mut receivers: Vec<i64> =
            match audience(&*self.friends, &*self.conversations, user.id).await {
                Ok(set) => set.into_iter().collect(),
                Err(err) => {
                    tracing::warn!(error = ?err, "profile push skipped: audience lookup failed");
                    return;
                }
            };
        receivers.push(user.id);
        let envelope = Envelope {
            id: 0,
            payload: Some(Payload::UserUpdated(UserUpdated {
                user: Some(user.into()),
            })),
        };
        if let Err(err) = self
            .events
            .publish_to_users(&receivers, envelope.encode_to_vec().into())
            .await
        {
            tracing::warn!(error = %err, "profile push failed");
        }
    }

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

fn search_limit(requested: Option<u32>) -> i64 {
    requested
        .unwrap_or(SEARCH_DEFAULT_LIMIT)
        .clamp(1, SEARCH_MAX_LIMIT)
        .into()
}

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

fn prefix_upper_bound(prefix: &str) -> String {
    let mut bytes = prefix.as_bytes().to_vec();
    if let Some(last) = bytes.last_mut() {
        *last += 1;
    }
    String::from_utf8(bytes).expect("ascii stays ascii")
}

/// BLAKE3 of the image plus a random nonce: unique per upload.
fn upload_id(content_hash: &[u8; 32]) -> [u8; 32] {
    let nonce: [u8; 16] = rand::random();
    let mut h = blake3::Hasher::new();
    h.update(content_hash);
    h.update(&nonce);
    *h.finalize().as_bytes()
}

pub fn avatar_key(user_id: i64, hash_hex: &str, size: u32) -> String {
    format!("avatars/{user_id}/{hash_hex}/{size}.webp")
}

/// Trims, rejects control characters (newlines allowed if `multiline`)
/// and anything over `max` chars. Empty means "clear it": None.
fn clean_text(
    raw: &str,
    max: usize,
    multiline: bool,
    code: &'static str,
) -> Result<Option<String>, ApiError> {
    let text = raw.trim();
    if text.chars().count() > max {
        return Err(ApiError::bad_request(
            code,
            format!("at most {max} characters"),
        ));
    }
    if text
        .chars()
        .any(|c| c.is_control() && !(multiline && c == '\n'))
    {
        return Err(ApiError::bad_request(code, "no control characters"));
    }
    Ok((!text.is_empty()).then(|| text.to_string()))
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
    use std::collections::HashMap;
    use std::sync::Mutex;

    use async_trait::async_trait;
    use chrono::Utc;
    use futures::stream::BoxStream;

    use super::*;
    use crate::features::conversations::models::{ConversationRecord, Kind};
    use crate::features::friends::models::{Friendship, FriendshipStatus, ordered_pair};

    const ANA: i64 = 10;
    const BOB: i64 = 20;
    const CAT: i64 = 30;
    const DAN: i64 = 40;

    #[derive(Default)]
    struct FakeUsers(Mutex<HashMap<i64, User>>);

    #[async_trait]
    impl UserRepo for FakeUsers {
        async fn find_by_id(&self, id: i64) -> Result<Option<User>, RepoError> {
            Ok(self.0.lock().unwrap().get(&id).cloned())
        }
        async fn find_by_zitadel_id(&self, _: &str) -> Result<Option<User>, RepoError> {
            unimplemented!()
        }
        async fn find_by_ids(&self, _: &[i64]) -> Result<Vec<User>, RepoError> {
            unimplemented!()
        }
        async fn find_by_username(&self, _: &str) -> Result<Option<User>, RepoError> {
            unimplemented!()
        }
        async fn search_by_username_prefix(
            &self,
            _: &str,
            _: &str,
            _: i64,
            _: i64,
        ) -> Result<Vec<User>, RepoError> {
            unimplemented!()
        }
        async fn create(&self, _: i64, _: &str) -> Result<User, RepoError> {
            unimplemented!()
        }
        async fn set_username(&self, id: i64, name: &str) -> Result<Option<User>, RepoError> {
            let mut users = self.0.lock().unwrap();
            Ok(users.get_mut(&id).map(|u| {
                u.username = Some(name.into());
                u.clone()
            }))
        }
        async fn set_profile(
            &self,
            id: i64,
            display_name: Option<Option<&str>>,
            bio: Option<Option<&str>>,
        ) -> Result<Option<User>, RepoError> {
            let mut users = self.0.lock().unwrap();
            Ok(users.get_mut(&id).map(|u| {
                if let Some(v) = display_name {
                    u.display_name = v.map(String::from);
                }
                if let Some(v) = bio {
                    u.bio = v.map(String::from);
                }
                u.clone()
            }))
        }
        async fn set_avatar(
            &self,
            id: i64,
            hash: Option<&[u8]>,
        ) -> Result<Option<(User, Option<Vec<u8>>)>, RepoError> {
            let mut users = self.0.lock().unwrap();
            Ok(users.get_mut(&id).map(|u| {
                let old = std::mem::replace(&mut u.avatar_hash, hash.map(<[u8]>::to_vec));
                (u.clone(), old)
            }))
        }
    }

    #[derive(Default)]
    struct FakeStore(Mutex<HashMap<String, Bytes>>);

    impl FakeStore {
        fn keys(&self) -> Vec<String> {
            let mut keys: Vec<String> = self.0.lock().unwrap().keys().cloned().collect();
            keys.sort();
            keys
        }
    }

    #[async_trait]
    impl FileStore for FakeStore {
        async fn put_object(&self, key: &str, _: &str, data: Bytes) -> anyhow::Result<()> {
            self.0.lock().unwrap().insert(key.into(), data);
            Ok(())
        }
        async fn view_url(&self, key: &str, _: Duration) -> anyhow::Result<String> {
            Ok(format!("https://files.test/{key}"))
        }
        async fn delete(&self, key: &str) -> anyhow::Result<()> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
        async fn start_upload(&self, _: &str, _: &str) -> anyhow::Result<String> {
            unimplemented!()
        }
        async fn put_part(&self, _: &str, _: &str, _: u32, _: Bytes) -> anyhow::Result<String> {
            unimplemented!()
        }
        async fn finish_upload(&self, _: &str, _: &str, _: &[String]) -> anyhow::Result<()> {
            unimplemented!()
        }
        async fn list_parts(&self, _: &str, _: &str) -> anyhow::Result<Vec<(u32, String, i64)>> {
            unimplemented!()
        }
        async fn abort_upload(&self, _: &str, _: &str) -> anyhow::Result<()> {
            unimplemented!()
        }
        async fn object_size(&self, _: &str) -> anyhow::Result<Option<i64>> {
            unimplemented!()
        }
        async fn download_url(&self, _: &str, _: &str, _: Duration) -> anyhow::Result<String> {
            unimplemented!()
        }
    }

    struct FakeFriends(Vec<Friendship>);

    #[async_trait]
    impl FriendRepo for FakeFriends {
        async fn find(&self, _: i64, _: i64) -> Result<Option<Friendship>, RepoError> {
            unimplemented!()
        }
        async fn list_for_user(&self, user_id: i64) -> Result<Vec<Friendship>, RepoError> {
            Ok(self
                .0
                .iter()
                .filter(|r| r.user_low == user_id || r.user_high == user_id)
                .cloned()
                .collect())
        }
        async fn count_pending_outgoing(&self, _: i64) -> Result<i64, RepoError> {
            unimplemented!()
        }
        async fn create_request(&self, _: i64, _: i64) -> Result<Friendship, RepoError> {
            unimplemented!()
        }
        async fn accept(&self, _: i64, _: i64) -> Result<Option<Friendship>, RepoError> {
            unimplemented!()
        }
        async fn delete(&self, _: i64, _: i64) -> Result<Option<Friendship>, RepoError> {
            unimplemented!()
        }
    }

    struct FakeConversations(Vec<ConversationRecord>);

    #[async_trait]
    impl ConversationRepo for FakeConversations {
        async fn get_or_create_dm(
            &self,
            _: i64,
            _: i64,
            _: i64,
        ) -> Result<ConversationRecord, RepoError> {
            unimplemented!()
        }
        async fn list_for_user(&self, user_id: i64) -> Result<Vec<ConversationRecord>, RepoError> {
            Ok(self
                .0
                .iter()
                .filter(|c| c.member_ids.contains(&user_id))
                .cloned()
                .collect())
        }
        async fn get(&self, _: i64) -> Result<Option<ConversationRecord>, RepoError> {
            unimplemented!()
        }
        async fn next_seq(&self, _: i64) -> Result<i64, RepoError> {
            unimplemented!()
        }
        async fn create_group(&self, _: &ConversationRecord) -> Result<(), RepoError> {
            unimplemented!()
        }
        async fn set_members(&self, _: i64, _: &[i64], _: &[i64]) -> Result<bool, RepoError> {
            unimplemented!()
        }
        async fn rename(&self, _: i64, _: &str) -> Result<(), RepoError> {
            unimplemented!()
        }
    }

    /// (receivers sorted, pushed user)
    #[derive(Default)]
    struct FakeEvents(Mutex<Vec<(Vec<i64>, protocol::v1::User)>>);

    #[async_trait]
    impl EventBus for FakeEvents {
        async fn publish_to_users(&self, ids: &[i64], payload: Bytes) -> anyhow::Result<()> {
            if let Some(Payload::UserUpdated(u)) = Envelope::decode(payload)?.payload {
                let mut to = ids.to_vec();
                to.sort_unstable();
                self.0.lock().unwrap().push((to, u.user.unwrap()));
            }
            Ok(())
        }
        async fn subscribe_user(&self, _: i64) -> anyhow::Result<BoxStream<'static, Bytes>> {
            unimplemented!()
        }
    }

    fn user(id: i64) -> User {
        User {
            id,
            zitadel_id: format!("z{id}"),
            username: Some(format!("u{id}")),
            display_name: None,
            bio: None,
            avatar_hash: None,
            created_at: Utc::now(),
        }
    }

    fn friendship(a: i64, b: i64, status: FriendshipStatus) -> Friendship {
        let (user_low, user_high) = ordered_pair(a, b);
        Friendship {
            user_low,
            user_high,
            requester_id: a,
            status,
            created_at: Utc::now(),
            accepted_at: None,
        }
    }

    struct Setup {
        svc: UserService,
        store: Arc<FakeStore>,
        events: Arc<FakeEvents>,
    }

    impl Setup {
        fn pushes(&self) -> Vec<(Vec<i64>, protocol::v1::User)> {
            std::mem::take(&mut *self.events.0.lock().unwrap())
        }
    }

    /// ANA: friends with BOB, DM with CAT, pending request from DAN.
    fn setup() -> Setup {
        let users = FakeUsers::default();
        for id in [ANA, BOB, CAT, DAN] {
            users.0.lock().unwrap().insert(id, user(id));
        }
        let store = Arc::new(FakeStore::default());
        let events = Arc::new(FakeEvents::default());
        let svc = UserService::new(
            Arc::new(users),
            store.clone(),
            Arc::new(FakeFriends(vec![
                friendship(ANA, BOB, FriendshipStatus::Accepted),
                friendship(DAN, ANA, FriendshipStatus::Pending),
            ])),
            Arc::new(FakeConversations(vec![ConversationRecord {
                id: 1,
                kind: Kind::Dm,
                last_seq: 0,
                name: String::new(),
                member_ids: vec![ANA, CAT],
            }])),
            events.clone(),
        );
        Setup { svc, store, events }
    }

    impl UserService {
        async fn set_avatar_t(&self, me: i64, data: Bytes) -> Result<User, ApiError> {
            let slot = self.avatar_slot()?;
            self.set_avatar(me, data, slot).await
        }
    }

    #[tokio::test]
    async fn busy_avatar_slots_turn_uploads_away() {
        let t = setup();
        let held: Vec<_> = (0..AVATARS_IN_FLIGHT)
            .map(|_| t.svc.avatar_slot().unwrap())
            .collect();
        assert!(matches!(
            t.svc.avatar_slot(),
            Err(ApiError::TooManyRequests)
        ));
        drop(held);
        assert!(t.svc.avatar_slot().is_ok());
    }

    #[tokio::test]
    async fn partial_updates_keep_the_other_field() {
        let t = setup();
        let changes = |name: Option<&str>, bio: Option<&str>| ProfileChanges {
            display_name: name.map(String::from),
            bio: bio.map(String::from),
        };
        t.svc
            .update_profile(ANA, changes(Some("Ana"), None))
            .await
            .unwrap();
        let u = t
            .svc
            .update_profile(ANA, changes(None, Some("bio")))
            .await
            .unwrap();
        assert_eq!(u.display_name.as_deref(), Some("Ana"));
        assert_eq!(u.bio.as_deref(), Some("bio"));
    }

    fn png(w: u32, h: u32) -> Bytes {
        super::avatar::tests::png(w, h).into()
    }

    #[tokio::test]
    async fn profile_update_merges_validates_and_pushes() {
        let t = setup();
        let u = t
            .svc
            .update_profile(
                ANA,
                ProfileChanges {
                    display_name: Some("  Ana B  ".into()),
                    bio: Some("hi\nthere".into()),
                },
            )
            .await
            .unwrap();
        assert_eq!(u.display_name.as_deref(), Some("Ana B"));
        assert_eq!(u.bio.as_deref(), Some("hi\nthere"));

        let pushes = t.pushes();
        assert_eq!(pushes.len(), 1);
        assert_eq!(
            pushes[0].0,
            vec![ANA, BOB, CAT],
            "not DAN: request is pending"
        );
        assert_eq!(pushes[0].1.display_name, "Ana B");

        // Missing field kept, "" clears.
        let u = t
            .svc
            .update_profile(
                ANA,
                ProfileChanges {
                    display_name: None,
                    bio: Some("".into()),
                },
            )
            .await
            .unwrap();
        assert_eq!(u.display_name.as_deref(), Some("Ana B"));
        assert_eq!(u.bio, None);
    }

    #[tokio::test]
    async fn profile_rejects_bad_text() {
        let t = setup();
        for changes in [
            ProfileChanges {
                display_name: Some("a".repeat(33)),
                bio: None,
            },
            ProfileChanges {
                display_name: Some("two\nlines".into()),
                bio: None,
            },
            ProfileChanges {
                display_name: None,
                bio: Some("b".repeat(191)),
            },
            ProfileChanges {
                display_name: None,
                bio: Some("bell\u{7}".into()),
            },
        ] {
            assert!(t.svc.update_profile(ANA, changes).await.is_err());
        }
        assert!(t.pushes().is_empty());
    }

    #[tokio::test]
    async fn username_change_pushes() {
        let t = setup();
        t.svc.set_username(ANA, "Ana").await.unwrap();
        assert_eq!(t.pushes()[0].1.username, "ana");
    }

    #[tokio::test]
    async fn avatar_upload_replace_and_remove() {
        let t = setup();
        let first = t.svc.set_avatar_t(ANA, png(40, 30)).await.unwrap();
        let h1 = first.avatar_hex().unwrap();
        assert_eq!(
            t.store.keys(),
            vec![avatar_key(ANA, &h1, 128), avatar_key(ANA, &h1, 512)]
        );
        let pushes = t.pushes();
        assert_eq!(pushes[0].0, vec![ANA, BOB, CAT]);
        assert_eq!(pushes[0].1.avatar_hash, h1);

        // Same image again: its own new files, the old ones go.
        let again = t.svc.set_avatar_t(ANA, png(40, 30)).await.unwrap();
        let h1b = again.avatar_hex().unwrap();
        assert_ne!(h1, h1b, "every upload gets its own id");
        assert_eq!(
            t.store.keys(),
            vec![avatar_key(ANA, &h1b, 128), avatar_key(ANA, &h1b, 512)]
        );

        // New image: old files gone.
        let second = t.svc.set_avatar_t(ANA, png(50, 50)).await.unwrap();
        let h2 = second.avatar_hex().unwrap();
        assert_ne!(h1, h2);
        assert_eq!(
            t.store.keys(),
            vec![avatar_key(ANA, &h2, 128), avatar_key(ANA, &h2, 512)]
        );

        t.pushes();
        let removed = t.svc.remove_avatar(ANA).await.unwrap();
        assert_eq!(removed.avatar_hash, None);
        assert!(t.store.keys().is_empty());
        assert_eq!(t.pushes()[0].1.avatar_hash, "");

        // Removing again is a no-op, no push.
        t.svc.remove_avatar(ANA).await.unwrap();
        assert!(t.pushes().is_empty());
    }

    #[tokio::test]
    async fn bad_avatar_stores_nothing() {
        let t = setup();
        assert!(
            t.svc
                .set_avatar_t(ANA, Bytes::from_static(b"not an image"))
                .await
                .is_err()
        );
        assert!(t.store.keys().is_empty());
        assert!(t.pushes().is_empty());
    }

    #[tokio::test]
    async fn avatar_url_only_for_current_hash_and_known_sizes() {
        let t = setup();
        let h = t
            .svc
            .set_avatar_t(ANA, png(20, 20))
            .await
            .unwrap()
            .avatar_hex()
            .unwrap();

        let url = t.svc.avatar_url(ANA, &h, None).await.unwrap();
        assert!(url.ends_with(&format!("{h}/128.webp")));
        assert!(t.svc.avatar_url(ANA, &h, Some(512)).await.is_ok());
        assert!(t.svc.avatar_url(ANA, &h, Some(64)).await.is_err());
        assert!(matches!(
            t.svc.avatar_url(ANA, &"0".repeat(64), None).await,
            Err(ApiError::NotFound)
        ));
        assert!(matches!(
            t.svc.avatar_url(BOB, &h, None).await,
            Err(ApiError::NotFound)
        ));
    }

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
