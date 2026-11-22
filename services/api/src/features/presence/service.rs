use std::collections::HashSet;
use std::sync::Arc;

use protocol::Message as _;
use protocol::v1::{self, Envelope, envelope::Payload};

use super::models::{Change, Snapshot};
use super::repository::{PreferenceRepository, SavedPreference};
use super::store::{Op, PresenceStore};
use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::conversations::repository::ConversationRepo;
use crate::features::friends::audience::audience;
use crate::features::friends::repository::FriendRepo;
use crate::features::settings::{PresencePreference, PresenceSettings};

pub const MAX_PRESENCE_IDS: usize = 200;

pub struct PresenceService {
    store: Arc<dyn PresenceStore>,
    preferences: Arc<dyn PreferenceRepository>,
    friends: Arc<dyn FriendRepo>,
    conversations: Arc<dyn ConversationRepo>,
    events: Arc<dyn EventBus>,
}

impl PresenceService {
    pub fn new(
        store: Arc<dyn PresenceStore>,
        preferences: Arc<dyn PreferenceRepository>,
        friends: Arc<dyn FriendRepo>,
        conversations: Arc<dyn ConversationRepo>,
        events: Arc<dyn EventBus>,
    ) -> Self {
        Self {
            store,
            preferences,
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
    pub async fn get(&self, me: i64, user_ids: &[i64]) -> Result<Vec<(i64, Snapshot)>, ApiError> {
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

        let mut statuses = self
            .store
            .snapshots(&ids)
            .await
            .map_err(|err| ApiError::Internal(err.context("presence store")))?;
        let missing: Vec<_> = ids
            .iter()
            .zip(&statuses)
            .filter_map(|(&id, s)| (!s.preference_loaded).then_some(id))
            .collect();
        if !missing.is_empty() {
            match self.preferences.get_many(&missing).await {
                Ok(preferences) => {
                    for preference in preferences {
                        let change = self
                            .store
                            .set_preference(&preference)
                            .await
                            .map_err(|e| ApiError::Internal(e.context("presence cache")))?;
                        if change.changed()
                            && let Err(err) = self.announce(preference.user_id, change).await
                        {
                            tracing::warn!(error = %err, "presence recovery announcement failed");
                        }
                    }
                    statuses = self
                        .store
                        .snapshots(&ids)
                        .await
                        .map_err(|e| ApiError::Internal(e.context("presence cache")))?;
                }
                Err(err) => {
                    tracing::warn!(error = ?err, "presence preferences unavailable; hiding uncached users")
                }
            }
        }
        Ok(ids.into_iter().zip(statuses).collect())
    }

    pub async fn set_activity(
        &self,
        user_id: i64,
        connection_id: u64,
        label: &str,
    ) -> Result<(), ApiError> {
        let label = label.trim();
        if label.len() > 100 || label.chars().any(char::is_control) {
            return Err(ApiError::bad_request(
                "invalid_activity",
                "Use at most 100 bytes without control characters",
            ));
        }
        self.store
            .set_activity(user_id, connection_id, label)
            .await
            .map_err(|err| ApiError::Internal(err.context("activity store")))
    }

    pub async fn require_visible_friend(&self, me: i64, friend: i64) -> Result<(), ApiError> {
        use crate::features::friends::models::FriendshipStatus;
        self.friends
            .find(me, friend)
            .await?
            .filter(|f| f.status == FriendshipStatus::Accepted)
            .ok_or(ApiError::NotFound)?;
        let visible = self.get(me, &[friend]).await?;
        if !visible
            .iter()
            .any(|(_, s)| s.status != super::models::Status::Offline)
        {
            return Err(ApiError::NotFound);
        }
        Ok(())
    }

    pub async fn friend_activities(
        &self,
        me: i64,
        user_ids: &[u64],
    ) -> Result<Vec<(i64, Vec<(u64, String)>)>, ApiError> {
        use crate::features::friends::models::FriendshipStatus;
        if user_ids.len() > MAX_PRESENCE_IDS {
            return Err(ApiError::bad_request(
                "too_many_ids",
                "at most 200 users per request",
            ));
        }
        let friends: HashSet<i64> = self
            .friends
            .list_for_user(me)
            .await?
            .iter()
            .filter(|f| f.status == FriendshipStatus::Accepted)
            .map(|f| f.other(me))
            .collect();
        let mut ids: Vec<i64> = user_ids
            .iter()
            .filter_map(|id| i64::try_from(*id).ok())
            .filter(|id| friends.contains(id))
            .collect();
        ids.sort_unstable();
        ids.dedup();
        let mut result = Vec::new();
        let visible = self.get(me, &ids).await?;
        for (id, snapshot) in visible {
            if snapshot.status == super::models::Status::Offline {
                continue;
            }
            let mut activities = self
                .store
                .activities(id)
                .await
                .map_err(|err| ApiError::Internal(err.context("activity store")))?;
            activities.sort_by_key(|(conn, _)| std::cmp::Reverse(*conn));
            result.push((id, activities));
        }
        Ok(result)
    }

    pub async fn preference(&self, user_id: i64) -> Result<PresenceSettings, ApiError> {
        let preferences = self.preferences.get_many(&[user_id]).await?;
        let saved = preferences.into_iter().next().ok_or(ApiError::NotFound)?;
        Ok(PresenceSettings {
            presence: saved.preference,
        })
    }

    pub async fn set_preference(
        self: &Arc<Self>,
        user_id: i64,
        preference: PresencePreference,
    ) -> Result<PresenceSettings, ApiError> {
        let service = self.clone();
        tokio::spawn(async move {
            let saved = service.preferences.set(user_id, preference).await?;
            service.publish_preference(&saved).await?;
            Ok(PresenceSettings {
                presence: preference,
            })
        })
        .await
        .map_err(|e| ApiError::Internal(e.into()))?
    }

    async fn publish_preference(&self, saved: &SavedPreference) -> Result<(), ApiError> {
        let change = self.store.set_preference(saved).await?;
        self.announce(saved.user_id, change).await?;
        self.preferences
            .acknowledge(saved.user_id, saved.version)
            .await?;
        Ok(())
    }

    async fn recover_pending(&self) -> Result<(), ApiError> {
        for saved in self.preferences.pending().await? {
            if let Err(err) = self.publish_preference(&saved).await {
                tracing::warn!(user_id = saved.user_id, error = ?err, "presence preference retry failed");
            }
        }
        Ok(())
    }

    pub fn spawn_recovery(self: &Arc<Self>, shutdown: Arc<crate::common::shutdown::Shutdown>) {
        let service = self.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(5));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    _ = shutdown.stopped() => break,
                    _ = tick.tick() => {
                        if let Err(err) = service.recover_pending().await {
                            tracing::warn!(error = ?err, "presence preference recovery failed");
                        }
                    }
                }
            }
        });
    }

    async fn apply(&self, user_id: i64, connection_id: u64, op: Op) {
        let result = async {
            let mut change = self.store.apply(user_id, connection_id, op).await?;
            if !change.preference_loaded {
                match self.preferences.get_many(&[user_id]).await {
                    Ok(preferences) => {
                        if let Some(preference) = preferences.first() { change = self.store.set_preference(preference).await?; }
                    }
                    Err(err) => tracing::warn!(error = ?err, "presence preference unavailable; keeping user hidden"),
                }
            }
            anyhow::Ok(change)
        }.await;
        match result {
            Ok(change) if change.changed() || !change.preference_loaded => {
                if let Err(err) = self.announce(user_id, change).await {
                    tracing::warn!(error = %err, "presence push failed");
                }
            }
            Ok(_) => {}
            Err(err) => tracing::warn!(error = %err, ?op, "presence store failed"),
        }
    }

    async fn announce(&self, user_id: i64, change: Change) -> anyhow::Result<()> {
        let mut receivers: Vec<i64> = self.audience(user_id).await?.into_iter().collect();
        receivers.push(user_id);
        let envelope = Envelope {
            id: 0,
            payload: Some(Payload::PresenceUpdated(update(
                user_id,
                Snapshot {
                    status: change.after,
                    revision: change.revision,
                    preference_loaded: change.preference_loaded,
                },
            ))),
        };
        self.events
            .publish_to_users(&receivers, envelope.encode_to_vec().into())
            .await?;
        Ok(())
    }

    async fn audience(&self, user_id: i64) -> Result<HashSet<i64>, ApiError> {
        audience(&*self.friends, &*self.conversations, user_id).await
    }
}

