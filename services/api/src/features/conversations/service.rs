use std::collections::HashMap;
use std::sync::Arc;

use common::snowflake::Snowflake;

use protocol::Message as _;
use protocol::v1::{self, Envelope, envelope::Payload};

use super::models::{
    Conversation, ConversationRecord, Kind, MAX_GROUP_MEMBERS, MAX_GROUP_NAME_CHARS,
    MIN_GROUP_MEMBERS, ReadState, UNREAD_CAP,
};
use super::repository::{ConversationRepo, ReadStateRepo, UnreadCounter};
use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::calls::service::CallService;
use crate::features::users::models::User;
use crate::features::users::repository::UserRepo;
use crate::features::users::service::normalize_username;

const MAX_NONCE_LEN: usize = 64;

pub struct ConversationService {
    repo: Arc<dyn ConversationRepo>,
    reads: Arc<dyn ReadStateRepo>,
    unread: Arc<dyn UnreadCounter>,
    users: Arc<dyn UserRepo>,
    events: Arc<dyn EventBus>,
    ids: Arc<Snowflake>,
    calls: Arc<CallService>,
}

impl ConversationService {
    pub fn new(
        repo: Arc<dyn ConversationRepo>,
        reads: Arc<dyn ReadStateRepo>,
        unread: Arc<dyn UnreadCounter>,
        users: Arc<dyn UserRepo>,
        events: Arc<dyn EventBus>,
        ids: Arc<Snowflake>,
        calls: Arc<CallService>,
    ) -> Self {
        Self {
            repo,
            reads,
            unread,
            users,
            events,
            ids,
            calls,
        }
    }

    #[tracing::instrument(name = "conversations.open_dm", skip_all, fields(user.id = me))]
    pub async fn open_dm(&self, me: i64, username: &str) -> Result<Conversation, ApiError> {
        let other = self.find_user(username).await?;

        if other.id == me {
            return Err(ApiError::bad_request(
                "cannot_dm_self",
                "you can't DM yourself",
            ));
        }

        let record = self
            .repo
            .get_or_create_dm(self.ids.next_id() as i64, me, other.id)
            .await?;

        Ok(self.with_members(vec![record]).await?.remove(0))
    }

    #[tracing::instrument(name = "conversations.list", skip_all, fields(user.id = me))]
    pub async fn list(&self, me: i64) -> Result<Vec<Conversation>, ApiError> {
        let mut records = self.repo.list_for_user(me).await?;
        sort_newest_first(&mut records);

        let read_seqs = self.reads.list_read(me).await?;
        let reads = futures::future::try_join_all(records.iter().map(|r| {
            let last_read_seq = read_seqs.get(&r.id).copied().unwrap_or(0);
            self.read_state(r, last_read_seq)
        }))
        .await?;

        let mut conversations = self.with_members(records).await?;
        for (conversation, read) in conversations.iter_mut().zip(reads) {
            conversation.read = read;
        }
        Ok(conversations)
    }

