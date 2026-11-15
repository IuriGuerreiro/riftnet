//! Voice calls: ring, accept, join the SFU, leave.
//! The api only does call setup (signaling). Audio goes straight from the
//! client to the media server (`services/media`). See docs/architecture/calls.md.

pub mod media;
pub mod models;
pub mod proto;
pub mod service;
pub mod store;
