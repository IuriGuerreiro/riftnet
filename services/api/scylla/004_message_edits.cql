-- Message edit + delete.
--
-- Scylla has no `ADD IF NOT EXISTS`: on later starts this fails with
-- "conflicts with an existing column", which the schema runner treats as done.
ALTER TABLE messages ADD edited_at bigint;  -- unix ms of the last edit, null = never

-- Every edit/delete takes a seq from the conversation (like a new message),
-- so sync can answer "what changed since seq N?". kind: 1 = edit, 2 = delete.
-- Known gap: one partition per conversation that grows forever. Bucket it later.
CREATE TABLE IF NOT EXISTS message_changes (
    conversation_id bigint,
    seq             bigint,
    message_id      bigint,
    kind            tinyint,
    PRIMARY KEY ((conversation_id), seq)
) WITH CLUSTERING ORDER BY (seq ASC);

-- Deleted message ids, kept a day (as long as message_nonces). A send retry
-- whose nonce points at a deleted message must not insert it again.
CREATE TABLE IF NOT EXISTS deleted_messages (
    conversation_id bigint,
    id              bigint,
    PRIMARY KEY ((conversation_id), id)
);
