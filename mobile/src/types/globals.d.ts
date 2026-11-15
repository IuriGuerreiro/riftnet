// Globals React Native has at runtime but its typings leave out.
// Shared code (client/src) uses them.
export {};

declare global {
  interface WebSocket {
    binaryType: 'blob' | 'arraybuffer';
  }

  // Hermes (or the fast-text-encoding polyfill, see src/platform).
  class TextEncoder {
    encode(input?: string): Uint8Array;
  }
  class TextDecoder {
    constructor(label?: string);
    decode(input?: ArrayBufferView | ArrayBuffer): string;
  }
}
