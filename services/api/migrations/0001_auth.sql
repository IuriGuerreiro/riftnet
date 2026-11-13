-- Accounts, devices and refresh tokens. See docs/architecture/identity-auth.md.

CREATE TABLE users (
    id            BIGINT PRIMARY KEY,               -- Snowflake
    zitadel_id    TEXT NOT NULL UNIQUE,
    username      TEXT UNIQUE,                      -- NULL until picked
    display_name  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    id            BIGINT PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    platform      TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ
);
CREATE INDEX devices_user_id_idx ON devices (user_id);

CREATE TABLE refresh_tokens (
    id            BIGINT PRIMARY KEY,
    device_id     BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash    BYTEA NOT NULL UNIQUE,            -- SHA-256, never the token itself
    expires_at    TIMESTAMPTZ NOT NULL,
    used_at       TIMESTAMPTZ,                      -- set when rotated
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_device_id_idx ON refresh_tokens (device_id);
