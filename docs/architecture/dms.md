# DMs (MVP focus)

## Decided

- **DMs are stored on the hub**, so messages arrive even when the other person is offline.
- Content is stored as opaque `bytes`. MVP: plain text, protected by TLS + encrypted disk.
- **Who can DM you** is a user setting: everyone / friends of friends / friends only.
- **Group DMs: max 5 people.** Starting value, to be tuned after testing.
- **MVP: calls go through our SFU**, so they're encrypted to the server, not end-to-end. When P2P arrives, 1-on-1 calls become E2E by default (DTLS-SRTP).
- **Quality:** 60fps source for 1-on-1; groups start at 720p60 and scale up.

## Future plan: E2E for text (after the MVP)

Not in the MVP. Substantial future work (device credentials, membership changes, key lifecycle). These steps keep the door open:

1. Message content = opaque `bytes` in protobuf.
2. An `encryption` field on every message (`none` / `mls`).
3. Accounts have devices from day 1 (`device_id`).
4. Nothing on the server reads DM content. Search, link previews and filters run on the client.

When we do it:

- Protocol: **MLS** (RFC 9420) via `openmls` (MIT, pure Rust). Discord uses MLS for its own E2E voice/video.
  - 1-on-1 = a group of 2. Multi-device = each device is a member.
- The hub stores only encrypted blobs and **prekeys** (spare public keys, so you can start a chat with someone offline).
- Older messages stay marked "sent before E2E".
- To decide then: encrypted history backup (or lose history with all devices), and safety numbers / QR verification.

Why MLS over the Signal protocol: it handles groups and multi-device natively, it's an IETF standard, and `libsignal` is AGPL.

## Test plan: group size vs upload (when P2P arrives)

In P2P, the person sharing their screen uploads **one copy per viewer** (1080p60 ≈ 8 Mbps each, so 4 viewers ≈ 32 Mbps). Fine on fiber, tight on cable/DSL.

Simulate bad networks with a throttler and measure fps, resolution, latency and recovery with 2–5 people.

- Linux: `tc netem` · Windows: Clumsy · macOS: Network Link Conditioner

| Profile   | Down / Up              |
| --------- | ---------------------- |
| Fiber     | 500 / 500              |
| US cable  | 500 / 20               |
| DSL       | 50 / 10                |
| Bad Wi-Fi | + 2–5% packet loss     |
| 4G        | variable, high latency |

Possible fixes if needed: rely on WebRTC's automatic quality drop, encode once for all viewers, an optional relay for bigger groups.

## Open questions

- Sync on reconnect: sequence number per conversation (see [protocol.md](protocol.md)).
