use std::sync::Arc;

use bytes::Bytes;
use common::snowflake::Snowflake;
use protocol::Message as _;
use protocol::v1::{self, Envelope, envelope::Payload};

use super::media::MediaClient;
use super::models::{Call, CallState, EndReason, Participant, RING_TIMEOUT};
use super::store::{AddError, CallStore};
use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::conversations::repository::ConversationRepo;

pub struct CallService {
    store: Arc<dyn CallStore>,
    conversations: Arc<dyn ConversationRepo>,
    media: Arc<dyn MediaClient>,
    events: Arc<dyn EventBus>,
    ids: Arc<Snowflake>,
}

impl CallService {
    pub fn new(
        store: Arc<dyn CallStore>,
        conversations: Arc<dyn ConversationRepo>,
        media: Arc<dyn MediaClient>,
        events: Arc<dyn EventBus>,
        ids: Arc<Snowflake>,
    ) -> Self {
        Self {
            store,
            conversations,
            media,
            events,
            ids,
        }
    }

    #[tracing::instrument(name = "calls.start", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn start(self: &Arc<Self>, me: i64, conversation_id: i64) -> Result<Call, ApiError> {
        let conversation = self
            .conversations
            .get(conversation_id)
            .await?
            .filter(|c| c.member_ids.contains(&me))
            .ok_or_else(|| {
                ApiError::bad_request("conversation_not_found", "conversation not found")
            })?;

        let call = Call {
            id: self.ids.next_id() as i64,
            conversation_id,
            caller_id: me,
            state: CallState::Ringing,
            member_ids: conversation.member_ids,
            participants: Vec::new(),
        };
        let call = match self.store.insert_if_none(call).await {
            Ok(new) => new,
            Err(existing) => return self.member_call(me, existing.id).await,
        };

        let current = self.conversations.get(conversation_id).await;
        if !matches!(&current, Ok(Some(group)) if group.member_ids == call.member_ids) {
            self.end(call.id, EndReason::Hangup).await;
            return Err(current.err().map_or_else(not_found, Into::into));
        }
        let call = self
            .store
            .get(call.id)
            .await
            .filter(|call| call.member_ids.contains(&me))
            .ok_or_else(not_found)?;

        let others: Vec<i64> = call
            .member_ids
            .iter()
            .copied()
            .filter(|id| *id != me)
            .collect();
        self.push(
            &others,
            Payload::CallIncoming(v1::CallIncoming {
                call: Some((&call).into()),
            }),
        )
        .await;

        let this = Arc::clone(self);
        let call_id = call.id;
        tokio::spawn(async move {
            tokio::time::sleep(RING_TIMEOUT).await;
            this.end_if(call_id, EndReason::Missed, Box::new(still_ringing))
                .await;
        });

