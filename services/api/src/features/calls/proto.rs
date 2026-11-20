use protocol::v1;

use super::models::Call;

impl From<&Call> for v1::Call {
    fn from(c: &Call) -> Self {
        Self {
            id: c.id as u64,
            conversation_id: c.conversation_id as u64,
            caller_id: c.caller_id as u64,
            state: c.state as i32,
            participant_ids: c
                .participant_user_ids()
                .into_iter()
                .map(|id| id as u64)
                .collect(),
            sharing_user_ids: c
                .sharing_user_ids()
                .into_iter()
                .map(|id| id as u64)
                .collect(),
            controllable_user_ids: c
                .controllable_user_ids()
                .into_iter()
                .map(|id| id as u64)
                .collect(),
            control: c.control.map(|k| v1::CallControlState {
                host_id: k.host_id as u64,
                controller_id: k.controller_id as u64,
                granted: k.granted,
                grant_id: k.grant_id as u64,
            }),
        }
    }
}
