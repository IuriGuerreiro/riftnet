// Mobile platform for the code shared with client/ (@shared/*).
// Imported first in index.js: stores read it as soon as they load.
import 'fast-text-encoding'; // TextEncoder/TextDecoder, if Hermes lacks them
import { setPlatform } from '@shared/platform/current';
import { config } from '../config';
import { keychainStorage } from './keychainStorage';
import { nativeMedia } from './media';

// Mobile has a single JS context, so the in-process guard in api/http.ts is
// enough; no cross-process lock needed.
const withLock = <T,>(_name: string, fn: () => Promise<T>) => fn();

// Message nonces only need to be unique, not secret.
function randomId(): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;
}

setPlatform({
  kind: 'mobile',
  httpUrl: config.httpUrl,
  wsUrl: config.wsUrl,
  deviceName: config.deviceName,
  storage: keychainStorage,
  withLock,
  randomId,
  media: nativeMedia,
});
