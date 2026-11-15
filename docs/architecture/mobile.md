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

API URLs live in `mobile/src/config.ts`: set `TARGET` to `'mock'` (default) or `'real'`.
Android emulator uses `10.0.2.2`; on a real device set `HOST` to your machine's address.

The mock (`tools/mock`) serves HTTP on :7100 and WS on :7101. It logs you in with any
email/password, has a few canned people (`ana`, `bruno`, `carla`, `diogo`) and answers
messages. Calls ring, but it has no SFU: real audio needs `services/api`.

## Code sharing with client/

- `@shared/*` → `client/src/*` (Babel alias + tsconfig `paths`; Metro watches `client/src`).
- Shared: proto types (`gen/`), Zod schemas, `api/http.ts`, `api/ws.ts`, `api/types.ts`
  and the stores (`auth`, `connection`, `chat`, `friends`, `calls`).
- Device APIs go through `Platform` (`client/src/platform/types.ts`): storage, a lock,
  random ids and `CallMedia` (mic + WebRTC). Each app calls `setPlatform` first thing:
  desktop in `client/src/platform/index.ts`, mobile in `mobile/src/platform/index.ts`.
- Mobile platform: tokens in the OS keychain (`react-native-keychain`), calls via
  `react-native-webrtc`.
- Rule: shared files must not import DOM, Tauri or React Native APIs.
  `mobile/src/types/globals.d.ts` lists the few globals RN has but doesn't type.

## Layout

```text
mobile/src/
  App.tsx       providers + navigation container
  navigation/   Login → Username → tabs (DMs, Friends) + Chat, Group, NewGroup, Call
  screens/      one file per screen
  session/      LiveSession (WebSocket + store wiring), incoming-call banner, auth actions
  platform/     setPlatform for RN: keychain storage, WebRTC media
  ui/           small components + theme
  core/         bridge to libs/client-core (STUB)
  config.ts     API URLs, mock/real switch
```

## Rust core bridge (next step)

`src/core` is a typed stub. Plan: `uniffi-bindgen-react-native` (still pre-1.0) generates a
Turbo Module from `libs/client-core`. Needs Rust targets (aarch64/x86_64 Android + iOS), the
NDK and Xcode. Screens only use the `Core` interface, so the swap won't touch UI code.

## Not on mobile yet

Screen sharing, files, presence, typing, edit/delete (other branches) and push
notifications. Incoming calls only show while the app is open.
Read state is never shown to other people (no "seen").
