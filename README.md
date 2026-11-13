# 🐒 Discord 2.0

Open source Discord alternative. Rust backend, Tauri + React client.
Screen share at 60fps in source quality, a light app, no file size limits.

> Name not final. Docs: [docs/README.md](docs/README.md)

## Layout

```
proto/            contracts (.proto), the source of truth for the API
services/         things you run
  api/            accounts, friends, DMs. WebSocket + a little HTTP
  media/          voice/video forwarding (SFU)
libs/             code that gets imported
  client-core/    the client's brain (no Tauri/UI code)
  common/         Snowflake IDs, tracing setup
  protocol/       Rust types generated from proto/
client/
  src/            React UI (Tailwind)
  src-tauri/      desktop shell, thin glue to client-core
tools/
  mock/           fake API for UI work
infra/            docker-compose for local dependencies
docs/             architecture and product docs
```

## Requirements

- Rust (stable), Node 24, pnpm 11, Docker
- Linux desktop builds: `libwebkit2gtk-4.1-dev` (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))
- No `protoc` needed: Rust uses `protox`, TS uses `buf` from npm.

## Quick start

```sh
pnpm install
pnpm gen                    # generate TS types from proto/

# UI against the mock API (no backend needed)
pnpm mock                   # ws://127.0.0.1:7101/ws
pnpm dev                    # web UI on http://localhost:5173
pnpm desktop                # same UI in the Tauri window

# Real API
cargo run -p api            # ws://127.0.0.1:7100/ws, /health, /metrics
VITE_API_URL=ws://127.0.0.1:7100/ws pnpm dev

# Databases (Postgres, Scylla, NATS, Redis, Zitadel)
docker compose -f infra/docker-compose.yml up -d --wait
```

Zitadel console: http://localhost:7102/ui/console (first boot takes ~1 min).
Default admin: `zitadel-admin@zitadel.localhost` / `Password1!` (local dev only).

## Local ports

| Service  | Port  |
| -------- | ----- |
| api      | 7100  |
| mock     | 7101  |
| Zitadel  | 7102  |
| Postgres | 55432 |
| Scylla   | 9042  |
| NATS     | 4222  |
| Redis    | 6379  |
| Vite dev | 5173  |

## Changing the API

1. Edit a `.proto` file in `proto/`.
2. `pnpm gen` (TS) and `cargo build` (Rust) regenerate the types.
3. Both sides fail to compile if they no longer match the contract.

## Checks (same as CI)

```sh
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
pnpm lint && pnpm build
```

## License

[AGPL-3.0](LICENSE). Forks, including hosted ones, must stay open.
