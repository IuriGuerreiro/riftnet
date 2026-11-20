use protocol::v1::{self, envelope::Payload};
use serde_json::{Value, json};

use crate::harness::*;

async fn channel_send(client: &mut Client, channel_id: u64, text: &str) -> v1::ChannelMessage {
    match client
        .request(Payload::SendChannelMessage(v1::SendChannelMessage {
            channel_id,
            text: text.into(),
            nonce: text.into(),
        }))
        .await
    {
        Payload::ChannelMessage(message) => message,
        other => panic!("expected channel ack, got {other:?}"),
    }
}

fn channel_push(channel_id: u64) -> impl Fn(&Payload) -> Option<String> {
    move |payload| match payload {
        Payload::ChannelMessage(message) if message.channel_id == channel_id => {
            Some(message.text.clone())
        }
        _ => None,
    }
}

fn removal(server_id: u64) -> impl Fn(&Payload) -> Option<()> {
    move |payload| match payload {
        Payload::ServerRemoved(event) if event.server_id == server_id => Some(()),
        _ => None,
    }
}

async fn denied_channel(client: &mut Client, channel_id: u64) {
    let history = client
        .request(Payload::GetChannelHistory(v1::GetChannelHistory {
            channel_id,
            before_id: 0,
        }))
        .await;
    assert_eq!(error_code(&history), "not_found");
    let send = client
        .request(Payload::SendChannelMessage(v1::SendChannelMessage {
            channel_id,
            text: "denied".into(),
            nonce: "denied".into(),
        }))
        .await;
    assert_eq!(error_code(&send), "not_found");
}

#[tokio::test]
#[ignore = "needs local Postgres, Scylla, Redis, NATS and MinIO"]
async fn membership_removal_and_leave_revoke_open_connections() {
    let owner = seed_user().await;
    let member = seed_user().await;
    let outsider = seed_user().await;
    let http = Http::new();
    let created: Value = http
        .post(&owner, "/servers")
        .json(&json!({"name":"Membership test"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let server_id = created["server"]["id"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    let channel_id = created["default_channel"]["id"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    let base = format!("/servers/{server_id}");
    let invite: Value = http
        .post(&owner, &format!("{base}/invite"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let join = json!({"token":invite["token"]});
    http.post(&member, "/servers/join")
        .json(&join)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let mut owner_ws = Client::connect(&owner).await;
    let mut member_ws = Client::connect(&member).await;
    let mut member_other_ws = Client::connect(&member).await;
    let mut outsider_ws = Client::connect(&outsider).await;

    denied_channel(&mut outsider_ws, channel_id).await;
    assert_eq!(
        http.get(&outsider, &format!("{base}/channels"))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        http.get(&outsider, &format!("{base}/members"))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        http.delete(&member, &format!("{base}/members/{}", owner.id))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        http.delete(&outsider, &format!("{base}/members/{}", member.id))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        http.delete(&owner, &format!("{base}/members/{}", owner.id))
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let blocked = http
        .post(&owner, &format!("{base}/leave"))
        .send()
        .await
        .unwrap();
    assert_eq!(blocked.status(), 409);
    assert_eq!(
        blocked.json::<Value>().await.unwrap()["code"],
        "owner_cannot_leave"
    );

    channel_send(&mut owner_ws, channel_id, "before removal").await;
    assert_eq!(
        member_ws.push(channel_push(channel_id)).await,
        "before removal"
    );
    assert_eq!(
        member_other_ws.push(channel_push(channel_id)).await,
        "before removal"
    );
    outsider_ws.no_push(channel_push(channel_id)).await;
    http.delete(&owner, &format!("{base}/members/{}", member.id))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    member_ws.push(removal(server_id)).await;
    member_other_ws.push(removal(server_id)).await;

    channel_send(&mut owner_ws, channel_id, "after removal").await;
    member_ws.no_push(channel_push(channel_id)).await;
    member_other_ws.no_push(channel_push(channel_id)).await;
    denied_channel(&mut member_ws, channel_id).await;
    denied_channel(&mut member_other_ws, channel_id).await;
    assert_eq!(
        http.get(&member, &format!("{base}/channels"))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    let servers: Value = http
        .get(&member, "/servers")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(servers.as_array().unwrap().is_empty());

    http.post(&member, "/servers/join")
        .json(&join)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    channel_send(&mut owner_ws, channel_id, "rejoined").await;
    assert_eq!(member_ws.push(channel_push(channel_id)).await, "rejoined");
    assert_eq!(
        member_other_ws.push(channel_push(channel_id)).await,
        "rejoined"
    );
    http.post(&member, &format!("{base}/leave"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    member_ws.push(removal(server_id)).await;
    member_other_ws.push(removal(server_id)).await;
    channel_send(&mut owner_ws, channel_id, "after leaving").await;
    member_ws.no_push(channel_push(channel_id)).await;
    denied_channel(&mut member_ws, channel_id).await;

    http.post(&member, "/servers/join")
        .json(&join)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    http.delete(&owner, &format!("{base}/invite"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    http.post(&member, &format!("{base}/leave"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let revoked = http
        .post(&member, "/servers/join")
        .json(&join)
        .send()
        .await
        .unwrap();
    assert_eq!(revoked.status(), 400);
    assert_eq!(
        revoked.json::<Value>().await.unwrap()["code"],
        "invalid_invite"
    );

    let dm = open_dm(&mut owner_ws, &outsider).await;
    assert_eq!(
        send_text(&mut owner_ws, dm.id, "DM still works")
            .await
            .conversation_id,
        dm.id
    );
    owner_ws.close().await;
    member_ws.close().await;
    member_other_ws.close().await;
    outsider_ws.close().await;
}
