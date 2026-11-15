//! Call logic: who may call, ringing, joining the SFU, ending.
//!
//! 1. `start`: creates the call, rings the other members (push `call_incoming`).
//! 2. `accept` / `decline`: the callee answers. Nobody in 30s → ended "missed".
//! 3. `join`: a device sends its WebRTC offer; we ask the media server for an answer.
//! 4. `leave` (or the socket closes): last device out ends the call.
//!
//! Every change is pushed to all members (`call_updated` / `call_ended`),
//! so all their devices stay in sync (e.g. stop ringing once one accepts).

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

    /// Starts a call in a conversation, or returns the one already going.
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
            Err(existing) => return Ok(existing), // already a call here: join that one
        };

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

        // Nobody answers in time → missed.
        let this = Arc::clone(self);
        let call_id = call.id;
        tokio::spawn(async move {
            tokio::time::sleep(RING_TIMEOUT).await;
            // Only if still ringing, checked in the same step as the removal:
            // an accept right now must win.
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
            .update(call_id, Box::new(|c| c.state = CallState::Active))
            .await
            .ok_or_else(not_found)?;
        self.push_updated(&call).await;
        Ok(call)
    }

    /// 1:1: declining a ringing call ends it. Declining an active call does nothing.
    #[tracing::instrument(name = "calls.decline", skip_all, fields(user.id = me, call.id = call_id))]
    pub async fn decline(&self, me: i64, call_id: i64) -> Result<Call, ApiError> {
        let call = self.member_call(me, call_id).await?;
        if call.caller_id != me {
            self.end_if(call_id, EndReason::Declined, Box::new(still_ringing))
                .await;
        }
        Ok(call)
    }

    /// Connects this device to the call's SFU. Returns the SDP answer.
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
        // Quick check (the store checks again atomically below).
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
        // The callee joining counts as accepting.
        let activate = call.caller_id != me;
        let call = match self
            .store
            .add_participant(call_id, participant, activate)
            .await
        {
            Ok(call) => call,
            Err(e) => {
                // Lost a race (other device got in first, or the call ended
                // meanwhile): free the media slot we just took.
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

    /// Takes this connection out of the call. Ends it if nobody is left to talk to.
    #[tracing::instrument(name = "calls.leave", skip_all, fields(user.id = me, call.id = call_id))]
    pub async fn leave(&self, me: i64, connection_id: u64, call_id: i64) -> Result<Call, ApiError> {
        self.member_call(me, call_id).await?;
        self.remove_connection(call_id, connection_id)
            .await
            .ok_or_else(not_found)
    }

    /// This connection started or stopped sharing its screen. Tells everyone.
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

    /// A WebSocket closed: take it out of every call. Other tabs of the same
    /// device are not touched.
    pub async fn connection_closed(&self, connection_id: u64) {
        for call in self.store.with_connection(connection_id).await {
            self.remove_connection(call.id, connection_id).await;
        }
    }

    async fn remove_connection(&self, call_id: i64, connection_id: u64) -> Option<Call> {
        let (tx, rx) = std::sync::mpsc::channel();
        let call = self
            .store
            .update(
                call_id,
                Box::new(move |c| {
                    // Hand back the device's peers so we can tell the media server.
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
        // Ends when nobody is left to talk to: the last person left, or the
        // call was answered and now only one person remains.
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

    /// Ends the call if `condition` still holds at removal time.
    async fn end_if(&self, call_id: i64, reason: EndReason, condition: super::store::Condition) {
        let Some(call) = self.store.remove_if(call_id, condition).await else {
            return;
        };
        for p in &call.participants {
            let _ = self.media.leave(p.peer_id).await;
        }
        tracing::info!(call.id = call_id, ?reason, "call ended");
        let ended = v1::CallEnded {
            call_id: call.id as u64,
            conversation_id: call.conversation_id as u64,
            reason: reason as i32,
        };
        self.push(&call.member_ids, Payload::CallEnded(ended)).await;
    }

    /// The call, if it exists and `me` is in its conversation.
    async fn member_call(&self, me: i64, call_id: i64) -> Result<Call, ApiError> {
        self.store
            .get(call_id)
            .await
            .filter(|c| c.member_ids.contains(&me))
            .ok_or_else(not_found)
    }

    async fn push_updated(&self, call: &Call) {
        let payload = Payload::CallUpdated(v1::CallUpdated {
            call: Some(call.into()),
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

    use async_trait::async_trait;
    use futures::stream::BoxStream;
    use protocol::Message as _;

    use super::*;
    use crate::common::error::RepoError;
    use crate::features::calls::store::{AddError, MemoryCallStore};
    use crate::features::conversations::models::{ConversationRecord, Kind};

    const ALICE: i64 = 1;
    const BOB: i64 = 2;
    const EVE: i64 = 3; // not in the DM
    const DM: i64 = 100;

    struct FakeConversations;
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
        async fn get(&self, id: i64) -> Result<Option<ConversationRecord>, RepoError> {
            Ok((id == DM).then(|| ConversationRecord {
                id,
                kind: Kind::Dm,
                last_seq: 0,
                member_ids: vec![ALICE, BOB],
            }))
        }
        async fn next_seq(&self, _: i64) -> Result<i64, RepoError> {
            unimplemented!()
        }
    }

    #[derive(Default)]
    struct FakeMedia {
        left: Mutex<Vec<u64>>,
    }
    #[async_trait]
    impl MediaClient for FakeMedia {
        async fn join(&self, room_id: i64, _: String) -> anyhow::Result<(u64, String)> {
            Ok((room_id as u64 + 1, "answer".into()))
        }
        async fn leave(&self, peer_id: u64) -> anyhow::Result<()> {
            self.left.lock().unwrap().push(peer_id);
            Ok(())
        }
    }

    /// Records every push as (user, payload kind).
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
        let events = Arc::new(FakeEvents::default());
        let media = Arc::new(FakeMedia::default());
        let svc = Arc::new(CallService::new(
            Arc::new(MemoryCallStore::default()),
            Arc::new(FakeConversations),
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
        // Bob's tablet (other device, other socket) tries to join too.
        let err = svc
            .join(BOB, 21, 21, call.id, "offer".into())
            .await
            .unwrap_err();
        assert_eq!(err.describe().1, "already_in_call");
        assert!(media.left.lock().unwrap().is_empty()); // quick check: never reached media
    }

    #[tokio::test]
    async fn store_rejects_second_device_even_if_quick_check_passed() {
        // Two devices racing: both pass the quick check, the store lets one in.
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
        svc.accept(BOB, call.id).await.unwrap(); // Bob's phone accepts
        svc.decline(BOB, call.id).await.unwrap(); // Bob's laptop (stale banner) declines
        assert!(!pushes(&events, ALICE).contains(&"ended".to_string()));
        assert!(svc.accept(BOB, call.id).await.is_ok()); // still there
    }

    #[tokio::test]
    async fn closing_another_tab_of_the_same_device_keeps_the_call() {
        let (svc, events, _) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.join(ALICE, 10, 100, call.id, "offer".into())
            .await
            .unwrap(); // tab A
        svc.join(BOB, 20, 20, call.id, "offer".into())
            .await
            .unwrap();
        svc.connection_closed(101).await; // tab B, same device 10, closes
        assert!(!pushes(&events, BOB).contains(&"ended".to_string()));
        svc.connection_closed(100).await; // tab A closes
        assert_eq!(pushes(&events, BOB).last().unwrap(), "ended");
    }

    #[tokio::test]
    async fn decline_ends_a_ringing_call() {
        let (svc, events, _) = setup();
        let call = svc.start(ALICE, DM).await.unwrap();
        svc.decline(BOB, call.id).await.unwrap();
        assert_eq!(pushes(&events, ALICE), ["ended"]);
        assert!(svc.accept(BOB, call.id).await.is_err()); // gone
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
        assert_eq!(media.left.lock().unwrap().len(), 2); // both peers freed
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
        // Bob's other socket (not joined) can't claim to share.
        assert!(svc.screen_share(BOB, 21, call.id, true).await.is_err());

        let before = pushes(&events, BOB).len();
        let call = svc.screen_share(ALICE, 10, call.id, true).await.unwrap();
        assert_eq!(call.sharing_user_ids(), [ALICE]);
        assert_eq!(pushes(&events, BOB).len(), before + 1); // Bob hears about it

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

        svc.connection_closed(10).await; // Alice's socket drops
        assert_eq!(pushes(&events, BOB).last().unwrap(), "ended");
    }
}
