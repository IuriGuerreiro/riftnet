# 🐒 Discord 2.0 — Documentation

Open source Discord alternative, written in Rust. Name not decided yet (favourites: Monke, Yap).

**The hook:** screen share at 60fps in source quality, a light app (<1 GB RAM), no file size limits.

## Start here

1. [product/vision.md](product/vision.md): what we're building and why
2. [product/mvp.md](product/mvp.md): what we build first and who does what
3. [architecture/overview.md](architecture/overview.md): how the pieces fit
4. [decisions.md](decisions.md): what's decided and what's still open

## Architecture

| Doc                                               | Topic                                         | Status     |
| ------------------------------------------------- | --------------------------------------------- | ---------- |
| [overview.md](architecture/overview.md)           | Hub + nodes, scale targets, failure modes     | ✅ Decided |
| [tech-stack.md](architecture/tech-stack.md)       | Languages, libraries, infra, observability    | ✅ Decided |
| [identity-auth.md](architecture/identity-auth.md) | Accounts, Zitadel, hub ↔ node tokens         | ✅ Decided |
| [protocol.md](architecture/protocol.md)           | Protobuf, WebSocket vs REST, sync, versioning | ✅ Decided |
| [messaging.md](architecture/messaging.md)         | Message flow, storage, node profiles          | ✅ Decided |
| [dms.md](architecture/dms.md)                     | DMs (MVP focus), E2E plan, group limits       | 🎯 MVP     |
| [voice-video.md](architecture/voice-video.md)     | WebRTC, audio and video pipelines             | 📝 Draft   |
| [files.md](architecture/files.md)                 | Chunked files, P2P, relay                     | 📝 Draft   |

## Product

| Doc                                              | Topic                        | Status        |
| ------------------------------------------------ | ---------------------------- | ------------- |
| [vision.md](product/vision.md)                   | Goals, audience, scale       | ✅ Decided    |
| [mvp.md](product/mvp.md)                         | Scope, order, team           | ✅ Decided    |
| [tiers-and-costs.md](product/tiers-and-costs.md) | Free vs paid, cost estimates | 📊 Estimates  |
| [monetization.md](product/monetization.md)       | Revenue ideas                | 💡 Brainstorm |
| [developers.md](product/developers.md)           | SDKs, WASM plugins           | 💡 Ideas      |
| [brand.md](product/brand.md)                     | Tone, names, marketing ideas | 💡 Ideas      |

## Conventions

- Every doc has **Decided**, **Open questions** and **Risks** where relevant.
- Cost and capacity numbers are estimates until we benchmark.
- When a decision closes, log it in [decisions.md](decisions.md) with the date.
