use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use protocol::Message as _;
use protocol::v1::{self, Envelope, envelope::Payload};

use super::models::{FriendState, Friendship, FriendshipStatus, MAX_PENDING_OUTGOING};
use super::repository::FriendRepo;
use crate::common::error::{ApiError, RepoError};
use crate::common::events::EventBus;
use crate::features::users::models::User;
use crate::features::users::repository::UserRepo;
use crate::features::users::service::normalize_username;

#[derive(Debug, Clone)]
pub struct FriendEntry {
    pub user: User,
    pub state: FriendState,
    pub since: DateTime<Utc>,
}

pub struct FriendService {
    repo: Arc<dyn FriendRepo>,
    users: Arc<dyn UserRepo>,
    events: Arc<dyn EventBus>,
}

impl FriendService {
    pub fn new(
        repo: Arc<dyn FriendRepo>,
        users: Arc<dyn UserRepo>,
        events: Arc<dyn EventBus>,
    ) -> Self {
        Self {
            repo,
            users,
            events,
        }
    }

    #[tracing::instrument(name = "friends.list", skip_all, fields(user.id = me))]
    pub async fn list(&self, me: i64) -> Result<Vec<FriendEntry>, ApiError> {
        let rows = self.repo.list_for_user(me).await?;
        let other_ids: Vec<i64> = rows.iter().map(|row| row.other(me)).collect();
        let profiles: HashMap<i64, User> = self
            .users
            .find_by_ids(&other_ids)
            .await?
            .into_iter()
            .map(|user| (user.id, user))
            .collect();

        Ok(rows
            .iter()
            .filter_map(|row| {
                let user = profiles.get(&row.other(me))?.clone();
                Some(entry(row, me, user))
            })
            .collect())
    }

    #[tracing::instrument(name = "friends.send_request", skip_all, fields(user.id = me))]
    pub async fn send_request(&self, me: i64, username: &str) -> Result<FriendEntry, ApiError> {
        let target = self.find_user(username).await?;
        if target.id == me {
            return Err(ApiError::bad_request(
                "cannot_friend_self",
                "you can't add yourself",
            ));
        }

        if let Some(existing) = self.repo.find(me, target.id).await? {
            return self.answer_existing(me, target, existing).await;
        }

        if self.repo.count_pending_outgoing(me).await? >= MAX_PENDING_OUTGOING {
            return Err(ApiError::conflict(
                "too_many_pending",
                "too many pending requests, wait for some answers",
            ));
        }

        match self.repo.create_request(me, target.id).await {
            Ok(row) => {
                self.announce(&row, me, target.id).await;
                Ok(entry(&row, me, target))
            }
            Err(RepoError::Conflict) => match self.repo.find(me, target.id).await? {
                Some(existing) => self.answer_existing(me, target, existing).await,
                None => Err(ApiError::conflict("try_again", "please try again")),
            },
            Err(err) => Err(err.into()),
        }
    }

    #[tracing::instrument(name = "friends.accept", skip_all, fields(user.id = me))]
    pub async fn accept(&self, me: i64, requester_id: i64) -> Result<FriendEntry, ApiError> {
        let requester = self
            .users
            .find_by_id(requester_id)
            .await?
            .ok_or(ApiError::NotFound)?;
        match self.repo.accept(me, requester_id).await? {
            Some(row) => {
                self.announce(&row, me, requester_id).await;
                Ok(entry(&row, me, requester))
            }
            None => match self.repo.find(me, requester_id).await? {
                Some(row) if row.status == FriendshipStatus::Accepted => {
                    Ok(entry(&row, me, requester))
                }
                _ => Err(ApiError::NotFound),
            },
        }
    }

    #[tracing::instrument(name = "friends.delete_request", skip_all, fields(user.id = me))]
    pub async fn delete_request(&self, me: i64, other_id: i64) -> Result<(), ApiError> {
        self.delete_if(me, other_id, FriendshipStatus::Pending)
            .await
    }

    #[tracing::instrument(name = "friends.remove", skip_all, fields(user.id = me))]
    pub async fn remove_friend(&self, me: i64, other_id: i64) -> Result<(), ApiError> {
        self.delete_if(me, other_id, FriendshipStatus::Accepted)
            .await
    }

