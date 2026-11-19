CREATE TABLE server_invites (
    server_id BIGINT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE
);
