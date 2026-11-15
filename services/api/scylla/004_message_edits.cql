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
