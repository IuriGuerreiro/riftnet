-- File attachments on a message: a copy of each file's details (id, name,
-- type, size, BLAKE3, expiry), so history and sync need no second lookup.
-- Each item is one encoded app.v1.Attachment. Written once, at send.
-- Postgres `attachments` tracks the upload and the cleanup.
ALTER TABLE messages ADD attachments list<blob>;
