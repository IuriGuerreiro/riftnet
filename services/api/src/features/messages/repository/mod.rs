//! Data access for messages.
//!
//! - `message_repo.rs`: the `MessageRepo` trait + its Scylla implementation.
//! - `scylla_message_repo.rs`: the Scylla struct, prepared statements, helpers.
//! - `queries.rs`: the CQL text.

mod message_repo;
mod queries;
mod scylla_message_repo;

pub use message_repo::MessageRepo;
pub use scylla_message_repo::ScyllaMessageRepo;
