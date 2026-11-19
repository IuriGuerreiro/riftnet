# MVP

## Focus: DMs only

Servers (nodes) come later. The MVP proves the core promise in DMs and small groups.

## Server-only first

The MVP sends everything through our servers: calls via our SFU, files via our relay. **No P2P in the MVP.**
P2P comes after, one feature at a time (calls 1-on-1 → group calls → files), behind the same transport traits.

## Scope, in order

1. Accounts and login (Zitadel)
2. Friends + DMs + group DMs (max 5), real-time text
3. Voice calls over WebRTC through the SFU
4. Screen sharing through the SFU, with 1080p60 at source quality as a target
5. File sharing through the relay

## Out of scope for the MVP

- Community servers and independently hosted nodes
- E2E for text (planned, see [dms.md](../architecture/dms.md))
- Plugins, SDKs, marketplace
- Mobile

## Team

| Who      | Area                                               |
| -------- | -------------------------------------------------- |
| **G**    | Backend: hub, gateway, signaling, Rust core, media |
| **José** | UI/UX: Tauri + TypeScript app, design system       |

**How to work in parallel:** agree the protobuf schemas first. José builds against fake data while G builds the real backend.

## First spikes (before full build)

Small throwaway prototypes to remove the biggest risks:

1. **Native video rendering in Tauri:** get decoded 60fps frames from Rust onto the screen.
2. **Zitadel:** run in Docker, log in from the Tauri app, hub issues our token.
3. **Call through our SFU:** libwebrtc client → `str0m` SFU → client, carrying our hardware-encoded 60fps screen. This is the go/no-go gate for the media stack.
