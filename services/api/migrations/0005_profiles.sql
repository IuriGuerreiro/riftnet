-- User profiles: short bio and avatar. See docs/architecture/profiles.md.
--
-- avatar_hash is BLAKE3 of the 512px re-encoded avatar. The bytes live in the
-- S3 store under avatars/{user_id}/{hex hash}/{size}.webp and never expire;
-- the old files are deleted when the avatar is replaced or removed.

ALTER TABLE users
    ADD COLUMN bio         TEXT,
    ADD COLUMN avatar_hash BYTEA,
    ADD CONSTRAINT users_bio_len CHECK (char_length(bio) <= 190),
    ADD CONSTRAINT users_avatar_hash_len CHECK (octet_length(avatar_hash) = 32);