        Ok(call)
    }

    #[tracing::instrument(name = "calls.accept", skip_all, fields(user.id = me, call.id = call_id))]
    pub async fn accept(&self, me: i64, call_id: i64) -> Result<Call, ApiError> {
        self.member_call(me, call_id).await?;
        let call = self
            .store
            .update(
                call_id,
                Box::new(move |c| {
                    if c.member_ids.contains(&me) {
                        c.state = CallState::Active;
                    }
                }),
            )
            .await
            .filter(|c| c.member_ids.contains(&me))
            .ok_or_else(not_found)?;
        self.push_updated(&call).await;
        Ok(call)
    }

    #[tracing::instrument(name = "calls.decline", skip_all, fields(user.id = me, call.id = call_id))]
    pub async fn decline(&self, me: i64, call_id: i64) -> Result<Call, ApiError> {
        let call = self.member_call(me, call_id).await?;
        if call.caller_id != me {
            self.end_if(
                call_id,
                EndReason::Declined,
                Box::new(move |c| still_ringing(c) && c.member_ids.contains(&me)),
            )
            .await;
        }
        Ok(call)
    }

    #[tracing::instrument(name = "calls.join", skip_all, fields(user.id = me, call.id = call_id))]
    pub async fn join(
        &self,
        me: i64,
        device_id: i64,
        connection_id: u64,
        call_id: i64,
        sdp_offer: String,
    ) -> Result<(Call, String), ApiError> {
        let call = self.member_call(me, call_id).await?;
        if call.participants.iter().any(|p| p.user_id == me) {
            return Err(already_in());
        }

        let (peer_id, answer) = self.media.join(call_id, sdp_offer).await.map_err(|e| {
            tracing::warn!(error = %e, "media join failed");
            ApiError::bad_request("media_unavailable", "could not connect to the media server")
        })?;

        let participant = Participant {
            user_id: me,
            device_id,
            connection_id,
            peer_id,
            sharing_screen: false,
        };
        let activate = call.caller_id != me;
        let call = match self
            .store
            .add_participant(call_id, participant, activate)
            .await
        {
            Ok(call) => call,
            Err(e) => {
                let _ = self.media.leave(peer_id).await;
                return Err(match e {
                    AddError::AlreadyIn => already_in(),
                    AddError::NotFound => not_found(),
                });
            }
        };
        self.push_updated(&call).await;
        Ok((call, answer))
    }

    #[tracing::instrument(name = "calls.leave", skip_all, fields(user.id = me, call.id = call_id))]
    pub async fn leave(&self, me: i64, connection_id: u64, call_id: i64) -> Result<Call, ApiError> {
        self.member_call(me, call_id).await?;
        self.remove_connection(call_id, connection_id)
            .await
            .ok_or_else(not_found)
    }

    #[tracing::instrument(name = "calls.screen_share", skip_all, fields(user.id = me, call.id = call_id, sharing))]
    pub async fn screen_share(
        &self,
        me: i64,
        connection_id: u64,
        call_id: i64,
        sharing: bool,
    ) -> Result<Call, ApiError> {
        let call = self.member_call(me, call_id).await?;
        if !call
            .participants
            .iter()
            .any(|p| p.connection_id == connection_id)
        {
            return Err(ApiError::bad_request(
                "not_joined",
                "this connection is not in the call",
            ));
        }
        let call = self
            .store
            .update(
                call_id,
                Box::new(move |c| {
                    for p in c
                        .participants
                        .iter_mut()
                        .filter(|p| p.connection_id == connection_id)
                    {
                        p.sharing_screen = sharing;
                    }
                }),
            )
            .await
            .ok_or_else(not_found)?;
        self.push_updated(&call).await;
        Ok(call)
    }

    pub async fn connection_closed(&self, connection_id: u64) {
        for call in self.store.with_connection(connection_id).await {
            self.remove_connection(call.id, connection_id).await;
        }
    }

    pub async fn member_left(&self, conversation_id: i64, user_id: i64) {
        let Some((call, participant)) = self.store.withdraw_member(conversation_id, user_id).await
        else {
            return;
        };
        let removed_participant = participant.is_some();
        if let Some(participant) = participant
            && let Err(error) = self.media.leave(participant.peer_id).await
        {
            tracing::warn!(%error, peer_id = participant.peer_id, "call peer removal failed");
        }

        self.push_ended(&call, &[user_id], EndReason::Hangup).await;
        self.end_if(
            call.id,
            EndReason::Hangup,
            Box::new(move |c| {
                c.member_ids.len() < 2
                    || (still_ringing(c) && !c.member_ids.contains(&c.caller_id))
                    || (removed_participant
                        && c.state == CallState::Active
                        && c.participants.len() < 2)
            }),
        )
        .await;
        self.push_updated(&call).await;
    }

    async fn remove_connection(&self, call_id: i64, connection_id: u64) -> Option<Call> {
        let (tx, rx) = std::sync::mpsc::channel();
        let call = self
            .store
            .update(
                call_id,
                Box::new(move |c| {
                    for p in c
                        .participants
                        .iter()
                        .filter(|p| p.connection_id == connection_id)
                    {
                        let _ = tx.send(p.peer_id);
                    }
                    c.participants.retain(|p| p.connection_id != connection_id);
                }),
            )
            .await?;
        let peers: Vec<u64> = rx.try_iter().collect();
        for peer_id in peers {
            let _ = self.media.leave(peer_id).await;
        }
        let alone = call.state == CallState::Active && call.participant_user_ids().len() < 2;
        if call.participants.is_empty() || alone {
            self.end(call_id, EndReason::Hangup).await;
        } else {
            self.push_updated(&call).await;
        }
        Some(call)
    }

    async fn end(&self, call_id: i64, reason: EndReason) {
        self.end_if(call_id, reason, Box::new(|_| true)).await;
    }

    async fn end_if(&self, call_id: i64, reason: EndReason, condition: super::store::Condition) {
        let Some(call) = self.store.remove_if(call_id, condition).await else {
            return;
        };
        for p in &call.participants {
            let _ = self.media.leave(p.peer_id).await;
        }
        tracing::info!(call.id = call_id, ?reason, "call ended");
        self.push_ended(&call, &call.member_ids, reason).await;
    }

    async fn push_ended(&self, call: &Call, user_ids: &[i64], reason: EndReason) {
        let ended = v1::CallEnded {
            call_id: call.id as u64,
            conversation_id: call.conversation_id as u64,
            reason: reason as i32,
        };
        self.push(user_ids, Payload::CallEnded(ended)).await;
    }

    async fn member_call(&self, me: i64, call_id: i64) -> Result<Call, ApiError> {
        let call = self
            .store
            .get(call_id)
            .await
            .filter(|c| c.member_ids.contains(&me))
            .ok_or_else(not_found)?;
        self.conversations
            .get(call.conversation_id)
            .await?
            .filter(|c| c.member_ids.contains(&me))
            .ok_or_else(not_found)?;
        Ok(call)
    }

    async fn push_updated(&self, call: &Call) {
        let Some(call) = self.store.get(call.id).await else {
            return;
        };
        let payload = Payload::CallUpdated(v1::CallUpdated {
            call: Some((&call).into()),
        });
        self.push(&call.member_ids, payload).await;
    }

    async fn push(&self, user_ids: &[i64], payload: Payload) {
        let env = Envelope {
            id: 0,
            payload: Some(payload),
        };
        let bytes = Bytes::from(env.encode_to_vec());
        if let Err(e) = self.events.publish_to_users(user_ids, bytes).await {
            tracing::warn!(error = %e, "call push failed");
        }
    }
}

