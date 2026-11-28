# Adept

Open source voice, chat, and screen-sharing app for gamers and coaches. Rust backend, Tauri + React client.
Screen share at 60fps in source quality, a light app, no file size limits.

> See the [project idea](docs/product/README.md), [feature map](docs/features/README.md), and [documentation index](docs/README.md).

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
site/             Riftnet marketing website (Cloudflare Worker)
design/           mock UI reference for the client migration
tools/
  mock/           fake API for UI work
  loadtest/       service load tests
  lint/           repository lint rules
  release/        desktop release manifests and signing config
scripts/          smoke checks and deployment helpers
.agents/skills/   verification instructions and auth smoke helper
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

# Dependencies for the real API (run from the repo root)
docker compose -f infra/docker-compose.yml up -d --wait

# Real API (once Zitadel writes infra/.secrets/api.pat)
cargo run -p api            # http://127.0.0.1:7100: /auth/*, /me, /health, /metrics

# In another terminal
scripts/smoke-auth.sh       # end-to-end auth checks
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
Details and how to add logs, spans and metrics: [docs/architecture/observability.md](docs/architecture/observability.md).

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

## Website and design preview

The three frontend workspaces have separate roles:

| Folder | Purpose | Local command |
| --- | --- | --- |
| `client/` | Main web and desktop app, connected to the API | `pnpm dev` |
| `site/` | Public marketing website | `pnpm --filter site dev` |
| `design/` | UI reference with mock data and no API connection | `pnpm design` |

Run these commands from the repository root. The client uses port 7104; the design preview uses port 7106.
See [deployment](docs/architecture/deployment.md#6-landing-site-riftnetapp) for the website's Cloudflare build settings and `pnpm --filter site deploy`.
The design preview has a separate `adept-design` Worker; see [design preview deployment](docs/architecture/deployment.md#design-preview).

### Move the design into the app

Keep `design/` as the reference until the corresponding client screens work with real data.
Move screens into `client/` feature by feature and verify them with the [feature map](docs/features/README.md).
The client and brand docs still contain Adept assets, while the website and mock use Riftnet branding. Update client branding as part of that migration.

After the client covers the approved design:

- Remove `design/`, its workspace entry, and the root `design` script.
- Remove its ESLint project paths, file patterns, and UI override.
- Remove the CI `design` job and the design exclusions in the main client job.
- Remove the emoji subset entry from `.prettierignore` and regenerate the lockfile.
- Move any media needed by the app before deleting the mock assets.
- Retire the `adept-design` Worker separately after checking whether its preview is still needed.

## Changing the API

1. Edit a `.proto` file in `proto/`.
2. `pnpm gen` (TS) and `cargo build` (Rust) regenerate the types.
3. Both sides fail to compile if they no longer match the contract.

## Verify a feature

Choose a journey from the [feature map](docs/features/README.md). Use the [verification skill](.agents/skills/verify-adept/SKILL.md) for the isolated auth check and evidence instructions.

## Checks (same as CI)

```sh
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
pnpm lint && pnpm build
```

## License

[AGPL-3.0](LICENSE). Forks, including hosted ones, must stay open.
