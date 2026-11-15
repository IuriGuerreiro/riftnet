use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;

use super::models::Call;

pub type Update = Box<dyn FnOnce(&mut Call) + Send>;

#[async_trait]
pub trait CallStore: Send + Sync {
    async fn get(&self, call_id: i64) -> Option<Call>;
    async fn insert_if_none(&self, call: Call) -> Result<Call, Call>;
    async fn update(&self, call_id: i64, change: Update) -> Option<Call>;
    async fn remove(&self, call_id: i64) -> Option<Call>;
    async fn with_device(&self, device_id: i64) -> Vec<Call>;
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

    async fn remove(&self, call_id: i64) -> Option<Call> {
        self.calls.lock().unwrap().remove(&call_id)
    }

    async fn with_device(&self, device_id: i64) -> Vec<Call> {
        let calls = self.calls.lock().unwrap();
        calls
            .values()
            .filter(|c| c.participants.iter().any(|p| p.device_id == device_id))
            .cloned()
            .collect()
    }
}
