# Adept — Documentation

Open source voice, chat, and screen-sharing app for gamers and coaches, written in Rust.

**The hook:** screen share at 60fps in source quality, a light app (<1 GB RAM), no file size limits.

## Start here

1. [Project idea and MVP plan](product/README.md) explains what we want to build and why.
2. [Feature map](features/README.md) describes what the app does today and how to check it.
3. [architecture/overview.md](architecture/overview.md): how the pieces fit
4. [decisions.md](decisions.md): what's decided and what's still open

## Architecture

| Doc                                               | Topic                                           | Status     |
| ------------------------------------------------- | ----------------------------------------------- | ---------- |
| [overview.md](architecture/overview.md)           | Hub + nodes, scale targets, failure modes       | ✅ Decided |
| [tech-stack.md](architecture/tech-stack.md)       | Languages, libraries, infra, observability      | ✅ Decided |
| [identity-auth.md](architecture/identity-auth.md) | Accounts, Zitadel, native login, our tokens     | ✅ Decided |
| [backend.md](architecture/backend.md)             | Feature folders, controller → service → repo    | ✅ Decided |
| [observability.md](architecture/observability.md) | Logs, traces, metrics → SigNoz, no-secrets rule | ✅ Decided |
| [frontend.md](architecture/frontend.md)           | React stack, folder rules, auth states          | ✅ Decided |
| [protocol.md](architecture/protocol.md)           | Protobuf, WebSocket vs REST, sync, versioning   | ✅ Decided |
| [messaging.md](architecture/messaging.md)         | Message flow, storage, node profiles            | ✅ Decided |
| [dms.md](architecture/dms.md)                     | DMs (MVP focus), E2E plan, group limits         | 🎯 MVP     |
| [voice-video.md](architecture/voice-video.md)     | WebRTC, audio and video pipelines               | 📝 Draft   |
| [files.md](architecture/files.md)                 | Chunked files, P2P, relay                       | 📝 Draft   |

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
