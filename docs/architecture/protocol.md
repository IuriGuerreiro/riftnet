# Protocol

## Two pipes

| Pipe      | Carries                                             | Format                    | Transport                |
| --------- | --------------------------------------------------- | ------------------------- | ------------------------ |
| **Data**  | chat, events, presence, API, call setup (signaling) | **Protobuf**              | WebSocket / HTTP         |
| **Media** | voice, video, screen                                | Opus / AV1 / H.264 in RTP | WebRTC (UDP, P2P or SFU) |

Protobuf is the "phone ringing". WebRTC is "the call".

## Why Protobuf

| Format                    | Pros                                                                   | Cons                      |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------- |
| JSON                      | Readable, everywhere                                                   | Bigger, slower, no schema |
| **Protobuf**              | Small, fast, **schema → SDK codegen in any language**, safe versioning | Not human-readable        |
| MessagePack               | Binary JSON, easy                                                      | No schema                 |
| FlatBuffers / Cap'n Proto | Fastest                                                                | Complex, weaker ecosystem |

- For chat, size barely matters (~200 bytes either way). The real wins are **CPU** and the **schema**.
- `.proto` files are public, so anyone can generate a client or bot in one command.
- Dev mode: dump messages as JSON for debugging.

## REST for requests, WebSocket for live stuff

- **REST (HTTP + JSON)** for normal request → reply calls: `/auth/*`, `/me`, `/users/search`, files later, `/health`, `/metrics`.
  Easy to test with `curl`, cacheable, no socket needed.
- **WebSocket (`/ws`)** for things that are live or stream: messaging, chat sync on reconnect, pushes
  (`message_created`, presence), and later call signaling / streaming. Audio and video media itself goes over WebRTC.
- Rule of thumb: if the server never needs to push to you about it, it's REST.
- `/ws` is only the door: after the upgrade (HTTP `101`) there are no routes, just frames.
  A `match` on the payload type picks the handler (`features/gateway/handlers.rs`).

### REST endpoints

| Method + path                      | Reply                            | Notes                                                   |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------- |
| `GET /me`                          | `{id, username, display_name}`   |                                                         |
| `PUT /me/username {username}`      | `{id, username, display_name}`   | `409 username_taken`                                    |
| `GET /users/search?q=mon&limit=20` | `[{id, username, display_name}]` | prefix match, case-insensitive, excludes you; see below |

**User search:** `q` is 1–32 chars (letters, numbers, `_`, `.`), else `400 invalid_query`.
`limit` defaults to 20, max 50. Sorted by username. Users without a username never show up.
Never returns email. Rate limited to 30 per 10s per user (`429`). Uses the `users_username_prefix_idx` index.

### Frames

- Every WebSocket message is **one binary protobuf `Envelope`** (`proto/v1/envelope.proto`).
- An `Envelope` has an `id` and exactly one payload (`oneof`).
- **Request → reply:** the client numbers its requests (1, 2, 3…); the reply carries the **same `id`**.
  Replies can arrive in any order, so the client keeps a map `id → waiting promise`.
- **Push:** `id = 0`. The server tells you something happened (e.g. `message_created`).
- **Errors:** an `error { code, message }` frame with the request's `id`. Same codes as HTTP (`user_not_found`, …).

### Connecting

```mermaid
sequenceDiagram
    participant App
    participant API as api
    App->>API: POST /auth/login → access token (HTTP)
    App->>API: GET /ws (Upgrade: websocket)
    API-->>App: 101 Switching Protocols
    App->>API: {id: 1, authenticate {access_token}}
    alt token ok
        API-->>App: {id: 1, auth_ok {user}}
        Note over App,API: socket now belongs to (user, device)
    else bad / missing / 10s timeout
        API-->>App: {id: 0, error {invalid_token}}
        API-->>App: close 4001
    end
```

