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

#[derive(Deserialize)]
pub struct ChannelNameBody {
    pub name: String,
}

#[derive(Deserialize, Default)]
pub struct MembersQuery {
    #[serde(default)]
    pub after_id: i64,
}

#[derive(Serialize)]
pub struct MemberDto {
    pub id: String,
    pub name: String,
    pub nickname: Option<String>,
    pub is_owner: bool,
}

#[derive(Deserialize)]
pub struct NicknameBody {
    pub nickname: String,
}

#[derive(Serialize)]
pub struct NicknameDto {
    pub nickname: Option<String>,
    pub name: String,
}

impl From<super::models::NicknameChange> for NicknameDto {
    fn from(change: super::models::NicknameChange) -> Self {
        Self {
            nickname: change.nickname,
            name: change.name,
        }
    }
}

#[derive(Serialize)]
pub struct MembersPage {
    pub members: Vec<MemberDto>,
    pub next_after_id: Option<String>,
}

impl From<Vec<super::models::ServerMember>> for MembersPage {
    fn from(mut rows: Vec<super::models::ServerMember>) -> Self {
        let has_more = rows.len() > 100;
        rows.truncate(100);
        let next_after_id = if has_more {
            rows.last().map(|row| row.id.to_string())
        } else {
            None
        };
        Self {
            next_after_id,
            members: rows
                .into_iter()
                .map(|row| MemberDto {
                    id: row.id.to_string(),
                    name: row.name,
                    nickname: row.nickname,
                    is_owner: row.is_owner,
                })
                .collect(),
        }
    }
}
