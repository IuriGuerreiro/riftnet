-- Name color, status emoji, profile links and per-server nicknames.
-- See docs/architecture/profiles.md.

ALTER TABLE users
    ADD COLUMN name_color   INTEGER,
    ADD COLUMN status_emoji TEXT,
    ADD COLUMN links        TEXT[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT users_name_color_range CHECK (name_color BETWEEN 0 AND 16777215),
    ADD CONSTRAINT users_status_emoji_len CHECK (char_length(status_emoji) <= 16),
    ADD CONSTRAINT users_links_count CHECK (cardinality(links) <= 5);

ALTER TABLE server_members
    ADD COLUMN nickname TEXT,
    ADD CONSTRAINT server_members_nickname_len CHECK (char_length(nickname) BETWEEN 1 AND 32);
