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
