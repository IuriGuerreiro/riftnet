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

## WebSocket-only API (+ a little HTTP)

- **All API calls go over the WebSocket.** Requests carry an `id`; the reply carries the same `id`. Server pushes (new messages, presence) have no `id`.
- Auth happens **once when the WebSocket connects**, not per message.
- **Plain HTTP only for:** login callback (Zitadel), file upload/download, `/health`, `/metrics`.
- Handlers don't care about transport, so a REST layer can be added later.

```text
→ { id: 7, type: GetHistory, conversation: 42, before: 999 }
← { id: 7, type: History, messages: [...] }
← { type: MessageCreated, ... }        // push, no id
```

## Event sync (reconnect)

- Every event in a conversation gets a **sequence number**.
- On reconnect: "I have up to #5000" → the server sends everything after.

## Versioning

- Protobuf: only add fields, never reuse field numbers.
- Clients send their protocol version on connect.

## Open questions

- Exact versioning policy between hub, nodes and old clients.
