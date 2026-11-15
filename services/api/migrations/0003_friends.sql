-- Friends and friend requests. See docs/architecture/friends.md.
--
-- One row per pair of users, smaller id first, so (A, B) and (B, A) are the
-- same row and the primary key alone blocks duplicates.
-- A request is a row with status 'pending'; accepting flips it to 'accepted'.
-- Decline, cancel and remove delete the row.

CREATE TABLE friendships (
    user_low      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requester_id  BIGINT NOT NULL,                  -- who sent the request
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at   TIMESTAMPTZ,

    PRIMARY KEY (user_low, user_high),
    CHECK (user_low < user_high),                   -- ordered pair, no self-friending
    CHECK (requester_id IN (user_low, user_high)),
    CHECK (status IN ('pending', 'accepted'))
);

-- The primary key already serves lookups by user_low; this serves user_high.
CREATE INDEX friendships_user_high_idx ON friendships (user_high);