    async fn delete_if(
        &self,
        me: i64,
        other_id: i64,
        status: FriendshipStatus,
    ) -> Result<(), ApiError> {
        match self.repo.find(me, other_id).await? {
            Some(row) if row.status == status => {}
            None => return Ok(()),
            Some(_) => return Err(ApiError::NotFound),
        }
        if self.repo.delete(me, other_id).await?.is_some() {
            self.announce_gone(me, other_id).await;
        }
        Ok(())
    }

    async fn answer_existing(
        &self,
        me: i64,
        target: User,
        existing: Friendship,
    ) -> Result<FriendEntry, ApiError> {
        match existing.state_for(me) {
            FriendState::Friend | FriendState::Outgoing => Ok(entry(&existing, me, target)),
            FriendState::Incoming | FriendState::None => {
                self.accept(me, target.id).await.map(|mut accepted| {
                    accepted.user = target;
                    accepted
                })
            }
        }
    }

    async fn find_user(&self, username: &str) -> Result<User, ApiError> {
        let not_found = || ApiError::bad_request("user_not_found", "no user with that username");
        let username = normalize_username(username).map_err(|_| not_found())?;
        self.users
            .find_by_username(&username)
            .await?
            .ok_or_else(not_found)
    }

    async fn announce(&self, row: &Friendship, me: i64, other_id: i64) {
        let Ok(profiles) = self.users.find_by_ids(&[me, other_id]).await else {
            tracing::warn!("friend push skipped: profile lookup failed");
            return;
        };
        for receiver in [me, other_id] {
            let about = if receiver == me { other_id } else { me };
            if let Some(user) = profiles.iter().find(|u| u.id == about) {
                self.push(receiver, user, row.state_for(receiver)).await;
            }
        }
    }

    async fn announce_gone(&self, me: i64, other_id: i64) {
        let Ok(profiles) = self.users.find_by_ids(&[me, other_id]).await else {
            tracing::warn!("friend push skipped: profile lookup failed");
            return;
        };
        for receiver in [me, other_id] {
            let about = if receiver == me { other_id } else { me };
            if let Some(user) = profiles.iter().find(|u| u.id == about) {
                self.push(receiver, user, FriendState::None).await;
            }
        }
    }

    async fn push(&self, receiver: i64, about: &User, state: FriendState) {
        let envelope = Envelope {
            id: 0,
            payload: Some(Payload::FriendUpdated(v1::FriendUpdated {
                user: Some(about.into()),
                state: v1::FriendState::from(state) as i32,
            })),
        };
        if let Err(err) = self
            .events
            .publish_to_users(&[receiver], envelope.encode_to_vec().into())
            .await
        {
            tracing::warn!(error = %err, "friend push failed");
        }
    }
}

fn entry(row: &Friendship, me: i64, user: User) -> FriendEntry {
    FriendEntry {
        user,
        state: row.state_for(me),
        since: row.accepted_at.unwrap_or(row.created_at),
    }
}

