//! Data access for conversations.
//!
//! - `conversation_repo.rs`: the `ConversationRepo` trait. Services only know this.
//! - `scylla_conversation_repo.rs`: the ScyllaDB implementation.
//! - `queries.rs`: the CQL text used by the Scylla implementation.
//!
//! A cache or an in-memory fake (for tests) would be another file here
//! implementing the same trait.

mod conversation_repo;
mod queries;
mod scylla_conversation_repo;

pub use conversation_repo::ConversationRepo;
pub use scylla_conversation_repo::ScyllaConversationRepo;
