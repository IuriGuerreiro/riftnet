# Friends

Friend requests and friend lists. Postgres, HTTP actions, live pushes over the socket.

## Storage

One table, `friendships` (migration `0003_friends.sql`). One row per pair of users:

| Column         | Meaning                                       |
| -------------- | --------------------------------------------- |
| `user_low`     | the smaller user id of the pair               |
| `user_high`    | the bigger user id                            |
| `requester_id` | who sent the request                          |
| `status`       | `pending` (a request) or `accepted` (friends) |
| `created_at`   | when the request was sent                     |
| `accepted_at`  | when it was accepted                          |

- **Ordered pair:** A→B and B→A are the same row, so `PRIMARY KEY (user_low, user_high)` blocks duplicates, even with two clicks at once.
- `CHECK (user_low < user_high)` keeps the order and blocks friending yourself.
- Index on `user_high`; the primary key already covers `user_low`. "All my rows" = two index lookups.
- Decline, cancel and remove **delete** the row. No history.

## HTTP routes

All need `Authorization: Bearer <access token>`. User ids are strings in JSON.

| Route                                     | Does                              | Errors                                                                                                                |
| ----------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /friends`                            | `{ friends, incoming, outgoing }` |                                                                                                                       |
| `POST /friends/requests {username}`       | send a request                    | `user_not_found`, `cannot_friend_self`, `request_already_sent`, `already_friends`, `too_many_pending`, `rate_limited` |
| `POST /friends/requests/{user_id}/accept` | accept their request              | 404 if there's no request from them                                                                                   |
| `DELETE /friends/requests/{user_id}`      | decline theirs or cancel mine     | 404 if no pending request                                                                                             |
| `DELETE /friends/{user_id}`               | remove a friend                   | 404 if not friends                                                                                                    |

- Each entry: `{ user, state: "friend" | "incoming" | "outgoing", since }`.
- **Requesting back accepts:** if they already asked you, `POST /friends/requests` makes you friends.

**Why HTTP, not the socket:** friend actions are rare and simple request/response, like `/me`.
The socket is kept for things that need it: chat and live pushes.

## Live updates

Every change pushes `friend_updated {user, state}` (Envelope field 61, id 0) to **both** people,
on all their devices, through NATS `user.<id>`. `state` is from the receiver's side
(`NONE` after decline/cancel/remove), so clients just replace their entry.
Saved first, then pushed: a failed push is only logged; clients reload `GET /friends` on reconnect.

## Limits

- **20 requests per hour per user** (`RateLimiter` in the controller, in memory).
- **Max 100 pending outgoing** requests (checked in the service, counted in Postgres).

## DMs

DMs are **not** friends-only yet: anyone can `open_dm` by username. The plan is the
"who can DM you" setting in [dms.md](dms.md) (everyone / friends of friends / friends only).

## Test

- Unit: `cargo test -p api friends` (service with in-memory fakes).
- End to end: `API_HTTP=http://127.0.0.1:7100 pnpm --filter mock smoke:friends` (registers 3 users; register is limited to 5/min per IP).
