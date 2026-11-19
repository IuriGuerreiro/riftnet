-- Emoji reactions. One row per (message, emoji, user).
-- Partition = one message, so reading a message's reactions is one query.
CREATE TABLE IF NOT EXISTS message_reactions (
    conversation_id bigint,
    message_id      bigint,
    emoji           text,
    user_id         bigint,
    PRIMARY KEY ((conversation_id, message_id), emoji, user_id)
);
