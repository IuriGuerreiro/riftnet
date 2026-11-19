use std::collections::HashSet;
use std::sync::Arc;

use protocol::Message as _;
use protocol::v1::{self, Envelope, envelope::Payload};

use super::models::{Change, Status};
use super::store::{Op, PresenceStore};
use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::conversations::repository::ConversationRepo;
use crate::features::friends::audience::audience;
use crate::features::friends::repository::FriendRepo;

pub const MAX_PRESENCE_IDS: usize = 200;

pub struct PresenceService {
    store: Arc<dyn PresenceStore>,
    friends: Arc<dyn FriendRepo>,
    conversations: Arc<dyn ConversationRepo>,
    events: Arc<dyn EventBus>,
}

impl PresenceService {
    pub fn new(
        store: Arc<dyn PresenceStore>,
        friends: Arc<dyn FriendRepo>,
        conversations: Arc<dyn ConversationRepo>,
        events: Arc<dyn EventBus>,
    ) -> Self {
        Self {
            store,
            friends,
            conversations,
            events,
        }
    }

    #[tracing::instrument(name = "presence.connected", skip_all, fields(user.id = user_id))]
    pub async fn connected(&self, user_id: i64, connection_id: u64) {
        self.apply(user_id, connection_id, Op::Touch).await;
    }

    pub async fn heartbeat(&self, user_id: i64, connection_id: u64) {
        self.apply(user_id, connection_id, Op::Touch).await;
    }

    #[tracing::instrument(name = "presence.set_idle", skip_all, fields(user.id = user_id))]
    pub async fn set_idle(&self, user_id: i64, connection_id: u64, idle: bool) {
        let op = if idle { Op::Idle } else { Op::Active };
        self.apply(user_id, connection_id, op).await;
    }

    #[tracing::instrument(name = "presence.disconnected", skip_all, fields(user.id = user_id))]
    pub async fn disconnected(&self, user_id: i64, connection_id: u64) {
        self.apply(user_id, connection_id, Op::Drop).await;
    }

    #[tracing::instrument(name = "presence.get", skip_all, fields(user.id = me))]
    pub async fn get(&self, me: i64, user_ids: &[i64]) -> Result<Vec<(i64, Status)>, ApiError> {
        if user_ids.len() > MAX_PRESENCE_IDS {
            return Err(ApiError::bad_request(
                "too_many_ids",
                "at most 200 users per request",
            ));
        }

        let visible = self.audience(me).await?;

        let mut ids: Vec<i64> = user_ids
            .iter()
            .copied()
            .filter(|id| visible.contains(id))
            .collect();

        ids.sort_unstable();
        ids.dedup();

        let statuses = self
            .store
            .statuses(&ids)
            .await
            .map_err(|err| ApiError::Internal(err.context("presence store")))?;
        Ok(ids.into_iter().zip(statuses).collect())
    }

    async fn apply(&self, user_id: i64, connection_id: u64, op: Op) {
        match self.store.apply(user_id, connection_id, op).await {
            Ok(change) if change.changed() => self.announce(user_id, change).await,
            Ok(_) => {}
            Err(err) => tracing::warn!(error = %err, ?op, "presence store failed"),
        }
    }

    async fn announce(&self, user_id: i64, change: Change) {
        let mut receivers: Vec<i64> = match self.audience(user_id).await {
            Ok(set) => set.into_iter().collect(),
            Err(err) => {
                tracing::warn!(error = ?err, "presence push skipped: audience lookup failed");
                return;
            }
        };
        receivers.push(user_id);
        let envelope = Envelope {
            id: 0,
            payload: Some(Payload::PresenceUpdated(update(user_id, change.after))),
        };
        if let Err(err) = self
            .events
            .publish_to_users(&receivers, envelope.encode_to_vec().into())
            .await
        {
            tracing::warn!(error = %err, "presence push failed");
        }
    }

    async fn audience(&self, user_id: i64) -> Result<HashSet<i64>, ApiError> {
        audience(&*self.friends, &*self.conversations, user_id).await
    }
}

