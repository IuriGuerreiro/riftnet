//! The client "brain". Used by the Tauri shell, tests, a CLI and (later) SDKs.
//! Must not depend on Tauri or any UI code.

use protocol::Message;
use protocol::v1::{Envelope, Ping, envelope::Payload};

/// Encodes a ping request. Placeholder until the WebSocket client lands.
pub fn encode_ping(id: u64) -> Vec<u8> {
    Envelope {
        id,
        payload: Some(Payload::Ping(Ping {})),
    }
    .encode_to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_roundtrip() {
        let env = Envelope::decode(encode_ping(42).as_slice()).unwrap();
        assert_eq!(env.id, 42);
        assert!(matches!(env.payload, Some(Payload::Ping(_))));
    }
}
