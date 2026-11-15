import { Platform } from 'react-native';

// Where the app finds the API. Points at the mock (tools/mock, `pnpm mock`) for now.
// The Android emulator reaches the host machine on 10.0.2.2; iOS simulator uses 127.0.0.1.
// On a real device, set HOST to your machine's LAN / Tailscale address.
const HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

export const config = {
  httpUrl: `http://${HOST}:7100`,
  wsUrl: `ws://${HOST}:7101/ws`, // mock WS port (MOCK_PORT)
  deviceName: `Mobile (${Platform.OS})`,
} as const;
