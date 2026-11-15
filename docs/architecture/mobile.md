# Mobile

iOS + Android app in `mobile/`: **React Native + TypeScript** (bare RN CLI, no Expo).
Why not Tauri mobile: RN has mature native libs for push, background calls
(CallKit / Android foreground service) and WebRTC.

## Run it

```sh
pnpm install && pnpm gen     # gen: proto types the app imports
pnpm mock                    # fake API (tools/mock)
pnpm mobile                  # Metro bundler
pnpm mobile:android          # or: pnpm mobile:ios (macOS; run `pod install` in mobile/ios first)
```

API URLs live in `mobile/src/config.ts` (mock by default; Android emulator uses `10.0.2.2`).

## Code sharing with client/

- `@shared/*` → `client/src/*` (Babel alias + tsconfig `paths`; Metro watches `client/src`).
- Shared today: generated proto types (`gen/`), Zod schemas, `api/types.ts`.
- Not yet: stores, `api/http.ts` (they use `localStorage` + the web/Tauri `platform`).
  Next: put them behind a storage + platform interface, then share them.
- Rule: shared files must not import DOM, Tauri or React Native APIs.

## Layout

```text
mobile/src/
  App.tsx       providers + navigation container
  navigation/   React Navigation: Login stack ↔ tabs (Friends, DMs) + Chat, Call
  screens/      one file per screen (placeholders for now)
  core/         bridge to libs/client-core (STUB)
  config.ts     API URLs
```

## Rust core bridge (next step)

`src/core` is a typed stub. Plan: `uniffi-bindgen-react-native` (still pre-1.0) generates a
Turbo Module from `libs/client-core`. Needs Rust targets (aarch64/x86_64 Android + iOS), the
NDK and Xcode. Screens only use the `Core` interface, so the swap won't touch UI code.