pub fn update(user_id: i64, status: Status) -> v1::PresenceUpdated {
    v1::PresenceUpdated {
        user_id: user_id as u64,
        status: v1::PresenceStatus::from(status) as i32,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::Duration;

    use async_trait::async_trait;
    use bytes::Bytes;
    use chrono::Utc;
    use futures::stream::BoxStream;

    use super::*;
    use crate::common::error::RepoError;
    use crate::features::conversations::models::{ConversationRecord, Kind};
    use crate::features::friends::models::{Friendship, FriendshipStatus, ordered_pair};
    use crate::features::presence::store::MemoryPresenceStore;

    const ANA: i64 = 10;
    const BOB: i64 = 20;
    const CAT: i64 = 30;
    const DAN: i64 = 40;

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
        async fn claim_group_nonce(
            &self,
            _: i64,
            _: &str,
            _: i64,
        ) -> Result<(i64, bool), RepoError> {
            unimplemented!()
        }
        async fn rename(&self, _: i64, _: &str) -> Result<(), RepoError> {
            unimplemented!()
        }
    }

    #[derive(Default)]
    struct FakeEvents {
        sent: Mutex<Vec<(Vec<i64>, i64, v1::PresenceStatus)>>,
    }

    #[async_trait]
    impl EventBus for FakeEvents {
        async fn publish_to_users(&self, user_ids: &[i64], payload: Bytes) -> anyhow::Result<()> {
            if let Some(Payload::PresenceUpdated(u)) = Envelope::decode(payload)?.payload {
                let mut to = user_ids.to_vec();
                to.sort_unstable();
                self.sent
                    .lock()
                    .unwrap()
                    .push((to, u.user_id as i64, u.status()));
            }
            Ok(())
        }
        async fn subscribe_user(&self, _: i64) -> anyhow::Result<BoxStream<'static, Bytes>> {
            unimplemented!()
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
        service: PresenceService,
        store: Arc<MemoryPresenceStore>,
        events: Arc<FakeEvents>,
    }

    impl Setup {
        fn take(&self) -> Vec<(Vec<i64>, i64, v1::PresenceStatus)> {
            std::mem::take(&mut *self.events.sent.lock().unwrap())
        }
    }

    fn setup() -> Setup {
        let store = Arc::new(MemoryPresenceStore::new(Duration::from_millis(90_000)));
        store.set_clock(1_000_000);
        let events = Arc::new(FakeEvents::default());
        let friends = FakeFriends(vec![
            friendship(ANA, BOB, FriendshipStatus::Accepted),
            friendship(DAN, ANA, FriendshipStatus::Pending),
        ]);
        let conversations = FakeConversations(vec![ConversationRecord {
            id: 1,
            kind: Kind::Dm,
            last_seq: 0,
            name: String::new(),
            member_ids: vec![ANA, CAT],
            last_message_at: 0,
        }]);
        let service = PresenceService::new(
            store.clone(),
            Arc::new(friends),
            Arc::new(conversations),
            events.clone(),
        );
        Setup {
            service,
            store,
            events,
        }
    }

    use v1::PresenceStatus as P;

    #[tokio::test]
    async fn connect_and_disconnect_push_to_friends_and_dm_members_only() {
        let t = setup();
        t.service.connected(ANA, 1).await;
        assert_eq!(t.take(), vec![(vec![ANA, BOB, CAT], ANA, P::Online)]);

        t.service.disconnected(ANA, 1).await;
        assert_eq!(t.take(), vec![(vec![ANA, BOB, CAT], ANA, P::Offline)]);
    }

    #[tokio::test]
    async fn second_device_keeps_user_online() {
        let t = setup();
        t.service.connected(ANA, 1).await;
        t.service.connected(ANA, 2).await;
        t.service.disconnected(ANA, 1).await;
        assert_eq!(t.take(), vec![(vec![ANA, BOB, CAT], ANA, P::Online)]);

        t.service.disconnected(ANA, 2).await;
        assert_eq!(t.take()[0].2, P::Offline);
    }

    #[tokio::test]
    async fn idle_only_when_every_device_is_idle() {
        let t = setup();
        t.service.connected(ANA, 1).await;
        t.service.connected(ANA, 2).await;
        t.take();

        t.service.set_idle(ANA, 1, true).await;
        assert!(t.take().is_empty(), "device 2 is still active");

        t.service.set_idle(ANA, 2, true).await;
        assert_eq!(t.take()[0].2, P::Idle);

        t.service.heartbeat(ANA, 2).await;
        assert!(t.take().is_empty());

        t.service.set_idle(ANA, 1, false).await;
        assert_eq!(t.take()[0].2, P::Online);

        t.service.disconnected(ANA, 1).await;
        assert_eq!(t.take()[0].2, P::Idle);
    }

    #[tokio::test]
    async fn missed_heartbeats_mean_offline() {
        let t = setup();
        t.service.connected(ANA, 1).await;
        t.take();

        t.store.set_clock(1_000_000 + 60_000);
        t.service.heartbeat(ANA, 1).await;
        assert!(t.take().is_empty());

        t.store.set_clock(1_000_000 + 60_000 + 91_000);
        let seen = t.service.get(BOB, &[ANA]).await.unwrap();
        assert_eq!(seen, vec![(ANA, Status::Offline)]);

        t.service.connected(ANA, 2).await;
        assert_eq!(t.take()[0].2, P::Online);
    }

    #[tokio::test]
    async fn get_only_returns_visible_users() {
        let t = setup();
        t.service.connected(BOB, 1).await;
        t.service.connected(DAN, 2).await;

        let seen = t.service.get(ANA, &[BOB, CAT, DAN, BOB]).await.unwrap();
        assert_eq!(seen, vec![(BOB, Status::Online), (CAT, Status::Offline)]);

        assert!(t.service.get(DAN, &[ANA]).await.unwrap().is_empty());

        let too_many: Vec<i64> = (0..=MAX_PRESENCE_IDS as i64).collect();
        assert!(t.service.get(ANA, &too_many).await.is_err());
    }
}
