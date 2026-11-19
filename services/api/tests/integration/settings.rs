use protocol::v1::{self, envelope::Payload};
use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::harness::*;

const NOTIFICATIONS: &str = "/me/settings/notifications";
const PRESENCE: &str = "/me/settings/presence";

async fn read(http: &Http, user: &TestUser, path: &str) -> Value {
    let response = http.get(user, path).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response.json().await.unwrap()
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn preferences_persist_partial_updates_and_stay_private() {
    let http = Http::new();
    let a = seed_user().await;
    let b = seed_user().await;
    let defaults = json!({"messages": true, "incoming_calls": true, "friend_requests": true});
    assert_eq!(read(&http, &a, NOTIFICATIONS).await, defaults);
    let response = http
        .patch(&a, NOTIFICATIONS)
        .json(&json!({"messages": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = http
        .patch(&a, NOTIFICATIONS)
        .json(&json!({"incoming_calls": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read(&http, &a, NOTIFICATIONS).await,
        json!({"messages": false, "incoming_calls": false, "friend_requests": true})
    );
    assert_eq!(read(&http, &b, NOTIFICATIONS).await, defaults);
    assert_eq!(
        http.patch(&a, NOTIFICATIONS)
            .json(&json!({"messages": "false"}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        http.patch(&a, NOTIFICATIONS)
            .json(&json!({"unknown": false}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let response = reqwest::Client::new()
        .get(format!("http://{}{NOTIFICATIONS}", server().addr))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn conversation_mutes_require_membership_and_are_per_user() {
    let http = Http::new();
    let a = seed_user().await;
    let b = seed_user().await;
    let outsider = seed_user().await;
    let mut alice = Client::connect(&a).await;
    let dm = open_dm(&mut alice, &b).await;
    let path = format!("{NOTIFICATIONS}/conversations/{}", dm.id);
    assert_eq!(read(&http, &a, &path).await, json!({"muted": false}));
    for _ in 0..2 {
        assert_eq!(
            http.put(&a, &path)
                .json(&json!({"muted": true}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
    }
    assert_eq!(read(&http, &a, &path).await, json!({"muted": true}));
    assert_eq!(read(&http, &b, &path).await, json!({"muted": false}));
    assert_eq!(
        http.get(&outsider, &path).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        http.put(&outsider, &path)
            .json(&json!({"muted": true}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        http.put(&a, &path)
            .json(&json!({"muted": false}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(read(&http, &a, &path).await, json!({"muted": false}));
    alice.close().await;
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn custom_status_is_validated_saved_and_pushed() {
    let http = Http::new();
    let a = seed_user().await;
    let b = seed_user().await;
    let mut alice = Client::connect(&a).await;
    let _dm = open_dm(&mut alice, &b).await;
    let mut bob = Client::connect(&b).await;
    let response = http
        .patch(&a, "/me")
        .json(&json!({"custom_status": "  Building things  "}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read(&http, &a, "/me").await["custom_status"],
        "Building things"
    );
    let status = bob
        .push(|p| match p {
            Payload::UserUpdated(u) => u
                .user
                .as_ref()
                .filter(|u| u.id == a.id as u64)
                .map(|u| u.custom_status.clone()),
            _ => None,
        })
        .await;
    assert_eq!(status, "Building things");
    for invalid in ["x".repeat(129), "two\nlines".into()] {
        assert_eq!(
            http.patch(&a, "/me")
                .json(&json!({"custom_status": invalid}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        http.patch(&a, "/me")
            .json(&json!({"bio": "bio"}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        read(&http, &a, "/me").await["custom_status"],
        "Building things"
    );
    assert_eq!(
        http.patch(&a, "/me")
            .json(&json!({"custom_status": ""}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert!(read(&http, &a, "/me").await["custom_status"].is_null());
    alice.close().await;
    bob.close().await;
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn manual_presence_overrides_activity_and_survives_reconnect() {
    let http = Http::new();
    let a = seed_user().await;
    let b = seed_user().await;
    let mut alice = Client::connect(&a).await;
    open_dm(&mut alice, &b).await;
    let mut bob = Client::connect(&b).await;
    for (setting, expected) in [
        ("idle", v1::PresenceStatus::Idle),
        ("do_not_disturb", v1::PresenceStatus::DoNotDisturb),
        ("invisible", v1::PresenceStatus::Offline),
        ("online", v1::PresenceStatus::Online),
    ] {
        assert_eq!(
            http.put(&a, PRESENCE)
                .json(&json!({"presence": setting}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(read(&http, &a, PRESENCE).await["presence"], setting);
        let seen = bob
            .push(|p| match p {
                Payload::PresenceUpdated(u)
                    if u.user_id == a.id as u64 && u.status() == expected =>
                {
                    Some(u.status())
                }
                _ => None,
            })
            .await;
        assert_eq!(seen, expected);
    }
    assert_eq!(
        http.put(&a, PRESENCE)
            .json(&json!({"presence": "invisible"}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    alice.close().await;
    let mut alice = Client::connect(&a).await;
    assert_eq!(read(&http, &a, PRESENCE).await["presence"], "invisible");
    let result = bob
        .request(Payload::GetPresence(v1::GetPresence {
            user_ids: vec![a.id as u64],
        }))
        .await;
    let Payload::Presences(result) = result else {
        panic!("expected presences")
    };
    assert_eq!(result.presences[0].status(), v1::PresenceStatus::Offline);
    assert_eq!(
        http.put(&a, PRESENCE)
            .json(&json!({"presence": "invalid"}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    alice
        .request(Payload::SetIdle(v1::SetIdle { idle: false }))
        .await;
    let result = bob
        .request(Payload::GetPresence(v1::GetPresence {
            user_ids: vec![a.id as u64],
        }))
        .await;
    let Payload::Presences(result) = result else {
        panic!("expected presences")
    };
    assert_eq!(result.presences[0].status(), v1::PresenceStatus::Offline);
    alice.close().await;
    bob.close().await;
}
