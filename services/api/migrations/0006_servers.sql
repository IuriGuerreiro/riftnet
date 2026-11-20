CREATE TABLE servers (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100)
);

CREATE TABLE server_members (
    server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    PRIMARY KEY (server_id, user_id)
);

CREATE UNIQUE INDEX server_members_owner_idx ON server_members (server_id) WHERE role = 'owner';
CREATE INDEX server_members_user_idx ON server_members (user_id, server_id);

CREATE TABLE server_channels (
    id BIGINT PRIMARY KEY,
    server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    UNIQUE (server_id, name)
);

CREATE INDEX server_channels_server_idx ON server_channels (server_id, id);
