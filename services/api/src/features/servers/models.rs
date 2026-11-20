pub struct Server {
    pub id: i64,
    pub name: String,
}

pub struct ServerMembership {
    pub server: Server,
    pub is_owner: bool,
}

pub struct CreatedServer {
    pub server: Server,
    pub default_channel: Server,
}

#[derive(sqlx::FromRow)]
pub struct ServerMember {
    pub id: i64,
    pub name: String,
    pub is_owner: bool,
}
pub enum ChannelWrite {
    Saved(Server),
    NotFound,
    LimitReached,
}

pub enum LeaveOutcome {
    Left,
    Owner,
    NotFound,
}
