use protocol::v1::{self, envelope::Payload};

use crate::harness::*;

async fn group_of_four() -> (Vec<TestUser>, Vec<Client>, v1::Conversation) {
    let mut users = Vec::new();
    for _ in 0..4 {
        users.push(seed_user().await);
    }
    let mut clients = Vec::new();
    for u in &users {
        clients.push(Client::connect(u).await);
    }
    let group = conversation(
        clients[0]
            .request(Payload::CreateGroup(v1::CreateGroup {
                name: "Crew".into(),
                usernames: users[1..3].iter().map(|u| u.username.clone()).collect(),
                nonce: String::new(),
            }))
            .await,
    );
    (users, clients, group)
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn create_pushes_to_members_only() {
    let (users, mut clients, group) = group_of_four().await;
    assert_eq!(group.kind, v1::ConversationKind::Group as i32);
    assert_eq!(group.name, "Crew");
    let mut expected: Vec<u64> = users[..3].iter().map(|u| u.id as u64).collect();
    expected.sort_unstable();
    assert_eq!(member_ids(&group), expected);

    for c in &mut clients[..3] {
        let pushed = c.push(conversation_update(group.id)).await;
        assert_eq!(member_ids(&pushed), expected);
    }
    clients[3].no_push(conversation_update(group.id)).await;
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn group_needs_three_to_five_people() {
    let (a, b) = (seed_user().await, seed_user().await);
    let mut alice = Client::connect(&a).await;
    let reply = alice
        .request(Payload::CreateGroup(v1::CreateGroup {
            name: "Too small".into(),
            usernames: vec![b.username.clone()],
            nonce: String::new(),
        }))
        .await;
    assert_eq!(error_code(&reply), "bad_group_size");
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn add_member_pushes_to_everyone_including_new_member() {
    let (users, mut clients, group) = group_of_four().await;
    for c in &mut clients[..3] {
        c.push(conversation_update(group.id)).await;
    }

    let updated = conversation(
        clients[1]
            .request(Payload::AddMember(v1::AddMember {
                conversation_id: group.id,
                username: users[3].username.clone(),
            }))
            .await,
    );
    assert_eq!(updated.members.len(), 4);

    for c in &mut clients {
        let pushed = c.push(conversation_update(group.id)).await;
        assert_eq!(pushed.members.len(), 4);
    }
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn leave_pushes_to_old_members_and_blocks_sending() {
    let (users, mut clients, group) = group_of_four().await;
    for c in &mut clients[..3] {
        c.push(conversation_update(group.id)).await;
    }

    let reply = clients[2]
        .request(Payload::LeaveGroup(v1::LeaveGroup {
            conversation_id: group.id,
        }))
        .await;
    assert!(matches!(reply, Payload::Conversation(_)), "{reply:?}");

    for c in &mut clients[..3] {
        let pushed = c.push(conversation_update(group.id)).await;
        assert!(!member_ids(&pushed).contains(&(users[2].id as u64)));
        assert_eq!(pushed.members.len(), 2);
    }
    clients[3].no_push(conversation_update(group.id)).await;

    let reply = clients[2]
        .request(Payload::SendMessage(v1::SendMessage {
            conversation_id: group.id,
            content: b"still here?".to_vec(),
            nonce: "n1".into(),
            attachment_ids: vec![],
            reply_to: 0,
        }))
        .await;
    assert_eq!(error_code(&reply), "conversation_not_found");
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn rename_pushes_new_name_and_outsiders_cannot_rename() {
    let (_, mut clients, group) = group_of_four().await;
    for c in &mut clients[..3] {
        c.push(conversation_update(group.id)).await;
    }

    let renamed = conversation(
        clients[1]
            .request(Payload::RenameGroup(v1::RenameGroup {
                conversation_id: group.id,
                name: "New name".into(),
            }))
            .await,
    );
    assert_eq!(renamed.name, "New name");
    for c in &mut clients[..3] {
        assert_eq!(c.push(conversation_update(group.id)).await.name, "New name");
    }

    let reply = clients[3]
        .request(Payload::RenameGroup(v1::RenameGroup {
            conversation_id: group.id,
            name: "Hijacked".into(),
        }))
        .await;
    assert_eq!(error_code(&reply), "conversation_not_found");
    clients[3].no_push(conversation_update(group.id)).await;
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn create_retry_with_same_nonce_returns_same_group() {
    let (a, b, c) = (seed_user().await, seed_user().await, seed_user().await);
    let mut alice = Client::connect(&a).await;
    let create = || {
        Payload::CreateGroup(v1::CreateGroup {
            name: "Retry".into(),
            usernames: vec![b.username.clone(), c.username.clone()],
            nonce: "group-nonce".into(),
        })
    };
    let first = conversation(alice.request(create()).await);
    let second = conversation(alice.request(create()).await);
    assert_eq!(first.id, second.id);

    let reply = alice
        .request(Payload::ListConversations(v1::ListConversations {}))
        .await;
    let Payload::Conversations(list) = reply else {
        panic!("list failed: {reply:?}");
    };
    let groups = list
        .conversations
        .iter()
        .filter(|c| c.name == "Retry")
        .count();
    assert_eq!(groups, 1);
}
