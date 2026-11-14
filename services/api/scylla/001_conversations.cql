-- Conversations (DMs, later group DMs). Run on every start: everything is IF NOT EXISTS.
--
-- Scylla has no JOINs and no UNIQUE, so there is one table per question we ask:
--   "what is conversation X?"          -> conversations
--   "which conversations am I in?"     -> conversations_by_user
--   "is there already a DM for A+B?"   -> dm_keys

CREATE TABLE IF NOT EXISTS conversations (
    id         bigint PRIMARY KEY,   -- Snowflake
    kind       tinyint,              -- 1 = DM, 2 = group (matches ConversationKind)
    members    list<bigint>,         -- user ids, in join order (max 5)
    last_seq   bigint,               -- seq of the newest message
    created_at timestamp
);

-- Partition = one user, so their whole DM list is one fast read.
-- Newest conversation first (Snowflakes sort by time).
CREATE TABLE IF NOT EXISTS conversations_by_user (
    user_id         bigint,
    conversation_id bigint,
    PRIMARY KEY (user_id, conversation_id)
) WITH CLUSTERING ORDER BY (conversation_id DESC);

-- "<smaller user id>:<bigger user id>" -> the one DM between them.
-- Written with IF NOT EXISTS (a lightweight transaction), which is our UNIQUE.
CREATE TABLE IF NOT EXISTS dm_keys (
    dm_key          text PRIMARY KEY,
    conversation_id bigint
);