    #[tracing::instrument(name = "conversations.mark_read", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn mark_read(
        &self,
        me: i64,
        conversation_id: i64,
        seq: i64,
    ) -> Result<ReadState, ApiError> {
        let conversation = self
            .repo
            .get(conversation_id)
            .await?
            .filter(|c| c.member_ids.contains(&me))
            .ok_or_else(not_found)?;

        let seq = seq.clamp(0, conversation.last_seq);
        self.reads.advance_read(me, conversation_id, seq).await?;

        let stored = self
            .reads
            .list_read(me)
            .await?
            .get(&conversation_id)
            .copied()
            .unwrap_or(seq);
        let state = self.read_state(&conversation, stored).await?;

        let push = Envelope {
            id: 0,
            payload: Some(Payload::ReadStateUpdated(v1::ReadStateUpdated {
                conversation_id: conversation_id as u64,
                last_read_seq: state.last_read_seq as u64,
                unread_count: state.unread_count,
            })),
        };
        // INVARIANT: only `me`. Sending this to other members would be a "seen" receipt.
        if let Err(err) = self
            .events
            .publish_to_users(&[me], push.encode_to_vec().into())
            .await
        {
            tracing::warn!(error = %err, "read state push failed");
        }
        Ok(state)
    }

    async fn read_state(
        &self,
        conversation: &ConversationRecord,
        last_read_seq: i64,
    ) -> Result<ReadState, ApiError> {
        let unread_count = self
            .unread
            .count_after(conversation, last_read_seq, UNREAD_CAP)
            .await?;
        Ok(ReadState {
            last_read_seq,
            unread_count,
        })
    }

    #[tracing::instrument(name = "conversations.create_group", skip_all, fields(user.id = me))]
    pub async fn create_group(
        &self,
        me: i64,
        name: &str,
        usernames: &[String],
        nonce: &str,
    ) -> Result<Conversation, ApiError> {
        let name = clean_group_name(name)?;
        if nonce.len() > MAX_NONCE_LEN {
            return Err(ApiError::bad_request(
                "bad_nonce",
                "nonce must be at most 64 characters",
            ));
        }

        let mut member_ids = vec![me];
        for username in usernames {
            let user = self.find_user(username).await?;
            if !member_ids.contains(&user.id) {
                member_ids.push(user.id);
            }
        }
        if !(MIN_GROUP_MEMBERS..=MAX_GROUP_MEMBERS).contains(&member_ids.len()) {
            return Err(ApiError::bad_request(
                "bad_group_size",
                "a group has 3 to 5 people, including you",
            ));
        }

        let mut id = self.ids.next_id() as i64;
        if !nonce.is_empty() {
            let (claimed, is_first_try) = self.repo.claim_group_nonce(me, nonce, id).await?;
            id = claimed;
            if !is_first_try && let Some(existing) = self.repo.get(id).await? {
                if !existing.member_ids.contains(&me) {
                    return Err(not_found());
                }
                return self.announce(&existing, &[]).await;
            }
        }

        let group = ConversationRecord {
            id,
            kind: Kind::Group,
            last_seq: 0,
            name,
            member_ids,
            last_message_at: chrono::Utc::now().timestamp_millis(),
        };
        self.repo.create_group(&group).await?;
        self.announce(&group, &group.member_ids).await
    }

    #[tracing::instrument(name = "conversations.add_member", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn add_member(
        &self,
        me: i64,
        conversation_id: i64,
        username: &str,
    ) -> Result<Conversation, ApiError> {
        let new_user = self.find_user(username).await?;

        loop {
            let group = self.member_group(me, conversation_id).await?;

            if group.member_ids.contains(&new_user.id) {
                return self.announce(&group, &[]).await;
            }

            if group.member_ids.len() >= MAX_GROUP_MEMBERS {
                return Err(ApiError::bad_request(
                    "group_full",
                    "a group has at most 5 people",
                ));
            }
            let mut new_members = group.member_ids.clone();
            new_members.push(new_user.id);

            if self
                .repo
                .set_members(conversation_id, &group.member_ids, &new_members)
                .await?
            {
                let group = ConversationRecord {
                    member_ids: new_members,
                    ..group
                };
                return self.announce(&group, &group.member_ids).await;
            }
        }
    }

    #[tracing::instrument(name = "conversations.leave_group", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn leave_group(&self, me: i64, conversation_id: i64) -> Result<(), ApiError> {
        loop {
            let Some(group) = self
                .repo
                .get(conversation_id)
                .await?
                .filter(|c| c.kind == Kind::Group)
            else {
                return Err(not_found());
            };
            if !group.member_ids.contains(&me) {
                return Ok(());
            }
            let new_members: Vec<i64> = group
                .member_ids
                .iter()
                .copied()
                .filter(|id| *id != me)
                .collect();

            let changed = self
                .repo
                .set_members(conversation_id, &group.member_ids, &new_members)
                .await;
            let left = match &changed {
                Ok(applied) => *applied,
                Err(_) => matches!(self.repo.get(conversation_id).await,
                    Ok(current) if current.as_ref().is_none_or(|c| !c.member_ids.contains(&me))),
            };
            if left {
                self.calls.member_left(conversation_id, me).await;
            }
            if changed? {
                let notify = group.member_ids.clone();
                let group = ConversationRecord {
                    member_ids: new_members,
                    ..group
                };
                self.announce(&group, &notify).await?;
                return Ok(());
            }
        }
    }

    #[tracing::instrument(name = "conversations.rename_group", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn rename_group(
        &self,
        me: i64,
        conversation_id: i64,
        name: &str,
    ) -> Result<Conversation, ApiError> {
        let name = clean_group_name(name)?;
        let group = self.member_group(me, conversation_id).await?;
        self.repo.rename(conversation_id, &name).await?;
        let group = ConversationRecord { name, ..group };
        self.announce(&group, &group.member_ids).await
    }

    async fn member_group(&self, me: i64, id: i64) -> Result<ConversationRecord, ApiError> {
        self.repo
            .get(id)
            .await?
            .filter(|c| c.kind == Kind::Group && c.member_ids.contains(&me))
            .ok_or_else(not_found)
    }

    async fn find_user(&self, username: &str) -> Result<User, ApiError> {
        let not_found = || ApiError::bad_request("user_not_found", "no user with that username");
        let username = normalize_username(username).map_err(|_| not_found())?;
        self.users
            .find_by_username(&username)
            .await?
            .ok_or_else(not_found)
    }

    async fn announce(
        &self,
        group: &ConversationRecord,
        notify: &[i64],
    ) -> Result<Conversation, ApiError> {
        let conversation = self.with_members(vec![group.clone()]).await?.remove(0);
        if !notify.is_empty() {
            let push = Envelope {
                id: 0,
                payload: Some(Payload::ConversationUpdated(v1::ConversationUpdated {
                    conversation: Some((&conversation).into()),
                })),
            };
            if let Err(err) = self
                .events
                .publish_to_users(notify, push.encode_to_vec().into())
                .await
            {
                tracing::warn!(error = %err, "conversation push failed");
            }
        }
        Ok(conversation)
    }

    async fn with_members(
        &self,
        records: Vec<ConversationRecord>,
    ) -> Result<Vec<Conversation>, ApiError> {
        let mut ids: Vec<i64> = records
            .iter()
            .flat_map(|r| r.member_ids.iter().copied())
            .collect();

        ids.sort_unstable();
        ids.dedup();
        let users: HashMap<i64, _> = self
            .users
            .find_by_ids(&ids)
            .await?
            .into_iter()
            .map(|u| (u.id, u))
            .collect();

        Ok(records
            .into_iter()
            .map(|r| Conversation {
                id: r.id,
                kind: r.kind,
                last_seq: r.last_seq,
                name: r.name,
                last_message_at: r.last_message_at,
                read: ReadState::default(),
                members: r
                    .member_ids
                    .iter()
                    .filter_map(|id| users.get(id).cloned())
                    .collect(),
            })
            .collect())
    }
}

