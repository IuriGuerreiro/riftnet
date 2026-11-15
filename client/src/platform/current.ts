import type { Platform } from "./types";

// The platform shared code uses. Filled by `setPlatform` before any store loads
// (first import in main.tsx / mobile index.js).
export const platform = {} as Platform;

export function setPlatform(p: Platform) {
  Object.assign(platform, p);
}

export { tuneOpus, type CallMedia, type Platform } from "./types";
