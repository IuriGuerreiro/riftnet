import * as Keychain from 'react-native-keychain';
import type { StateStorage } from 'zustand/middleware';

// The auth store's storage on mobile: the OS keychain (iOS Keychain /
// Android Keystore). One keychain entry per key; the value is the JSON blob.
const service = (key: string) => `chat.discord2.${key}`;

export const keychainStorage: StateStorage = {
  async getItem(key) {
    const found = await Keychain.getGenericPassword({ service: service(key) });
    return found ? found.password : null;
  },
  async setItem(key, value) {
    await Keychain.setGenericPassword(key, value, {
      service: service(key),
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  async removeItem(key) {
    await Keychain.resetGenericPassword({ service: service(key) });
  },
};