fn still_ringing(c: &Call) -> bool {
    c.state == CallState::Ringing
}

fn already_in() -> ApiError {
    ApiError::conflict(
        "already_in_call",
        "you're already in this call on another device",
    )
}

fn not_found() -> ApiError {
    ApiError::bad_request("call_not_found", "call not found")
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU64, Ordering};

    use async_trait::async_trait;
    use futures::stream::BoxStream;

    use super::*;
    use crate::common::error::RepoError;
    use crate::features::calls::store::{AddError, MemoryCallStore};
    use crate::features::conversations::models::{ConversationRecord, Kind};

    const ALICE: i64 = 1;
    const BOB: i64 = 2;
    const EVE: i64 = 3;
    const DM: i64 = 100;

    struct FakeConversations(Vec<i64>);
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
        async fn get(&self, id: i64) -> Result<Option<ConversationRecord>, RepoError> {
            Ok((id == DM).then(|| ConversationRecord {
                id,
                kind: Kind::Dm,
                last_seq: 0,
                name: String::new(),
                member_ids: self.0.clone(),
                last_message_at: 0,
            }))
        }
        async fn next_seq(&self, _: i64) -> Result<i64, RepoError> {
            unimplemented!()
        }
    }

    #[derive(Default)]
    struct FakeMedia {
        next_peer: AtomicU64,
        left: Mutex<Vec<u64>>,
    }
    #[async_trait]
    impl MediaClient for FakeMedia {
        async fn join(&self, _: i64, _: String) -> anyhow::Result<(u64, String)> {
            let peer = self.next_peer.fetch_add(1, Ordering::Relaxed) + 1;
            Ok((peer, "answer".into()))
        }
        async fn leave(&self, peer_id: u64) -> anyhow::Result<()> {
            self.left.lock().unwrap().push(peer_id);
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeEvents {
        sent: Mutex<Vec<(i64, String)>>,
    }
    #[async_trait]
    impl EventBus for FakeEvents {
        async fn publish_to_users(&self, user_ids: &[i64], payload: Bytes) -> anyhow::Result<()> {
            let env = Envelope::decode(payload)?;
            let kind = match env.payload {
                Some(Payload::CallIncoming(_)) => "incoming",
                Some(Payload::CallUpdated(_)) => "updated",
                Some(Payload::CallEnded(_)) => "ended",
                _ => "other",
            };
            let mut sent = self.sent.lock().unwrap();
            sent.extend(user_ids.iter().map(|u| (*u, kind.to_string())));
            Ok(())
        }
        async fn subscribe_user(&self, _: i64) -> anyhow::Result<BoxStream<'static, Bytes>> {
            unimplemented!()
        }
    }

    fn setup() -> (Arc<CallService>, Arc<FakeEvents>, Arc<FakeMedia>) {
        setup_with_members(vec![ALICE, BOB])
    }

    fn setup_with_members(
        members: Vec<i64>,
    ) -> (Arc<CallService>, Arc<FakeEvents>, Arc<FakeMedia>) {
        let events = Arc::new(FakeEvents::default());
        let media = Arc::new(FakeMedia::default());
        let svc = Arc::new(CallService::new(
            Arc::new(MemoryCallStore::default()),
            Arc::new(FakeConversations(members)),
            media.clone(),
            events.clone(),
            Arc::new(Snowflake::new(1)),
        ));
        (svc, events, media)
    }

    fn test_call() -> Call {
        Call {
            id: 1,
            conversation_id: DM,
            caller_id: ALICE,
            state: CallState::Ringing,
            member_ids: vec![ALICE, BOB],
            participants: Vec::new(),
        }
    }

    fn pushes(events: &FakeEvents, user: i64) -> Vec<String> {
        let sent = events.sent.lock().unwrap();
        sent.iter()
            .filter(|(u, _)| *u == user)
            .map(|(_, k)| k.clone())
            .collect()
    }

    #[tokio::test]
    async fn start_rings_the_other_member_only() {
        let (svc, events, _) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        assert_eq!(call.state, CallState::Ringing);
        assert_eq!(pushes(&events, BOB), ["incoming"]);
        assert!(pushes(&events, ALICE).is_empty());
    }

    #[tokio::test]
    async fn starting_twice_returns_the_same_call() {
        let (svc, _, _) = setup();
        let a = svc.start(ALICE, DM).await.unwrap();
        let b = svc.start(BOB, DM).await.unwrap();
        assert_eq!(a.id, b.id);
    }

    #[tokio::test]
    async fn outsiders_cannot_start_or_join() {
        let (svc, _, _) = setup();
        assert!(svc.start(EVE, DM).await.is_err());
        let call = svc.start(ALICE, DM).await.unwrap();
        assert!(
            svc.join(EVE, 30, 30, call.id, "offer".into())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn stale_call_membership_does_not_authorize_accept() {
        let (svc, events, _) = setup_with_members(vec![ALICE]);
        let call = svc.store.insert_if_none(test_call()).await.unwrap();

        assert!(svc.accept(BOB, call.id).await.is_err());
        assert!(pushes(&events, ALICE).is_empty());
    }

    #[tokio::test]
    async fn callee_joining_makes_it_active() {
        let (svc, _, _) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.join(ALICE, 10, 10, call.id, "offer".into())
            .await
            .unwrap();
        let (call, answer) = svc
            .join(BOB, 20, 20, call.id, "offer".into())
            .await
            .unwrap();
        assert_eq!(answer, "answer");
        assert_eq!(call.state, CallState::Active);
        assert_eq!(call.participant_user_ids(), [ALICE, BOB]);
    }

    #[tokio::test]
    async fn one_audio_device_per_user() {
        let (svc, _, media) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.join(BOB, 20, 20, call.id, "offer".into())
            .await
            .unwrap();
        let err = svc
            .join(BOB, 21, 21, call.id, "offer".into())
            .await
            .unwrap_err();
        assert_eq!(err.describe().1, "already_in_call");
        assert!(media.left.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn store_rejects_second_device_even_if_quick_check_passed() {
        let store = MemoryCallStore::default();
        let mut call = test_call();
        call.participants.clear();
        let call = store.insert_if_none(call).await.unwrap();
        let p = |device: i64| Participant {
            user_id: BOB,
            device_id: device,
            connection_id: device as u64,
            peer_id: 1,
            sharing_screen: false,
        };
        assert!(store.add_participant(call.id, p(20), true).await.is_ok());
        assert_eq!(
            store
                .add_participant(call.id, p(21), true)
                .await
                .unwrap_err(),
            AddError::AlreadyIn
        );
    }

    #[tokio::test]
    async fn decline_after_accept_does_not_end_the_call() {
        let (svc, events, _) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.accept(BOB, call.id).await.unwrap();
        svc.decline(BOB, call.id).await.unwrap();
        assert!(!pushes(&events, ALICE).contains(&"ended".to_string()));
        assert!(svc.accept(BOB, call.id).await.is_ok());
    }

    #[tokio::test]
    async fn closing_another_tab_of_the_same_device_keeps_the_call() {
        let (svc, events, _) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.join(ALICE, 10, 100, call.id, "offer".into())
            .await
            .unwrap();
        svc.join(BOB, 20, 20, call.id, "offer".into())
            .await
            .unwrap();
        svc.connection_closed(101).await;
        assert!(!pushes(&events, BOB).contains(&"ended".to_string()));
        svc.connection_closed(100).await;
        assert_eq!(pushes(&events, BOB).last().unwrap(), "ended");
    }

    #[tokio::test]
    async fn decline_ends_a_ringing_call() {
        let (svc, events, _) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.decline(BOB, call.id).await.unwrap();
        assert_eq!(pushes(&events, ALICE), ["ended"]);
        assert!(svc.accept(BOB, call.id).await.is_err());
    }

    #[tokio::test]
    async fn hanging_up_ends_it_for_both_and_frees_media() {
        let (svc, events, media) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.join(ALICE, 10, 10, call.id, "offer".into())
            .await
            .unwrap();
        svc.join(BOB, 20, 20, call.id, "offer".into())
            .await
            .unwrap();

        svc.leave(BOB, 20, call.id).await.unwrap();
        assert_eq!(pushes(&events, ALICE).last().unwrap(), "ended");
        assert_eq!(media.left.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn departing_member_loses_media_and_call_updates() {
        let (svc, events, media) = setup_with_members(vec![ALICE, BOB, EVE]);
        let call = svc.start(ALICE, DM).await.unwrap();
        for user in [ALICE, BOB, EVE] {
            svc.join(user, user, user as u64, call.id, "offer".into())
                .await
                .unwrap();
        }

        svc.member_left(DM, EVE).await;
        svc.member_left(DM, EVE).await;

        assert_eq!(*media.left.lock().unwrap(), [3]);
        assert_eq!(pushes(&events, EVE).last().unwrap(), "ended");
        let departed_pushes = pushes(&events, EVE);
        let call = svc
            .screen_share(BOB, BOB as u64, call.id, true)
            .await
            .unwrap();
        assert_eq!(call.participant_user_ids(), [ALICE, BOB]);
        assert_eq!(pushes(&events, EVE), departed_pushes);
        assert_eq!(pushes(&events, BOB).last().unwrap(), "updated");
    }

    #[tokio::test]
    async fn screen_share_is_pushed_and_cleared_on_leave() {
        let (svc, events, _) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.join(ALICE, 10, 10, call.id, "offer".into())
            .await
            .unwrap();
        svc.join(BOB, 20, 20, call.id, "offer".into())
            .await
            .unwrap();
        assert!(svc.screen_share(BOB, 21, call.id, true).await.is_err());

        let before = pushes(&events, BOB).len();
        let call = svc.screen_share(ALICE, 10, call.id, true).await.unwrap();
        assert_eq!(call.sharing_user_ids(), [ALICE]);
        assert_eq!(pushes(&events, BOB).len(), before + 1);

        let call = svc.screen_share(ALICE, 10, call.id, false).await.unwrap();
        assert!(call.sharing_user_ids().is_empty());
    }

    #[tokio::test]
    async fn caller_alone_while_ringing_stays_until_they_leave() {
        let (svc, events, _) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.join(ALICE, 10, 10, call.id, "offer".into())
            .await
            .unwrap();
        assert!(!pushes(&events, BOB).contains(&"ended".to_string()));

        svc.connection_closed(10).await;
        assert_eq!(pushes(&events, BOB).last().unwrap(), "ended");
    }
}
