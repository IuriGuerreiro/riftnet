-- File attachments. Bytes live in the S3 store (MinIO locally, R2 in prod);
-- this table tracks who uploaded what, where, and until when.
--
-- Upload flow: 'uploading' (chunks arrive) -> 'ready' (all chunks joined)
-- -> sent (message_id set by SendMessage). The message in Scylla keeps its
-- own copy of the file details, so loading messages never reads this table.
--
-- The cleanup job deletes expired rows, and uploads never sent within a day.
-- Deleting a message sets expires_at = now(), so its files go on the next run.

CREATE TABLE attachments (
    id               BIGINT PRIMARY KEY,            -- Snowflake
    conversation_id  BIGINT NOT NULL,               -- only its members can download
    uploader_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id       BIGINT,                        -- null until sent
    filename         TEXT NOT NULL,
    content_type     TEXT NOT NULL,
    size             BIGINT NOT NULL,
    chunk_size       INT NOT NULL,
    chunk_count      INT NOT NULL,
    object_key       TEXT NOT NULL,
    upload_id        TEXT NOT NULL,                 -- S3 multipart upload id
    blake3           BYTEA NOT NULL,                -- whole-file hash, from the uploader
    status           TEXT NOT NULL DEFAULT 'uploading',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,

    CHECK (status IN ('uploading', 'ready')),
    CHECK (size > 0),
    CHECK (octet_length(blake3) = 32)
);

CREATE INDEX attachments_expires_at_idx ON attachments (expires_at);
CREATE INDEX attachments_unsent_idx ON attachments (created_at) WHERE message_id IS NULL;
CREATE INDEX attachments_message_idx ON attachments (message_id) WHERE message_id IS NOT NULL;

-- One row per stored chunk. The server hashes every chunk itself (BLAKE3)
-- and only keeps it if it matches the hash the client sent.
CREATE TABLE attachment_chunks (
    attachment_id  BIGINT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    idx            INT NOT NULL,                    -- 0-based
    blake3         BYTEA NOT NULL,
    etag           TEXT NOT NULL,                   -- S3 part id, needed to join parts
    PRIMARY KEY (attachment_id, idx)
);
