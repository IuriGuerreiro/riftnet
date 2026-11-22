CREATE TABLE notification_preferences (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    messages BOOLEAN NOT NULL DEFAULT TRUE,
    incoming_calls BOOLEAN NOT NULL DEFAULT TRUE,
    friend_requests BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE conversation_notification_preferences (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, conversation_id)
);

ALTER TABLE users
    ADD COLUMN custom_status TEXT,
    ADD COLUMN presence_preference TEXT NOT NULL DEFAULT 'online',
    ADD CONSTRAINT users_custom_status_len CHECK (char_length(custom_status) <= 128),
    ADD CONSTRAINT users_presence_preference CHECK (presence_preference IN ('online', 'idle', 'do_not_disturb', 'invisible'));