fn not_found() -> ApiError {
    ApiError::bad_request("conversation_not_found", "conversation not found")
}

fn sort_newest_first(records: &mut [ConversationRecord]) {
    records.sort_by(|a, b| {
        b.last_message_at
            .cmp(&a.last_message_at)
            .then(b.id.cmp(&a.id))
    });
}

fn clean_group_name(raw: &str) -> Result<String, ApiError> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > MAX_GROUP_NAME_CHARS {
        return Err(ApiError::bad_request(
            "bad_group_name",
            "group name must be 1-100 characters",
        ));
    }
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use bytes::Bytes;
    use chrono::Utc;
    use futures::stream::BoxStream;

    use super::*;
    use crate::common::error::RepoError;

    const ANA: i64 = 1;
    const BOB: i64 = 2;
    const CAT: i64 = 3;

    #[derive(Default)]
    struct FakeRepo {
        rows: Mutex<HashMap<i64, ConversationRecord>>,
        nonces: Mutex<HashMap<(i64, String), i64>>,
    }

    #[async_trait]
    impl ConversationRepo for FakeRepo {
        async fn get_or_create_dm(
            &self,
            _: i64,
            _: i64,
            _: i64,
        ) -> Result<ConversationRecord, RepoError> {
            unimplemented!()
        }
        async fn list_for_user(&self, user: i64) -> Result<Vec<ConversationRecord>, RepoError> {
            let rows = self.rows.lock().unwrap();
            let mut out: Vec<_> = rows
                .values()
                .filter(|r| r.member_ids.contains(&user))
                .cloned()
                .collect();
            out.sort_by_key(|r| std::cmp::Reverse(r.id));
            Ok(out)
        }
        async fn get(&self, id: i64) -> Result<Option<ConversationRecord>, RepoError> {
            Ok(self.rows.lock().unwrap().get(&id).cloned())
        }
        async fn next_seq(&self, _: i64) -> Result<i64, RepoError> {
            unimplemented!()
        }
        async fn create_group(&self, group: &ConversationRecord) -> Result<(), RepoError> {
            self.rows.lock().unwrap().insert(group.id, group.clone());
            Ok(())
        }
        async fn set_members(
            &self,
            id: i64,
            expected: &[i64],
            new_members: &[i64],
        ) -> Result<bool, RepoError> {
            let mut rows = self.rows.lock().unwrap();
            let row = rows.get_mut(&id).unwrap();
            if row.member_ids != expected {
                return Ok(false);
            }
            row.member_ids = new_members.to_vec();
            Ok(true)
        }
        async fn rename(&self, id: i64, name: &str) -> Result<(), RepoError> {
            self.rows.lock().unwrap().get_mut(&id).unwrap().name = name.into();
            Ok(())
        }
        async fn claim_group_nonce(
            &self,
            user: i64,
            nonce: &str,
            new_id: i64,
        ) -> Result<(i64, bool), RepoError> {
            let mut nonces = self.nonces.lock().unwrap();
            match nonces.get(&(user, nonce.to_string())) {
                Some(id) => Ok((*id, false)),
                None => {
                    nonces.insert((user, nonce.to_string()), new_id);
                    Ok((new_id, true))
                }
            }
        }
    }

    #[derive(Default)]
    struct FakeReads(Mutex<HashMap<(i64, i64), i64>>);

    #[async_trait]
    impl ReadStateRepo for FakeReads {
        async fn list_read(&self, user: i64) -> Result<HashMap<i64, i64>, RepoError> {
            Ok(self
                .0
                .lock()
                .unwrap()
                .iter()
                .filter(|((u, _), _)| *u == user)
                .map(|((_, c), seq)| (*c, *seq))
                .collect())
        }
        async fn advance_read(&self, user: i64, conv: i64, seq: i64) -> Result<(), RepoError> {
            let mut map = self.0.lock().unwrap();
            let entry = map.entry((user, conv)).or_insert(seq);
            *entry = (*entry).max(seq);
            Ok(())
        }
    }

    struct FakeCounter;

    #[async_trait]
    impl UnreadCounter for FakeCounter {
        async fn count_after(
            &self,
            c: &ConversationRecord,
            after: i64,
            cap: u32,
        ) -> Result<u32, RepoError> {
            Ok(((c.last_seq - after).max(0) as u32).min(cap))
        }
    }

    struct FakeUsers;

    #[async_trait]
    impl UserRepo for FakeUsers {
        async fn find_by_email(&self, _: &str) -> Result<Option<User>, RepoError> {
            unimplemented!()
        }
        async fn remember_email(&self, _: i64, _: &str) -> Result<(), RepoError> {
            unimplemented!()
        }
        async fn find_by_id(&self, id: i64) -> Result<Option<User>, RepoError> {
            Ok(Some(user(id)))
        }
        async fn find_by_zitadel_id(&self, _: &str) -> Result<Option<User>, RepoError> {
            Ok(None)
        }
        async fn find_by_ids(&self, ids: &[i64]) -> Result<Vec<User>, RepoError> {
            Ok(ids.iter().map(|id| user(*id)).collect())
        }
        async fn find_by_username(&self, name: &str) -> Result<Option<User>, RepoError> {
            Ok([ANA, BOB, CAT]
                .into_iter()
                .map(user)
                .find(|u| u.username.as_deref() == Some(name)))
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
            _: Option<Option<&str>>,
            _: Option<Option<&str>>,
            _: Option<Option<&str>>,
        ) -> Result<Option<User>, RepoError> {
            unimplemented!()
        }
        async fn set_avatar(
            &self,
            _: i64,
            _: Option<&[u8]>,
        ) -> Result<Option<(User, Option<Vec<u8>>)>, RepoError> {
            unimplemented!()
        }
    }

    struct NoMedia;

    #[async_trait]
    impl crate::features::calls::media::MediaClient for NoMedia {
        async fn join(&self, _: i64, _: String) -> anyhow::Result<(u64, String)> {
            unimplemented!()
        }
        async fn leave(&self, _: u64) -> anyhow::Result<()> {
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeEvents(Mutex<Vec<(i64, Envelope)>>);

    #[async_trait]
    impl EventBus for FakeEvents {
        async fn publish_to_users(&self, ids: &[i64], payload: Bytes) -> anyhow::Result<()> {
            let envelope = Envelope::decode(payload)?;
            for id in ids {
                self.0.lock().unwrap().push((*id, envelope.clone()));
            }
            Ok(())
        }
        async fn subscribe_user(&self, _: i64) -> anyhow::Result<BoxStream<'static, Bytes>> {
            unimplemented!()
        }
    }

    fn user(id: i64) -> User {
        let name = match id {
            ANA => "ana",
            BOB => "bob",
            _ => "cat",
        };
        User {
            id,
            zitadel_id: format!("z{id}"),
            username: Some(name.into()),
            display_name: None,
            bio: None,
            custom_status: None,
            avatar_hash: None,
            created_at: Utc::now(),
        }
    }

    struct Setup {
        service: ConversationService,
        repo: Arc<FakeRepo>,
        events: Arc<FakeEvents>,
    }

    fn setup() -> Setup {
        let repo = Arc::new(FakeRepo::default());
        let events = Arc::new(FakeEvents::default());
        let service = ConversationService::new(
            repo.clone(),
            Arc::new(FakeReads::default()),
            Arc::new(FakeCounter),
            Arc::new(FakeUsers),
            events.clone(),
            Arc::new(Snowflake::new(1)),
            Arc::new(crate::features::calls::service::CallService::new(
                Arc::new(crate::features::calls::store::MemoryCallStore::default()),
                repo.clone(),
                Arc::new(NoMedia),
                events.clone(),
                Arc::new(Snowflake::new(1)),
            )),
        );
        Setup {
            service,
            repo,
            events,
        }
    }

    fn put(repo: &FakeRepo, id: i64, last_seq: i64, last_message_at: i64) {
        repo.rows.lock().unwrap().insert(
            id,
            ConversationRecord {
                id,
                kind: Kind::Dm,
                last_seq,
                name: String::new(),
                member_ids: vec![ANA, BOB],
                last_message_at,
            },
        );
    }

    fn names() -> Vec<String> {
        vec!["bob".into(), "cat".into()]
    }

    #[tokio::test]
    async fn list_is_newest_activity_first() {
        let t = setup();
        put(&t.repo, 100, 0, 5_000);
        put(&t.repo, 50, 3, 9_000);
        put(&t.repo, 70, 1, 7_000);

        let ids: Vec<i64> = t
            .service
            .list(ANA)
            .await
            .unwrap()
            .iter()
            .map(|c| c.id)
            .collect();
        assert_eq!(ids, vec![50, 70, 100]);
    }

    #[tokio::test]
    async fn unread_counts_and_mark_read_only_moves_forward() {
        let t = setup();
        put(&t.repo, 10, 30, 1);

        let list = t.service.list(ANA).await.unwrap();
        assert_eq!(list[0].read.unread_count, UNREAD_CAP);

        let state = t.service.mark_read(ANA, 10, 28).await.unwrap();
        assert_eq!(
            state,
            ReadState {
                last_read_seq: 28,
                unread_count: 2
            }
        );

        let state = t.service.mark_read(ANA, 10, 5).await.unwrap();
        assert_eq!(state.last_read_seq, 28);

        let state = t.service.mark_read(ANA, 10, 999).await.unwrap();
        assert_eq!(
            state,
            ReadState {
                last_read_seq: 30,
                unread_count: 0
            }
        );

        assert_eq!(
            t.service.list(BOB).await.unwrap()[0].read.unread_count,
            UNREAD_CAP
        );
    }

    #[tokio::test]
    async fn read_state_is_never_pushed_to_others() {
        let t = setup();
        put(&t.repo, 10, 4, 1);
        t.service.mark_read(ANA, 10, 4).await.unwrap();

        let pushes = t.events.0.lock().unwrap();
        assert!(!pushes.is_empty());
        assert!(pushes.iter().all(|(to, _)| *to == ANA));
    }

    #[tokio::test]
    async fn mark_read_needs_membership() {
        let t = setup();
        put(&t.repo, 10, 4, 1);
        assert!(t.service.mark_read(CAT, 10, 4).await.is_err());
    }

    #[tokio::test]
    async fn create_group_retry_with_same_nonce_returns_same_group() {
        let t = setup();
        let first = t
            .service
            .create_group(ANA, "g", &names(), "n1")
            .await
            .unwrap();
        let pushes_after_first = t.events.0.lock().unwrap().len();

        let again = t
            .service
            .create_group(ANA, "g", &names(), "n1")
            .await
            .unwrap();
        assert_eq!(again.id, first.id);
        assert_eq!(t.repo.rows.lock().unwrap().len(), 1);
        assert_eq!(t.events.0.lock().unwrap().len(), pushes_after_first);

        let other = t
            .service
            .create_group(ANA, "g", &names(), "n2")
            .await
            .unwrap();
        assert_ne!(other.id, first.id);
    }

    #[tokio::test]
    async fn create_group_rejects_long_nonce() {
        let t = setup();
        let long = "x".repeat(65);
        assert!(
            t.service
                .create_group(ANA, "g", &names(), &long)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn leave_twice_and_add_twice_are_fine() {
        let t = setup();
        let g = t
            .service
            .create_group(ANA, "g", &names(), "")
            .await
            .unwrap();

        t.service.leave_group(CAT, g.id).await.unwrap();
        t.service.leave_group(CAT, g.id).await.unwrap();

        t.service.add_member(ANA, g.id, "cat").await.unwrap();
        let again = t.service.add_member(ANA, g.id, "cat").await.unwrap();
        assert_eq!(again.members.len(), 3);

        t.service.rename_group(ANA, g.id, "new").await.unwrap();
        assert_eq!(
            t.service.rename_group(ANA, g.id, "new").await.unwrap().name,
            "new"
        );
    }

    #[tokio::test]
    async fn pushes_to_others_carry_no_read_state() {
        let t = setup();
        t.service
            .create_group(ANA, "g", &names(), "")
            .await
            .unwrap();
        for (_, env) in t.events.0.lock().unwrap().iter() {
            if let Some(Payload::ConversationUpdated(u)) = &env.payload {
                let c = u.conversation.as_ref().unwrap();
                assert_eq!((c.unread_count, c.last_read_seq), (0, 0));
            }
        }
    }
}
