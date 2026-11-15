-- Prefix search on usernames (`GET /users/search`). The query is a byte-order
-- range (`username ~>=~ 'mon' AND username ~<~ 'moo'`); `text_pattern_ops`
-- is the index type those operators use, whatever the database collation.
-- Usernames are stored lowercase, so no lower() is needed.
CREATE INDEX users_username_prefix_idx ON users (username text_pattern_ops);
