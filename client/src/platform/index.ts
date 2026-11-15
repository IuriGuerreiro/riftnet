import { platform, setPlatform } from "./current";
import { webMedia } from "./webMedia";

// Web + desktop (Tauri webview) platform. Imported first in main.tsx.
const isTauri = "__TAURI_INTERNALS__" in window;

setPlatform({
  kind: isTauri ? "desktop" : "web",
  httpUrl: import.meta.env.VITE_API_HTTP ?? defaultHttpUrl(),
  // Real api by default (same host as HTTP). Mock: VITE_API_WS=ws://127.0.0.1:7101/ws
  wsUrl: import.meta.env.VITE_API_WS ?? defaultHttpUrl().replace(/^http/, "ws") + "/ws",
  deviceName: isTauri ? "Desktop app" : `Web (${navigator.platform || "browser"})`,
  storage: localStorage,
  // Web Locks: supported by all current browsers and Tauri webviews. Fall back
  // to no cross-tab lock only if missing.
  withLock: (name, fn) => ("locks" in navigator ? navigator.locks.request(name, fn) : fn()),
  randomId: () => crypto.randomUUID(),
  media: webMedia,
});

export { platform };
export type { Platform } from "./types";

// Opened through Tailscale MagicDNS (https://<host>.ts.net:7103)? Then use the
// api through Tailscale too (https port 7099 → local 7100). Otherwise localhost.
function defaultHttpUrl(): string {
  const { hostname } = window.location;
  if (hostname.endsWith(".ts.net")) return `https://${hostname}:7099`;
  return "http://127.0.0.1:7100";
}