impl From<FriendState> for v1::FriendState {
    fn from(state: FriendState) -> Self {
        match state {
            FriendState::None => Self::None,
            FriendState::Incoming => Self::Incoming,
            FriendState::Outgoing => Self::Outgoing,
            FriendState::Friend => Self::Friend,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use bytes::Bytes;
    use futures::stream::BoxStream;

    use super::*;
    use crate::features::friends::models::ordered_pair;

    #[derive(Default)]
    struct FakeFriendRepo {
        rows: Mutex<HashMap<(i64, i64), Friendship>>,
    }

    #[async_trait]
    impl FriendRepo for FakeFriendRepo {
        async fn find(&self, a: i64, b: i64) -> Result<Option<Friendship>, RepoError> {
            Ok(self.rows.lock().unwrap().get(&ordered_pair(a, b)).cloned())
        }
        async fn list_for_user(&self, user_id: i64) -> Result<Vec<Friendship>, RepoError> {
            let rows = self.rows.lock().unwrap();
            Ok(rows
                .values()
                .filter(|r| r.user_low == user_id || r.user_high == user_id)
                .cloned()
                .collect())
        }
        async fn count_pending_outgoing(&self, user_id: i64) -> Result<i64, RepoError> {
            let rows = self.rows.lock().unwrap();
            Ok(rows
                .values()
                .filter(|r| r.requester_id == user_id && r.status == FriendshipStatus::Pending)
                .count() as i64)
        }
        async fn create_request(
            &self,
            requester: i64,
            target: i64,
        ) -> Result<Friendship, RepoError> {
            let (user_low, user_high) = ordered_pair(requester, target);
            let mut rows = self.rows.lock().unwrap();
            if rows.contains_key(&(user_low, user_high)) {
                return Err(RepoError::Conflict);
            }
            let row = Friendship {
                user_low,
                user_high,
                requester_id: requester,
                status: FriendshipStatus::Pending,
                created_at: Utc::now(),
                accepted_at: None,
            };
            rows.insert((user_low, user_high), row.clone());
            Ok(row)
        }
        async fn accept(
            &self,
            acceptor: i64,
            requester: i64,
        ) -> Result<Option<Friendship>, RepoError> {
            let mut rows = self.rows.lock().unwrap();
            let Some(row) = rows.get_mut(&ordered_pair(acceptor, requester)) else {
                return Ok(None);
            };
            if row.status != FriendshipStatus::Pending || row.requester_id != requester {
                return Ok(None);
            }
            row.status = FriendshipStatus::Accepted;
            row.accepted_at = Some(Utc::now());
            Ok(Some(row.clone()))
        }
        async fn delete(&self, a: i64, b: i64) -> Result<Option<Friendship>, RepoError> {
            Ok(self.rows.lock().unwrap().remove(&ordered_pair(a, b)))
        }
    }

    struct FakeUserRepo {
        users: Vec<User>,
    }

    #[async_trait]
    impl UserRepo for FakeUserRepo {
        async fn find_by_email(&self, _: &str) -> Result<Option<User>, RepoError> {
            unimplemented!()
        }
        async fn remember_email(&self, _: i64, _: &str) -> Result<(), RepoError> {
            unimplemented!()
        }
        async fn find_by_id(&self, id: i64) -> Result<Option<User>, RepoError> {
            Ok(self.users.iter().find(|u| u.id == id).cloned())
        }
        async fn find_by_zitadel_id(&self, _: &str) -> Result<Option<User>, RepoError> {
            Ok(None)
        }
        async fn find_by_ids(&self, ids: &[i64]) -> Result<Vec<User>, RepoError> {
            Ok(self
                .users
                .iter()
                .filter(|u| ids.contains(&u.id))
                .cloned()
                .collect())
        }
        async fn find_by_username(&self, username: &str) -> Result<Option<User>, RepoError> {
            Ok(self
                .users
                .iter()
                .find(|u| u.username.as_deref() == Some(username))
                .cloned())
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
        async fn set_username(&self, _: i64, _: &str) -> Result<Option<User>, RepoError> {
            unimplemented!()
        }
        async fn set_profile(
            &self,
            _: i64,
            _: crate::features::users::repository::ProfileUpdate<'_>,
        ) -> Result<Option<User>, RepoError> {
            unimplemented!()
        }
        async fn set_image(
            &self,
            _: i64,
            _: crate::features::users::image::ProfileImage,
            _: Option<&[u8]>,
        ) -> Result<Option<(User, Option<Vec<u8>>)>, RepoError> {
            unimplemented!()
        }
    }

    #[derive(Default)]
    struct FakeEvents {
        sent: Mutex<Vec<(i64, v1::FriendUpdated)>>,
    }

    #[async_trait]
    impl EventBus for FakeEvents {
        async fn publish_to_users(&self, user_ids: &[i64], payload: Bytes) -> anyhow::Result<()> {
            let envelope = Envelope::decode(payload)?;
            if let Some(Payload::FriendUpdated(update)) = envelope.payload {
                for id in user_ids {
                    self.sent.lock().unwrap().push((*id, update.clone()));
                }
            }
            Ok(())
        }
        async fn subscribe_user(&self, _: i64) -> anyhow::Result<BoxStream<'static, Bytes>> {
            unimplemented!()
        }
    }

    const ANA: i64 = 10;
    const BOB: i64 = 20;

    fn user(id: i64, name: &str) -> User {
        User {
            id,
            zitadel_id: format!("z{id}"),
            username: Some(name.into()),
            display_name: None,
            bio: None,
            custom_status: None,
            avatar_hash: None,
            banner_hash: None,
            accent_color: None,
            pronouns: None,
            created_at: Utc::now(),
        }
    }

    fn setup() -> (FriendService, Arc<FakeEvents>) {
        let events = Arc::new(FakeEvents::default());
        let users = Arc::new(FakeUserRepo {
            users: vec![user(ANA, "ana"), user(BOB, "bob")],
        });
        let service =
            FriendService::new(Arc::new(FakeFriendRepo::default()), users, events.clone());
        (service, events)
    }

    fn code(err: ApiError) -> &'static str {
        err.describe().1
    }

    #[tokio::test]
    async fn request_then_accept() {
        let (service, events) = setup();

        let sent = service.send_request(ANA, "bob").await.unwrap();
        assert_eq!(sent.state, FriendState::Outgoing);
        let bob_view = service.list(BOB).await.unwrap();
        assert_eq!(bob_view[0].state, FriendState::Incoming);
        assert_eq!(bob_view[0].user.id, ANA);

        assert!(service.accept(ANA, ANA).await.is_err());
        assert!(service.accept(ANA, BOB).await.is_err());

        let accepted = service.accept(BOB, ANA).await.unwrap();
        assert_eq!(accepted.state, FriendState::Friend);
        assert_eq!(
            service.list(ANA).await.unwrap()[0].state,
            FriendState::Friend
        );

        let sent = events.sent.lock().unwrap();
        let to_bob: Vec<_> = sent.iter().filter(|(to, _)| *to == BOB).collect();
        assert_eq!(to_bob[0].1.state, v1::FriendState::Incoming as i32);
        assert_eq!(to_bob[0].1.user.as_ref().unwrap().id, ANA as u64);
        assert_eq!(to_bob[1].1.state, v1::FriendState::Friend as i32);
    }

    #[tokio::test]
    async fn cannot_add_self_or_unknown() {
        let (service, _) = setup();
        assert_eq!(
            code(service.send_request(ANA, "ana").await.unwrap_err()),
            "cannot_friend_self"
        );
        assert_eq!(
            code(service.send_request(ANA, "nobody").await.unwrap_err()),
            "user_not_found"
        );
    }

    #[tokio::test]
    async fn retries_are_safe_and_push_once() {
        let (service, events) = setup();
        service.send_request(ANA, "bob").await.unwrap();
        let again = service.send_request(ANA, "bob").await.unwrap();
        assert_eq!(again.state, FriendState::Outgoing);

        service.accept(BOB, ANA).await.unwrap();
        let again = service.accept(BOB, ANA).await.unwrap();
        assert_eq!(again.state, FriendState::Friend);
        let back = service.send_request(BOB, "ana").await.unwrap();
        assert_eq!(back.state, FriendState::Friend);

        assert_eq!(events.sent.lock().unwrap().len(), 4);

        service.remove_friend(ANA, BOB).await.unwrap();
        service.remove_friend(ANA, BOB).await.unwrap();
        service.delete_request(ANA, BOB).await.unwrap();
        assert_eq!(events.sent.lock().unwrap().len(), 6);
    }

    #[tokio::test]
    async fn requesting_back_accepts() {
        let (service, _) = setup();
        service.send_request(ANA, "bob").await.unwrap();
        let back = service.send_request(BOB, "ana").await.unwrap();
        assert_eq!(back.state, FriendState::Friend);
        assert_eq!(back.user.id, ANA);
    }

    #[tokio::test]
    async fn decline_cancel_and_remove() {
        let (service, events) = setup();

        service.send_request(ANA, "bob").await.unwrap();
        service.delete_request(BOB, ANA).await.unwrap();
        assert!(service.list(ANA).await.unwrap().is_empty());

        service.send_request(ANA, "bob").await.unwrap();
        service.delete_request(ANA, BOB).await.unwrap();
        assert!(service.list(BOB).await.unwrap().is_empty());

        service.send_request(ANA, "bob").await.unwrap();
        assert!(service.remove_friend(ANA, BOB).await.is_err());

        service.accept(BOB, ANA).await.unwrap();
        assert!(service.delete_request(ANA, BOB).await.is_err());
        service.remove_friend(BOB, ANA).await.unwrap();
        assert!(service.list(ANA).await.unwrap().is_empty());

        let last = events.sent.lock().unwrap().last().cloned().unwrap();
        assert_eq!(last.1.state, v1::FriendState::None as i32);
    }
}
