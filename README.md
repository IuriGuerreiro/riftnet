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
pnpm dev                    # web UI on http://localhost:7104
pnpm desktop                # same UI in the Tauri window

# Real API (needs the docker stack below; run from the repo root)
cargo run -p api            # http://127.0.0.1:7100: /auth/*, /me, /health, /metrics
scripts/smoke-auth.sh       # end-to-end auth checks

# Databases (Postgres, Scylla, NATS, Redis, Zitadel)
docker compose -f infra/docker-compose.yml up -d --wait
```

Zitadel console: http://localhost:7102/ui/console (first boot takes ~1 min).
Default admin: `zitadel-admin@zitadel.localhost` / `Password1!` (local dev only).

## Observability (optional)

Send logs, traces and metrics to SigNoz (runs separately on :8080):

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317 cargo run -p api
```

Or set it in `.env` (see [.env.example](.env.example)). Then open
http://127.0.0.1:8080 → Services → `api`. Unset = stdout logs only.
Details: [docs/architecture/observability.md](docs/architecture/observability.md).

## Local ports

| Service  | Port                   |
| -------- | ---------------------- |
| api      | 7100                   |
| mock     | 7101                   |
| Zitadel  | 7102                   |
| Postgres | 55432                  |
| Scylla   | 9042                   |
| NATS     | 4222                   |
| Redis    | 6379                   |
| Vite dev | 7104                   |
| SigNoz   | 8080 (UI), 4317 (OTLP) |

## Testing from other devices (Tailscale)

Uses MagicDNS + HTTPS (needed later for OAuth). One-time setup on the dev machine:

```sh
tailscale serve --bg --https=7103 http://127.0.0.1:7104   # web UI
tailscale serve --bg --https=7099 http://127.0.0.1:7100   # api
```

Then run the stack, `cargo run -p api` and `pnpm dev`, and open
**https://server.tailcbbc1b.ts.net:7103** from any device on the tailnet.
The UI picks the Tailscale api URL automatically when opened via `*.ts.net`.

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
