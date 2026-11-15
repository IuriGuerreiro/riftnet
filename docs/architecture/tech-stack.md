# Tech stack

## Backend

- **Rust:** `tokio` (async runtime), `axum` (HTTP/WebSocket).
- **Postgres:** users, friends, settings, permissions.
- **Redis:** presence, caches (e.g. permissions).
- **ScyllaDB + NATS:** the hub's DM messages from day 1, and the Big node profile. See [messaging.md](messaging.md).
- **Zitadel:** auth provider, self-hosted. See [identity-auth.md](identity-auth.md).
- **coturn:** TURN relay for P2P calls that can't connect directly (after the MVP).
- **Object storage:** MinIO or Cloudflare R2 for the file relay/cache.

## Client

- **React + TypeScript + Vite**, one UI codebase for desktop (Tauri) and web. Never Electron.
- A `Platform` interface hides the difference: desktop uses the Rust core (mobile: via UniFFI); web uses browser APIs (WebSocket, browser WebRTC, `getDisplayMedia`). Web screen share is lower quality; desktop is the real 60fps.
- **Rust core** inside the app does the heavy work: networking, media, capture, encode, decode.

### Tauri vs Electron

- Tauri: ~5–15 MB install vs ~100–200 MB, and less RAM. It uses the OS webview instead of shipping Chromium.
- The webview still costs RAM. Keeping "<1 GB" is on **our UI code**, not just Tauri.
- Each OS uses a different engine: WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux, weak WebRTC/video). So we test on 3 engines.
- **Rule: media never runs in the webview.** It lives in the Rust core, and video is rendered natively. See [voice-video.md](voice-video.md).
- **Mobile:** React Native app, sharing types/schemas with the client. See [mobile.md](mobile.md).

## Media

- **WebRTC:** client = Google libwebrtc via LiveKit's Rust crates; SFU = `str0m`.
- Native capture: DXGI (Windows), ScreenCaptureKit (macOS), PipeWire (Linux).
- Hardware encode: NVENC / AMF / QSV / VideoToolbox (macOS). AV1 when available, H.264 fallback.
- Audio: `cpal` (capture/playback), Opus, libwebrtc's audio processing (AEC, noise suppression).

## Protocol

- **Protobuf** for everything except media. See [protocol.md](protocol.md).

## Observability (from day 1, not optional)

- `tracing` crate for structured logs and spans.
- Prometheus metrics at `/metrics`.
- OpenTelemetry (OTLP) export of logs, traces and metrics to SigNoz. See [observability.md](observability.md).

## Hosting

- Hetzner / OVH. **Never AWS for media**: bandwidth is 50–90x more expensive.
