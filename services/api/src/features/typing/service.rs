use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use protocol::Message as _;
use protocol::v1::{self, Envelope, envelope::Payload};

use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::conversations::repository::ConversationRepo;

pub const THROTTLE: Duration = Duration::from_secs(3);

pub const INGRESS_LIMIT: u32 = 10;
pub const INGRESS_WINDOW: Duration = Duration::from_secs(10);

pub struct TypingService {
    conversations: Arc<dyn ConversationRepo>,
    events: Arc<dyn EventBus>,
    last_sent: Mutex<HashMap<(i64, i64), Instant>>,
    ingress: Mutex<HashMap<i64, (Instant, u32)>>,
}

impl TypingService {
    pub fn new(conversations: Arc<dyn ConversationRepo>, events: Arc<dyn EventBus>) -> Self {
        Self {
            conversations,
            events,
            last_sent: Mutex::new(HashMap::new()),
            ingress: Mutex::new(HashMap::new()),
        }
    }

    #[tracing::instrument(name = "typing.start", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn start(&self, me: i64, conversation_id: i64) -> Result<(), ApiError> {
        self.start_at(me, conversation_id, Instant::now()).await
    }

    async fn start_at(&self, me: i64, conversation_id: i64, now: Instant) -> Result<(), ApiError> {
        if !self.ingress_allowed(me, now) {
            return Ok(());
        }
        let conversation = self
            .conversations
            .get(conversation_id)
            .await?
            .filter(|c| c.member_ids.contains(&me))
            .ok_or_else(|| {
                ApiError::bad_request("conversation_not_found", "conversation not found")
            })?;

        if !self.allow(me, conversation_id, now) {
            return Ok(());
        }

        let others: Vec<i64> = conversation
            .member_ids
            .into_iter()
            .filter(|id| *id != me)
            .collect();
        if others.is_empty() {
            return Ok(());
        }
        let env = Envelope {
            id: 0,
            payload: Some(Payload::TypingStarted(v1::TypingStarted {
                conversation_id: conversation_id as u64,
                user_id: me as u64,
            })),
        };
        if let Err(e) = self
            .events
            .publish_to_users(&others, Bytes::from(env.encode_to_vec()))
            .await
        {
            tracing::warn!(error = %e, "typing push failed");
        }
        Ok(())
    }

    fn ingress_allowed(&self, me: i64, now: Instant) -> bool {
        let mut ingress = self.ingress.lock().expect("typing mutex poisoned");
        if ingress.len() > 10_000 {
            ingress.retain(|_, (start, _)| now.saturating_duration_since(*start) < INGRESS_WINDOW);
        }
        let entry = ingress.entry(me).or_insert((now, 0));
        if now.saturating_duration_since(entry.0) >= INGRESS_WINDOW {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= INGRESS_LIMIT
    }

    fn allow(&self, me: i64, conversation_id: i64, now: Instant) -> bool {
        let mut last = self.last_sent.lock().expect("typing mutex poisoned");
        if last.len() > 10_000 {
            last.retain(|_, at| now.saturating_duration_since(*at) < THROTTLE);
        }
        match last.get(&(me, conversation_id)) {
            Some(at) if now.saturating_duration_since(*at) < THROTTLE => false,
            _ => {
                last.insert((me, conversation_id), now);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use futures::stream::BoxStream;

    use super::*;
    use crate::common::error::RepoError;
    use crate::features::conversations::models::{ConversationRecord, Kind};

    const ALICE: i64 = 1;
    const BOB: i64 = 2;
    const CAROL: i64 = 3;
    const MALLORY: i64 = 9;
    const DM: i64 = 100;
    const GROUP: i64 = 200;

    #[derive(Default)]
    struct FakeConversations {
        gets: std::sync::atomic::AtomicUsize,
    }
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
        async fn list_for_user(&self, _: i64) -> Result<Vec<ConversationRecord>, RepoError> {
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
        async fn get(&self, id: i64) -> Result<Option<ConversationRecord>, RepoError> {
            self.gets.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let (kind, member_ids) = match id {
                DM => (Kind::Dm, vec![ALICE, BOB]),
                GROUP => (Kind::Group, vec![ALICE, BOB, CAROL]),
                _ => return Ok(None),
            };
            Ok(Some(ConversationRecord {
                id,
                kind,
                last_seq: 0,
                name: String::new(),
                member_ids,
            }))
        }
        async fn next_seq(&self, _: i64) -> Result<i64, RepoError> {
            unimplemented!()
        }
    }

    #[derive(Default)]
    struct FakeEvents {
        sent: Mutex<Vec<(i64, u64, u64)>>,
    }
    #[async_trait]
    impl EventBus for FakeEvents {
        async fn publish_to_users(&self, user_ids: &[i64], payload: Bytes) -> anyhow::Result<()> {
            let Some(Payload::TypingStarted(t)) = Envelope::decode(payload)?.payload else {
                panic!("expected typing_started");
            };
            let mut sent = self.sent.lock().unwrap();
            sent.extend(user_ids.iter().map(|u| (*u, t.conversation_id, t.user_id)));
            Ok(())
        }
        async fn subscribe_user(&self, _: i64) -> anyhow::Result<BoxStream<'static, Bytes>> {
            unimplemented!()
        }
    }

    fn setup() -> (TypingService, Arc<FakeEvents>) {
        let (svc, events, _) = setup_with_repo();
        (svc, events)
    }

    fn setup_with_repo() -> (TypingService, Arc<FakeEvents>, Arc<FakeConversations>) {
        let events = Arc::new(FakeEvents::default());
        let repo = Arc::new(FakeConversations::default());
        (
            TypingService::new(repo.clone(), events.clone()),
            events,
            repo,
        )
    }

    fn gets(repo: &FakeConversations) -> usize {
        repo.gets.load(std::sync::atomic::Ordering::SeqCst)
    }

    fn sent(events: &FakeEvents) -> Vec<(i64, u64, u64)> {
        events.sent.lock().unwrap().clone()
    }

    #[tokio::test]
    async fn dm_pushes_to_the_other_member_only() {
        let (svc, events) = setup();
        svc.start_at(ALICE, DM, Instant::now()).await.unwrap();
        assert_eq!(sent(&events), [(BOB, DM as u64, ALICE as u64)]);
    }

    #[tokio::test]
    async fn group_pushes_to_every_other_member() {
        let (svc, events) = setup();
        svc.start_at(BOB, GROUP, Instant::now()).await.unwrap();
        let recipients: Vec<i64> = sent(&events).iter().map(|s| s.0).collect();
        assert_eq!(recipients, [ALICE, CAROL]);
    }

    #[tokio::test]
    async fn non_member_is_rejected_and_nothing_is_sent() {
        let (svc, events) = setup();
        let err = svc.start_at(MALLORY, DM, Instant::now()).await.unwrap_err();
        assert_eq!(err.describe().1, "conversation_not_found");
        let err = svc.start_at(ALICE, 999, Instant::now()).await.unwrap_err();
        assert_eq!(err.describe().1, "conversation_not_found");
        assert!(sent(&events).is_empty());
    }

    #[tokio::test]
    async fn repeats_within_throttle_are_dropped_then_allowed_again() {
        let (svc, events) = setup();
        let t0 = Instant::now();
        svc.start_at(ALICE, DM, t0).await.unwrap();
        svc.start_at(ALICE, DM, t0 + Duration::from_millis(500))
            .await
            .unwrap();
        svc.start_at(ALICE, DM, t0 + THROTTLE - Duration::from_millis(1))
            .await
            .unwrap();
        assert_eq!(sent(&events).len(), 1);

        svc.start_at(ALICE, DM, t0 + THROTTLE).await.unwrap();
        assert_eq!(sent(&events).len(), 2);
    }

    #[tokio::test]
    async fn throttle_is_per_user_and_per_conversation() {
        let (svc, events) = setup();
        let t0 = Instant::now();
        svc.start_at(ALICE, DM, t0).await.unwrap();
        svc.start_at(ALICE, GROUP, t0).await.unwrap();
        svc.start_at(BOB, DM, t0).await.unwrap();
        let typers: Vec<(u64, u64)> = sent(&events).iter().map(|s| (s.1, s.2)).collect();
        assert!(typers.contains(&(DM as u64, ALICE as u64)));
        assert!(typers.contains(&(GROUP as u64, ALICE as u64)));
        assert!(typers.contains(&(DM as u64, BOB as u64)));
    }

    #[tokio::test]
    async fn flood_is_cut_off_before_the_database() {
        let (svc, events, repo) = setup_with_repo();
        let t0 = Instant::now();
        for i in 0..100 {
            let _ = svc.start_at(MALLORY, 10_000 + i, t0).await;
        }
        assert_eq!(gets(&repo), INGRESS_LIMIT as usize);
        assert!(sent(&events).is_empty());

        let _ = svc.start_at(MALLORY, 10_000, t0 + INGRESS_WINDOW).await;
        assert_eq!(gets(&repo), INGRESS_LIMIT as usize + 1);
    }

    #[tokio::test]
    async fn ingress_limit_is_per_user() {
        let (svc, events, _) = setup_with_repo();
        let t0 = Instant::now();
        for i in 0..100 {
            let _ = svc.start_at(MALLORY, 10_000 + i, t0).await;
        }
        svc.start_at(ALICE, DM, t0).await.unwrap();
        assert_eq!(sent(&events), [(BOB, DM as u64, ALICE as u64)]);
    }
}
