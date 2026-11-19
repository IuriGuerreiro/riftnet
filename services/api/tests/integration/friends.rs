use protocol::v1::{self, FriendState, envelope::Payload};
use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::harness::*;

fn friend_update(other: &TestUser) -> impl FnMut(&Payload) -> Option<FriendState> {
    let other_id = other.id as u64;
    move |p| match p {
        Payload::FriendUpdated(v1::FriendUpdated {
            user: Some(u),
            state,
        }) if u.id == other_id => FriendState::try_from(*state).ok(),
        _ => None,
    }
}

async fn request(http: &Http, from: &TestUser, to: &TestUser) -> reqwest::Response {
    http.post(from, "/friends/requests")
        .json(&json!({ "username": to.username }))
        .send()
        .await
        .expect("http")
}

async fn list(http: &Http, user: &TestUser) -> Value {
    let res = http.get(user, "/friends").send().await.expect("http");
    assert_eq!(res.status(), StatusCode::OK);
    res.json().await.expect("json")
}

fn ids(list: &Value, key: &str) -> Vec<i64> {
    list[key]
        .as_array()
        .expect("array")
        .iter()
        .map(|f| {
            f["user"]["id"].as_str().map_or_else(
                || f["user"]["id"].as_i64().expect("id"),
                |s| s.parse().expect("id"),
            )
        })
        .collect()
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn request_accept_remove_flow_with_pushes() {
    let http = Http::new();
    let (a, b) = (seed_user().await, seed_user().await);
    let mut alice = Client::connect(&a).await;
    let mut bob = Client::connect(&b).await;

    assert_eq!(request(&http, &a, &b).await.status(), StatusCode::OK);
    assert_eq!(alice.push(friend_update(&b)).await, FriendState::Outgoing);
    assert_eq!(bob.push(friend_update(&a)).await, FriendState::Incoming);
    assert_eq!(ids(&list(&http, &a).await, "outgoing"), [b.id]);
    assert_eq!(ids(&list(&http, &b).await, "incoming"), [a.id]);

    let res = http
        .post(&b, &format!("/friends/requests/{}/accept", a.id))
        .send()
        .await
        .expect("http");
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(alice.push(friend_update(&b)).await, FriendState::Friend);
    assert_eq!(bob.push(friend_update(&a)).await, FriendState::Friend);
    let (la, lb) = (list(&http, &a).await, list(&http, &b).await);
    assert_eq!(ids(&la, "friends"), [b.id]);
    assert_eq!(ids(&lb, "friends"), [a.id]);
    for l in [&la, &lb] {
        assert!(ids(l, "incoming").is_empty());
        assert!(ids(l, "outgoing").is_empty());
    }

    let res = http
        .delete(&a, &format!("/friends/{}", b.id))
        .send()
        .await
        .expect("http");
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert_eq!(alice.push(friend_update(&b)).await, FriendState::None);
    assert_eq!(bob.push(friend_update(&a)).await, FriendState::None);
    assert_nothing(&http, &a).await;
    assert_nothing(&http, &b).await;
}

async fn assert_nothing(http: &Http, user: &TestUser) {
    let l = list(http, user).await;
    for key in ["friends", "incoming", "outgoing"] {
        assert!(ids(&l, key).is_empty(), "{key} not empty: {l}");
    }
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn decline_clears_request_for_both() {
    let http = Http::new();
    let (a, b) = (seed_user().await, seed_user().await);
    let mut alice = Client::connect(&a).await;
    let mut bob = Client::connect(&b).await;

    request(&http, &a, &b).await;
    bob.push(friend_update(&a)).await;
    alice.push(friend_update(&b)).await;

    let res = http
        .delete(&b, &format!("/friends/requests/{}", a.id))
        .send()
        .await
        .expect("http");
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert_eq!(alice.push(friend_update(&b)).await, FriendState::None);
    assert_eq!(bob.push(friend_update(&a)).await, FriendState::None);
    assert_nothing(&http, &a).await;
    assert_nothing(&http, &b).await;
}

#[tokio::test]
#[ignore = "needs infra: docker compose up"]
async fn duplicate_self_and_unknown_requests_are_rejected() {
    let http = Http::new();
    let (a, b) = (seed_user().await, seed_user().await);

    assert_eq!(request(&http, &a, &b).await.status(), StatusCode::OK);
    assert_eq!(request(&http, &a, &b).await.status(), StatusCode::CONFLICT);
    assert!(request(&http, &a, &a).await.status().is_client_error());

    let res = http
        .post(&a, "/friends/requests")
        .json(&json!({ "username": "nobody_by_this_name" }))
        .send()
        .await
        .expect("http");
    assert!(res.status().is_client_error());

    let res = reqwest::Client::new()
        .get(format!("http://{}/friends", server().addr))
        .send()
        .await
        .expect("http");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}
