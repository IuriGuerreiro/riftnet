use protocol::v1::{self, envelope::Payload};

use crate::harness::*;

fn created(conversation_id: u64) -> impl FnMut(&Payload) -> Option<v1::Message> {
    move |p| match p {
        Payload::MessageCreated(m) => m
            .message
            .clone()
            .filter(|m| m.conversation_id == conversation_id),
        _ => None,
    }
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn send_acks_and_pushes_to_both_members() {
    let (a, b) = (seed_user().await, seed_user().await);
    let mut alice = Client::connect(&a).await;
    let mut bob = Client::connect(&b).await;
    let dm = open_dm(&mut alice, &b).await;
    assert_eq!(dm.kind, v1::ConversationKind::Dm as i32);

    let sent = send_text(&mut alice, dm.id, "hi bob").await;
    assert_eq!(sent.seq, 1);
    assert_eq!(sent.author_id, a.id as u64);

    for client in [&mut alice, &mut bob] {
        let got = client.push(created(dm.id)).await;
        assert_eq!(got.id, sent.id);
        assert_eq!(got.content, b"hi bob");
    }
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn same_nonce_returns_the_same_message() {
    let (a, b) = (seed_user().await, seed_user().await);
    let mut alice = Client::connect(&a).await;
    let mut bob = Client::connect(&b).await;
    let dm = open_dm(&mut alice, &b).await;
    let send = || {
        Payload::SendMessage(v1::SendMessage {
            conversation_id: dm.id,
            content: b"once".to_vec(),
            nonce: "fixed-nonce".into(),
            attachment_ids: vec![],
            reply_to: 0,
        })
    };
    let first = alice.request(send()).await;
    let second = alice.request(send()).await;
    let id = id_of;
    let id = id(first);
    assert_eq!(id, id_of(second));

    assert_eq!(bob.push(created(dm.id)).await.id, id);
    bob.no_push(created(dm.id)).await;

    let reply = alice
        .request(Payload::GetHistory(v1::GetHistory {
            conversation_id: dm.id,
            before_id: 0,
            limit: 10,
        }))
        .await;
    let Payload::History(history) = reply else {
        panic!("history failed: {reply:?}");
    };
    assert_eq!(
        history.messages.iter().map(|m| m.id).collect::<Vec<_>>(),
        [id]
    );
}

fn id_of(p: Payload) -> u64 {
    match p {
        Payload::MessageAck(ack) => ack.message.expect("message").id,
        other => panic!("send failed: {other:?}"),
    }
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn outsider_cannot_send_or_read() {
    let (a, b, e) = (seed_user().await, seed_user().await, seed_user().await);
    let mut alice = Client::connect(&a).await;
    let mut eve = Client::connect(&e).await;
    let dm = open_dm(&mut alice, &b).await;

    let reply = eve
        .request(Payload::SendMessage(v1::SendMessage {
            conversation_id: dm.id,
            content: b"sneaky".to_vec(),
            nonce: "n1".into(),
            attachment_ids: vec![],
            reply_to: 0,
        }))
        .await;
    assert_eq!(error_code(&reply), "conversation_not_found");

    let reply = eve
        .request(Payload::GetHistory(v1::GetHistory {
            conversation_id: dm.id,
            before_id: 0,
            limit: 10,
        }))
        .await;
    assert_eq!(error_code(&reply), "conversation_not_found");
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn history_pages_newest_first() {
    let (a, b) = (seed_user().await, seed_user().await);
    let mut alice = Client::connect(&a).await;
    let dm = open_dm(&mut alice, &b).await;
    for i in 1..=5 {
        send_text(&mut alice, dm.id, &format!("m{i}")).await;
    }

    let page = |before_id| {
        Payload::GetHistory(v1::GetHistory {
            conversation_id: dm.id,
            before_id,
            limit: 2,
        })
    };
    let seqs = |p: Payload| match p {
        Payload::History(h) => h.messages,
        other => panic!("history failed: {other:?}"),
    };

    let first = seqs(alice.request(page(0)).await);
    assert_eq!(first.iter().map(|m| m.seq).collect::<Vec<_>>(), [5, 4]);

    let second = seqs(alice.request(page(first[1].id)).await);
    assert_eq!(second.iter().map(|m| m.seq).collect::<Vec<_>>(), [3, 2]);
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn sync_after_reconnect_returns_missed_changes() {
    let (a, b) = (seed_user().await, seed_user().await);
    let mut alice = Client::connect(&a).await;
    let dm = open_dm(&mut alice, &b).await;
    let mut bob = Client::connect(&b).await;
    let m1 = send_text(&mut alice, dm.id, "one").await;
    let seen = bob.push(created(dm.id)).await.seq;
    assert_eq!(seen, m1.seq);
    bob.close().await;

    let m2 = send_text(&mut alice, dm.id, "two").await;
    let m3 = send_text(&mut alice, dm.id, "three").await;
    alice
        .request(Payload::EditMessage(v1::EditMessage {
            conversation_id: dm.id,
            message_id: m1.id,
            content: b"one (edited)".to_vec(),
        }))
        .await;
    alice
        .request(Payload::DeleteMessage(v1::DeleteMessage {
            conversation_id: dm.id,
            message_id: m2.id,
        }))
        .await;

    let mut bob = Client::connect(&b).await;
    let reply = bob
        .request(Payload::Sync(v1::Sync {
            conversation_id: dm.id,
            after_seq: seen,
        }))
        .await;
    let Payload::SyncResult(sync) = reply else {
        panic!("sync failed: {reply:?}");
    };
    assert!(sync.complete);
    assert_eq!(
        sync.messages.iter().map(|m| m.id).collect::<Vec<_>>(),
        [m3.id]
    );
    assert_eq!(sync.edited.len(), 1);
    assert_eq!(sync.edited[0].id, m1.id);
    assert_eq!(sync.edited[0].content, b"one (edited)");
    assert_eq!(sync.deleted_ids, [m2.id]);

    let again = bob
        .request(Payload::Sync(v1::Sync {
            conversation_id: dm.id,
            after_seq: sync.last_seq,
        }))
        .await;
    let Payload::SyncResult(again) = again else {
        panic!("sync failed: {again:?}");
    };
    assert!(again.complete);
    assert!(again.messages.is_empty());
    assert!(again.edited.is_empty());
    assert!(again.deleted_ids.is_empty());
    assert_eq!(again.last_seq, sync.last_seq);
}
