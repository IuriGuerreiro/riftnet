//! Messages: send, history, sync, edit, delete. Stored in Scylla, sent over the WebSocket.

pub mod models;
pub mod proto;
pub mod repository;
pub mod service;
