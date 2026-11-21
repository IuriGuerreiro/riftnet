-- Profile personalization: banner, accent color, pronouns.
-- See docs/architecture/profiles.md.
--
-- banner_hash works like avatar_hash: an upload id (BLAKE3 of image + nonce).
-- Bytes live at banners/{user_id}/{hex hash}/{width}.webp and never expire.
-- accent_color is 0xRRGGBB; the API speaks "#rrggbb".

ALTER TABLE users
    ADD COLUMN banner_hash  BYTEA,
    ADD COLUMN accent_color INTEGER,
    ADD COLUMN pronouns     TEXT,
    ADD CONSTRAINT users_banner_hash_len CHECK (octet_length(banner_hash) = 32),
    ADD CONSTRAINT users_accent_color_range CHECK (accent_color BETWEEN 0 AND 16777215),
    ADD CONSTRAINT users_pronouns_len CHECK (char_length(pronouns) <= 40);
