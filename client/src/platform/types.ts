import type { StateStorage } from "zustand/middleware";

// What shared code (api/, stores/) needs from the device it runs on.
// Each target sets one at startup with `setPlatform`:
// - web/desktop: platform/index.ts (browser APIs)
// - mobile:      mobile/src/platform (React Native APIs)
// Shared code must only reach the device through this, never DOM/RN globals.
export interface Platform {
  kind: "desktop" | "web" | "mobile";
  httpUrl: string;
  wsUrl: string;
  deviceName: string;
  /** Where the auth store keeps tokens (localStorage, OS keychain…). */
  storage: StateStorage;
  /** Run `fn` while no other tab/process runs it under the same name. */
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Random unique id (message nonces). */
  randomId(): string;
  /** Mic + WebRTC for voice calls. */
  media: CallMedia;
}

// One call's audio. Signaling stays in stores/calls.ts; this only owns
// the mic, the peer connection and the speaker.
export interface CallMedia {
  /** Open the mic and a peer connection; resolves with our SDP offer. */
  start(events: { onConnected: () => void; onFailed: () => void }): Promise<string>;
  /** Apply the SFU's SDP answer. */
  setAnswer(sdp: string): Promise<void>;
  setMuted(muted: boolean): void;
  /** Close everything. Safe to call when nothing is open. */
  stop(): void;
}

// Opus: DTX on (near-silent when quiet), 64 kbps.
export function tuneOpus(sdp: string): string {
  return sdp.replace(/(a=fmtp:111 [^\r\n]*)/, "$1;usedtx=1;maxaveragebitrate=64000");
}
