# Spike: 1:1 audio through our SFU

Throwaway. Proves: browser → our `str0m` SFU → browser, Opus audio, no decoding.
Design: [docs/architecture/calls.md](../../docs/architecture/calls.md).

## Run

```sh
cargo run                 # in this folder
# open http://localhost:3000 in two tabs, press Join in both. Use headphones.
```

- More logs: `RUST_LOG=sfu_audio=debug,str0m=info cargo run`
- Other machine on the LAN: browsers only allow the mic on `localhost` or HTTPS.
  Quick hack in Chrome: `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → add `http://<sfu-ip>:3000`.
- Wrong IP picked? `SFU_IP=192.168.x.y cargo run`

## In the test chat UI

The DM screen has a **Join call** button (`client/src/call/CallBar.tsx`).
1. `cargo run` here, plus the usual api stack and `pnpm --filter client dev`.
2. Two users open the same DM and both press **Join call** (no ringing yet).
- Room = conversation id. Vite proxies `/sfu/*` → `localhost:3000`, so it works over Tailscale HTTPS too
  (the mic needs HTTPS). The SFU's UDP port must still be reachable: `SFU_IP=<tailscale ip> cargo run`.

## Automated check

```sh
cargo run &   # then:
mkdir -p /tmp/prof && node e2e.mjs /tmp/prof
```

Two headless Chromium tabs with a fake mic join, talk 20 s, print stats.
Pass = both `connected`, `recv` ≈ `sent`, `energy` > 0.

## Result (2026-11-14, same machine)

- `recv 991 / sent 1003` each way in 20 s, `lost 0`. Audio energy > 0 on both sides.
- SFU: ~21 MB RAM, a few % CPU (debug build, trace logs on).

## What we learned

- **ICE-lite broke on a machine with Docker bridges.** Chrome sent media from `192.168.192.1`,
  str0m-lite had picked `192.168.1.88`, so ~97% of packets matched no peer. Full ICE fixed it.
  Revisit lite for production (public IP, one interface).
- 1:1 needs no renegotiation: the browser's one `sendrecv` audio track carries both directions.
  3+ people need the SFU to add tracks (renegotiation) — next step.

## Not in here (on purpose)

WebSocket/NATS signaling, ring/accept, auth, 3+ people, TURN, Tauri/libwebrtc.
