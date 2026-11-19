use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct CreateServer {
    pub name: String,
}

#[derive(Serialize)]
pub struct NamedResource {
    id: String,
    pub name: String,
}

impl NamedResource {
    fn new(id: i64, name: String) -> Self {
        Self {
            id: id.to_string(),
            name,
        }
    }
}

#[derive(Serialize)]
pub struct ServerSummaryDto {
    #[serde(flatten)]
    server: NamedResource,
    is_owner: bool,
}

#[derive(Serialize)]
pub struct ServerInvite {
    pub token: String,
}

#[derive(Deserialize)]
pub struct JoinServer {
    pub token: String,
}

#[derive(Serialize)]
pub struct CreatedServerDto {
    server: NamedResource,
    default_channel: NamedResource,
}

impl From<super::models::Server> for NamedResource {
    fn from(server: super::models::Server) -> Self {
        Self::new(server.id, server.name)
    }
}
impl From<super::models::ServerMembership> for ServerSummaryDto {
    fn from(value: super::models::ServerMembership) -> Self {
        Self {
            server: value.server.into(),
            is_owner: value.is_owner,
        }
    }
}
impl From<super::models::CreatedServer> for CreatedServerDto {
    fn from(value: super::models::CreatedServer) -> Self {
        Self {
            server: value.server.into(),
            default_channel: value.default_channel.into(),
        }
    }
}
