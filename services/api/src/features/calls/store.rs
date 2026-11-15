//! Where live calls are kept.
//!
//! In memory for now: correct only with ONE api server. With several, swap in
//! a Redis implementation of `CallStore` (the service won't change).
//! Calls are short-lived, so losing them on restart is OK: clients just call again.

use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;

use super::models::{Call, CallState, Participant};

pub type Update = Box<dyn FnOnce(&mut Call) + Send>;
pub type Condition = Box<dyn FnOnce(&Call) -> bool + Send>;

#[derive(Debug, PartialEq, Eq)]
pub enum AddError {
    NotFound,
    /// This user is already in the call (from another device or tab).
    AlreadyIn,
}

#[async_trait]
pub trait CallStore: Send + Sync {
    async fn get(&self, call_id: i64) -> Option<Call>;
    /// Saves `call`, unless the conversation already has one: then returns that one.
    async fn insert_if_none(&self, call: Call) -> Result<Call, Call>;
    /// Changes a call in place (atomically). Returns the new version.
    async fn update(&self, call_id: i64, change: Update) -> Option<Call>;
    /// Adds a participant, unless that user is already in. Check + add are one step,
    /// so two devices joining at the same moment can't both get in.
    /// `activate`: also mark the call as answered.
    async fn add_participant(
        &self,
        call_id: i64,
        p: Participant,
        activate: bool,
    ) -> Result<Call, AddError>;
    /// Removes the call only if `condition` holds (checked in the same step).
    async fn remove_if(&self, call_id: i64, condition: Condition) -> Option<Call>;
    /// Calls a WebSocket connection is in.
    async fn with_connection(&self, connection_id: u64) -> Vec<Call>;
}

#[derive(Default)]
pub struct MemoryCallStore {
    calls: Mutex<HashMap<i64, Call>>,
}

#[async_trait]
impl CallStore for MemoryCallStore {
    async fn get(&self, call_id: i64) -> Option<Call> {
        self.calls.lock().unwrap().get(&call_id).cloned()
    }

    async fn insert_if_none(&self, call: Call) -> Result<Call, Call> {
        let mut calls = self.calls.lock().unwrap();
        if let Some(existing) = calls
            .values()
            .find(|c| c.conversation_id == call.conversation_id)
        {
            return Err(existing.clone());
        }
        calls.insert(call.id, call.clone());
        Ok(call)
    }

    async fn update(&self, call_id: i64, change: Update) -> Option<Call> {
        let mut calls = self.calls.lock().unwrap();
        let call = calls.get_mut(&call_id)?;
        change(call);
        Some(call.clone())
    }

    async fn add_participant(
        &self,
        call_id: i64,
        p: Participant,
        activate: bool,
    ) -> Result<Call, AddError> {
        let mut calls = self.calls.lock().unwrap();
        let call = calls.get_mut(&call_id).ok_or(AddError::NotFound)?;
        if call.participants.iter().any(|x| x.user_id == p.user_id) {
            return Err(AddError::AlreadyIn);
        }
        call.participants.push(p);
        if activate {
            call.state = CallState::Active;
        }
        Ok(call.clone())
    }

    async fn remove_if(&self, call_id: i64, condition: Condition) -> Option<Call> {
        let mut calls = self.calls.lock().unwrap();
        if !condition(calls.get(&call_id)?) {
            return None;
        }
        calls.remove(&call_id)
    }

    async fn with_connection(&self, connection_id: u64) -> Vec<Call> {
        let calls = self.calls.lock().unwrap();
        calls
            .values()
            .filter(|c| {
                c.participants
                    .iter()
                    .any(|p| p.connection_id == connection_id)
            })
            .cloned()
            .collect()
    }
}