pub fn update(user_id: i64, snapshot: Snapshot) -> v1::PresenceUpdated {
    v1::PresenceUpdated {
        user_id: user_id as u64,
        status: v1::PresenceStatus::from(snapshot.status) as i32,
        revision: snapshot.revision,
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
    use crate::features::presence::models::Status;
    use crate::features::presence::store::MemoryPresenceStore;

    struct TestPreferences;
    #[async_trait]
    impl PreferenceRepository for TestPreferences {
        async fn pending(&self) -> Result<Vec<SavedPreference>, RepoError> {
            Ok(Vec::new())
        }
        async fn acknowledge(&self, _: i64, _: i64) -> Result<(), RepoError> {
            Ok(())
        }
        async fn get_many(&self, _: &[i64]) -> Result<Vec<SavedPreference>, RepoError> {
            Ok(Vec::new())
        }
        async fn set(
            &self,
            user_id: i64,
            preference: PresencePreference,
        ) -> Result<SavedPreference, RepoError> {
            Ok(SavedPreference {
                user_id,
                preference,
                version: 1,
            })
        }
    }

    const ANA: i64 = 10;
    const BOB: i64 = 20;
    const CAT: i64 = 30;
    const DAN: i64 = 40;

    struct FakeFriends(Vec<Friendship>);

    #[async_trait]
    impl FriendRepo for FakeFriends {
        async fn find(&self, a: i64, b: i64) -> Result<Option<Friendship>, RepoError> {
            let (low, high) = ordered_pair(a, b);
            Ok(self
                .0
                .iter()
                .find(|f| f.user_low == low && f.user_high == high)
                .cloned())
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
        published: tokio::sync::Notify,
        fail: std::sync::atomic::AtomicBool,
    }

    #[async_trait]
    impl EventBus for FakeEvents {
        async fn publish_to_users(&self, user_ids: &[i64], payload: Bytes) -> anyhow::Result<()> {
            if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
                anyhow::bail!("event bus unavailable");
            }
            if let Some(Payload::PresenceUpdated(u)) = Envelope::decode(payload)?.payload {
                let mut to = user_ids.to_vec();
                to.sort_unstable();
                self.sent
                    .lock()
                    .unwrap()
                    .push((to, u.user_id as i64, u.status()));
                self.published.notify_one();
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
            Arc::new(TestPreferences),
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

    #[tokio::test]
    async fn activity_is_opt_in_and_only_accepted_friends_can_read_it() {
        let t = setup();
        t.service.connected(ANA, 1).await;
        assert!(
            t.service
                .friend_activities(BOB, &[ANA as u64])
                .await
                .unwrap()[0]
                .1
                .is_empty()
        );
        t.service.set_activity(ANA, 1, " Minecraft ").await.unwrap();
        assert_eq!(
            t.service
                .friend_activities(BOB, &[ANA as u64])
                .await
                .unwrap(),
            vec![(ANA, vec![(1, "Minecraft".into())])]
        );
        for outsider in [CAT, DAN] {
            assert!(
                t.service
                    .friend_activities(outsider, &[ANA as u64])
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert!(
                t.service
                    .require_visible_friend(outsider, ANA)
                    .await
                    .is_err()
            );
        }
        assert!(t.service.require_visible_friend(BOB, ANA).await.is_ok());
        assert!(
            t.service
                .friend_activities(BOB, &vec![ANA as u64; 201])
                .await
                .is_err()
        );
        assert!(
            t.service
                .set_activity(ANA, 1, &"x".repeat(101))
                .await
                .is_err()
        );
        assert!(t.service.set_activity(ANA, 1, "bad\nlabel").await.is_err());
    }

    #[tokio::test]
    async fn activity_follows_connection_expiry_clear_and_disconnect() {
        let t = setup();
        t.service.connected(ANA, 1).await;
        t.service.connected(ANA, 2).await;
        t.service.set_activity(ANA, 1, "First").await.unwrap();
        t.service.set_activity(ANA, 2, "Second").await.unwrap();
        assert_eq!(
            t.service
                .friend_activities(BOB, &[ANA as u64])
                .await
                .unwrap()[0]
                .1[0]
                .1,
            "Second"
        );
        t.service.set_activity(ANA, 2, "").await.unwrap();
        assert_eq!(
            t.store.activities(ANA).await.unwrap(),
            vec![(1, "First".into())]
        );
        t.service.disconnected(ANA, 1).await;
        assert!(t.store.activities(ANA).await.unwrap().is_empty());
        t.service.set_activity(ANA, 2, "Second").await.unwrap();
        t.store.set_clock(1_100_000);
        assert!(t.store.activities(ANA).await.unwrap().is_empty());
        t.service.heartbeat(ANA, 2).await;
        assert!(
            t.store.activities(ANA).await.unwrap().is_empty(),
            "Expired activity must not return after a heartbeat"
        );
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
        let seen = t
            .service
            .get(BOB, &[ANA])
            .await
            .unwrap()
            .into_iter()
            .map(|(id, p)| (id, p.status))
            .collect::<Vec<_>>();
        assert_eq!(seen, vec![(ANA, Status::Offline)]);

        t.service.connected(ANA, 2).await;
        assert_eq!(t.take()[0].2, P::Online);
    }

    #[tokio::test]
    async fn get_only_returns_visible_users() {
        let t = setup();
        t.service.connected(BOB, 1).await;
        t.service.connected(DAN, 2).await;

        let seen = t
            .service
            .get(ANA, &[BOB, CAT, DAN, BOB])
            .await
            .unwrap()
            .into_iter()
            .map(|(id, p)| (id, p.status))
            .collect::<Vec<_>>();
        assert_eq!(seen, vec![(BOB, Status::Online), (CAT, Status::Offline)]);

        assert!(t.service.get(DAN, &[ANA]).await.unwrap().is_empty());

        let too_many: Vec<i64> = (0..=MAX_PRESENCE_IDS as i64).collect();
        assert!(t.service.get(ANA, &too_many).await.is_err());
    }
    #[derive(Default)]
    struct ControlledPreferences {
        reads: std::sync::atomic::AtomicUsize,
        pending: Mutex<Option<SavedPreference>>,
        fail_reads: std::sync::atomic::AtomicBool,
        entered: tokio::sync::Notify,
        release: tokio::sync::Notify,
    }

    #[async_trait]
    impl PreferenceRepository for ControlledPreferences {
        async fn pending(&self) -> Result<Vec<SavedPreference>, RepoError> {
            Ok(self.pending.lock().unwrap().clone().into_iter().collect())
        }
        async fn acknowledge(&self, _: i64, version: i64) -> Result<(), RepoError> {
            let mut pending = self.pending.lock().unwrap();
            if pending.as_ref().is_some_and(|p| p.version <= version) {
                *pending = None;
            }
            Ok(())
        }
        async fn get_many(&self, ids: &[i64]) -> Result<Vec<SavedPreference>, RepoError> {
            use std::sync::atomic::Ordering::SeqCst;
            self.reads.fetch_add(1, SeqCst);
            if self.fail_reads.load(SeqCst) {
                return Err(RepoError::Other(anyhow::anyhow!("Postgres unavailable")));
            }
            Ok(ids
                .iter()
                .map(|&user_id| SavedPreference {
                    user_id,
                    preference: PresencePreference::Online,
                    version: 0,
                })
                .collect())
        }
        async fn set(
            &self,
            user_id: i64,
            preference: PresencePreference,
        ) -> Result<SavedPreference, RepoError> {
            self.entered.notify_one();
            self.release.notified().await;
            let saved = SavedPreference {
                user_id,
                preference,
                version: 1,
            };
            *self.pending.lock().unwrap() = Some(saved.clone());
            Ok(saved)
        }
    }

    async fn redis_setup() -> (
        Arc<PresenceService>,
        Arc<super::super::store::RedisPresenceStore>,
        Arc<ControlledPreferences>,
        Arc<FakeEvents>,
        redis::aio::ConnectionManager,
        i64,
    ) {
        let url = std::env::var("REDIS_URL").unwrap_or("redis://127.0.0.1:6379".into());
        let redis = crate::common::redis::connect(&url).await.unwrap();
        let store = Arc::new(super::super::store::RedisPresenceStore::new(
            redis.clone(),
            Duration::from_secs(90),
        ));
        let preferences = Arc::new(ControlledPreferences::default());
        let t = setup();
        let service = Arc::new(PresenceService::new(
            store.clone(),
            preferences.clone(),
            t.service.friends.clone(),
            t.service.conversations.clone(),
            t.events.clone(),
        ));
        (
            service,
            store,
            preferences,
            t.events,
            redis,
            -(rand::random::<u32>() as i64) - 1,
        )
    }

    #[tokio::test]
    #[ignore = "needs Redis"]
    async fn warm_heartbeats_and_disconnects_keep_working_when_postgres_fails() {
        use std::sync::atomic::Ordering::SeqCst;
        let (service, store, preferences, _, mut redis, user) = redis_setup().await;
        service.connected(user, 1).await;
        assert_eq!(preferences.reads.load(SeqCst), 1);
        preferences.fail_reads.store(true, SeqCst);
        service.heartbeat(user, 1).await;
        service.set_idle(user, 1, true).await;
        assert_eq!(
            store.snapshots(&[user]).await.unwrap()[0].status,
            Status::Idle
        );
        service.set_idle(user, 1, false).await;
        service.disconnected(user, 1).await;
        assert_eq!(
            store.snapshots(&[user]).await.unwrap()[0].status,
            Status::Offline
        );
        assert_eq!(preferences.reads.load(SeqCst), 1);
        service.connected(user - 1, 2).await;
        let cold = store.snapshots(&[user - 1]).await.unwrap()[0];
        assert_eq!(cold.status, Status::Offline);
        assert!(!cold.preference_loaded);
        let recovered = store
            .set_preference(&SavedPreference {
                user_id: user - 1,
                preference: PresencePreference::Online,
                version: 0,
            })
            .await
            .unwrap();
        assert_eq!(recovered.after, Status::Online);
        redis::cmd("DEL")
            .arg(format!("presence:{user}"))
            .arg(format!("presence-preference:{user}"))
            .arg(format!("presence:{}", user - 1))
            .arg(format!("presence-preference:{}", user - 1))
            .query_async::<()>(&mut redis)
            .await
            .unwrap();
    }

    #[tokio::test]
    #[ignore = "needs Redis"]
    async fn cancelling_the_http_caller_does_not_cancel_preference_persistence_or_announcement() {
        let (service, store, preferences, events, mut redis, user) = redis_setup().await;
        service.connected(user, 1).await;
        events.published.notified().await;
        let caller = tokio::spawn({
            let service = service.clone();
            async move {
                service
                    .set_preference(user, PresencePreference::Invisible)
                    .await
            }
        });
        preferences.entered.notified().await;
        caller.abort();
        assert!(matches!(caller.await, Err(err) if err.is_cancelled()));
        preferences.release.notify_one();
        tokio::time::timeout(Duration::from_secs(5), events.published.notified())
            .await
            .unwrap();
        assert_eq!(
            store.snapshots(&[user]).await.unwrap()[0].status,
            Status::Offline
        );
        assert_eq!(events.sent.lock().unwrap().last().unwrap().2, P::Offline);
        redis::cmd("DEL")
            .arg(format!("presence:{user}"))
            .arg(format!("presence-preference:{user}"))
            .query_async::<()>(&mut redis)
            .await
            .unwrap();
    }
    #[tokio::test]
    #[ignore = "needs Redis"]
    async fn failed_announcements_remain_queued_and_recover_without_another_user_action() {
        use std::sync::atomic::Ordering::SeqCst;
        let (service, store, preferences, events, mut redis, user) = redis_setup().await;
        service.connected(user, 1).await;
        events.fail.store(true, SeqCst);
        preferences.release.notify_one();
        assert!(
            service
                .set_preference(user, PresencePreference::Invisible)
                .await
                .is_err()
        );
        assert_eq!(preferences.pending().await.unwrap().len(), 1);
        events.fail.store(false, SeqCst);
        service.recover_pending().await.unwrap();
        assert!(preferences.pending().await.unwrap().is_empty());
        assert_eq!(
            store.snapshots(&[user]).await.unwrap()[0].status,
            Status::Offline
        );
        assert_eq!(events.sent.lock().unwrap().last().unwrap().2, P::Offline);
        redis::cmd("DEL")
            .arg(format!("presence:{user}"))
            .arg(format!("presence-preference:{user}"))
            .query_async::<()>(&mut redis)
            .await
            .unwrap();
    }
}