- **The first frame must be `authenticate`.** Browsers can't set headers on a WebSocket, so the token goes in a frame.
- Close code **4001** = not authenticated. The client does not retry it; any other close → reconnect after 1s, 2s, 4s… (max 30s).
- After auth, the socket remembers `(user_id, device_id)`; later frames don't carry the token.
- Known gap: an open socket stays logged in after its token expires or the device is revoked. Later: kick it on revoke.

### Requests

| Client sends                                      | Reply                          | Notes                        |
| ------------------------------------------------- | ------------------------------ | ---------------------------- |
| `authenticate {access_token}`                     | `auth_ok {user}`               | first frame only             |
| `ping`                                            | `pong`                         |                              |
| `open_dm {username}`                              | `conversation`                 | creates it the first time    |
| `list_conversations`                              | `conversations`                |                              |
| `send_message {conversation_id, content, nonce}`  | `message_ack {nonce, message}` | see [dms.md](dms.md#sending) |
| `get_history {conversation_id, before_id, limit}` | `history` (newest first)       | limit default 50, max 100    |
| `sync {conversation_id, after_seq}`               | `sync_result`                  | also edits + deletes         |
| `edit_message {conversation_id, message_id, content}` | `edit_message_ack {message, seq}` | author only, see [dms.md](dms.md#edit-and-delete) |
| `delete_message {conversation_id, message_id}`    | `delete_message_ack {…, seq}`  | author only, hard delete     |
| — (push, id 0)                                    | `message_updated` / `message_deleted` | carry the change's `seq` |
| — (push, id 0)                                    | `message_created`              | live, via NATS (see dms.md)  |
| `call_start` / `call_accept` / `call_decline` / `call_join` / `call_leave` | `call_result` / `call_joined` | voice, see [calls.md](calls.md) |
| — (push, id 0) | `call_incoming` / `call_updated` / `call_ended` | voice calls |
| — (push, id 0)                                    | `friend_updated {user, state}` | see [friends.md](friends.md) |
| `start_typing {conversation_id}` (id 0)           | — none                         | fire-and-forget, see [dms.md](dms.md#typing-indicator) |
| — (push, id 0)                                    | `typing_started {conversation_id, user_id}` | to the other members |
| `set_idle {idle}`                                 | `pong`                         | see [presence.md](presence.md) |
| `get_presence {user_ids}`                         | `presences`                    | friends + DM members only, max 200 per request (client pages) |
| — (push, id 0)                                    | `presence_updated {user_id, status}` | see [presence.md](presence.md) |

Example session (written as JSON; on the wire it's binary protobuf):

```text
→ { id: 4, send_message: { conversation_id: 42, content: "hi", nonce: "a7f3" } }
← { id: 4, message_ack: { nonce: "a7f3", message: { id: 9002, seq: 44, ... } } }
← { id: 0, message_created: { message: { id: 9003, seq: 45, content: "ok" } } }   // push
```

### On the wire

`{id: 5, ping}` is 4 bytes: `08 05 52 00`. Each field is `(field number << 3 | wire type)` then its value,
so **field numbers are the real names on the wire**: never change or reuse one, renaming is free.

Test it end to end: `pnpm --filter mock smoke:ws` (api + stack running).

## Event sync (reconnect)

- Every message in a conversation gets a **sequence number** (`seq`).
- On reconnect, per conversation: `sync {after_seq: 5000}` → every message after #5000, **oldest first**.
- Nothing new? Answered from the conversation row (`last_seq`), no message read.
- At most 200 per sync. More missed → `complete: false`: you got the newest 200; drop your local copy and load older with `get_history`.
- Holes in seq (a crashed send) are fine: sync filters `seq > after_seq`, it doesn't count.
- Edits and deletes take a seq too, so sync also returns `edited` + `deleted_ids`, and `last_seq` to use next time.

## Versioning

- Protobuf: only add fields, never reuse field numbers.
- Clients send their protocol version on connect.

## Open questions

- Exact versioning policy between hub, nodes and old clients.
