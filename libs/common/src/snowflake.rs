use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const EPOCH_MS: u64 = 1_767_225_600_000;

pub struct Snowflake {
    machine_id: u64,
    state: Mutex<(u64, u64)>,
}

impl Snowflake {
    pub fn new(machine_id: u16) -> Self {
        assert!(machine_id < 1024, "machine_id must fit in 10 bits");
        Self {
            machine_id: machine_id as u64,
            state: Mutex::new((0, 0)),
        }
    }

    pub fn next_id(&self) -> u64 {
        let mut state = self.state.lock().expect("snowflake mutex poisoned");
        let mut now = now_ms();
        if now < state.0 {
            now = state.0;
        }
        if now == state.0 {
            state.1 = (state.1 + 1) & 0xFFF;
            if state.1 == 0 {
                while now <= state.0 {
                    now = now_ms();
                }
            }
        } else {
            state.1 = 0;
        }
        state.0 = now;
        ((now - EPOCH_MS) << 22) | (self.machine_id << 12) | state.1
    }
}

pub fn timestamp_ms(id: u64) -> u64 {
    (id >> 22) + EPOCH_MS
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before 1970")
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_increasing() {
        let ids = Snowflake::new(1);
        let mut last = 0;
        for _ in 0..10_000 {
            let id = ids.next_id();
            assert!(id > last);
            last = id;
        }
    }

    #[test]
    fn timestamp_roundtrip() {
        let id = Snowflake::new(7).next_id();
        assert!(timestamp_ms(id).abs_diff(now_ms()) < 1_000);
    }
}
