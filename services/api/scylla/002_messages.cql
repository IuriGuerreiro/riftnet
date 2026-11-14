-- Messages. One partition = one conversation's messages for ~10 days ("bucket"),
-- so a partition never grows forever, and "latest 50" is one fast read.

CREATE TABLE IF NOT EXISTS messages (
    conversation_id bigint,
    bucket          int,       -- snowflake time / 10 days (see messages/models.rs)
    id              bigint,    -- Snowflake: sorts by time
    seq             bigint,    -- 1, 2, 3... per conversation (for sync)
    author_id       bigint,
    content         blob,      -- opaque bytes: UTF-8 now, encrypted later
    encryption      tinyint,   -- 0 = none, 1 = MLS (matches Encryption in the proto)
    PRIMARY KEY ((conversation_id, bucket), id)
) WITH CLUSTERING ORDER BY (id DESC);

-- "Did this client already send this?" A retry with the same nonce gets the
-- same message back instead of a duplicate. Rows expire after a day.
CREATE TABLE IF NOT EXISTS message_nonces (
    conversation_id bigint,
    author_id       bigint,
    nonce           text,
    message_id      bigint,
    PRIMARY KEY ((conversation_id, author_id, nonce))
);
