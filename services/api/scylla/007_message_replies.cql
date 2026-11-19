-- Message replies: id of the message this one replies to (same conversation).
-- Null = not a reply. Kept as-is when the original is deleted; clients show
-- "original deleted". See 004 for why a rerun's "existing column" error is fine.
ALTER TABLE messages ADD reply_to bigint;
