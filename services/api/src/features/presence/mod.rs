//! Presence: online / idle / offline.
//!
//! - `store.rs`: where live connections are kept (Redis; in memory for tests)
//! - `service.rs`: connect/disconnect/idle → push changes to friends and DM members
//!
//! No HTTP routes: everything goes through the gateway socket.
//! See docs/architecture/presence.md.

pub mod models;
pub mod service;
pub mod store;
