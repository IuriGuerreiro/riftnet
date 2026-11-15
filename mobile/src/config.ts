import { Platform } from 'react-native';

// Which backend the app talks to:
//   'mock' → tools/mock (`pnpm mock`): HTTP :7100, WS :7101
//   'real' → services/api: HTTP and WS on the same port (:7100, WS at /ws)
const TARGET: 'mock' | 'real' = 'mock';

// The Android emulator reaches the host machine on 10.0.2.2; iOS simulator uses 127.0.0.1.
// On a real device, set HOST to your machine's LAN / Tailscale address.
const HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

export const config = {
  target: TARGET,
  httpUrl: `http://${HOST}:7100`,
  wsUrl: TARGET === 'mock' ? `ws://${HOST}:7101/ws` : `ws://${HOST}:7100/ws`,
  deviceName: `Mobile (${Platform.OS})`,
} as const;
