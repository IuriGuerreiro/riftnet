ALTER TABLE users ADD COLUMN presence_version BIGINT NOT NULL DEFAULT 0;

CREATE TABLE presence_preference_updates (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    version BIGINT NOT NULL
);
