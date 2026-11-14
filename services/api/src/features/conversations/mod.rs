//! Conversations: DMs (and later group DMs). Who is in what.
//! No HTTP routes: everything goes over the WebSocket (see `gateway`).

pub mod models;
pub mod proto;
pub mod repository;
pub mod service;
