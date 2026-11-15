pub mod v1 {
    include!(concat!(env!("OUT_DIR"), "/app.v1.rs"));
}

pub use prost::Message;
