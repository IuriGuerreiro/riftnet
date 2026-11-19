-- Conversation list order, unread counts, retry-safe group create.
--
-- Scylla has no `ADD IF NOT EXISTS`: on later starts this fails with
-- "conflicts with an existing column", which the schema runner treats as done.
ALTER TABLE conversations ADD last_message_at bigint;  -- unix ms of the newest message, null = none yet

-- How far each user has read, per conversation. Private: only the owner reads it.
-- Partition = one user, so the whole list is one read.
CREATE TABLE IF NOT EXISTS read_states (
    user_id         bigint,
    conversation_id bigint,
    last_read_seq   bigint,
    PRIMARY KEY ((user_id), conversation_id)
);

-- "Did this client already create this group?" Same idea as message_nonces.
-- Rows are written with a 1-day TTL.
CREATE TABLE IF NOT EXISTS group_nonces (
    user_id         bigint,
    nonce           text,
    conversation_id bigint,
    PRIMARY KEY ((user_id, nonce))
);
