// The UI only talks to this interface. Each target implements it:
// - desktop/mobile: Tauri commands -> Rust client-core (native media, 60fps)
// - web: browser APIs (WebSocket, browser WebRTC, getDisplayMedia)
export interface Platform {
  kind: "desktop" | "web";
  httpUrl: string;
  wsUrl: string;
  deviceName: string;
}

const isTauri = "__TAURI_INTERNALS__" in window;

export const platform: Platform = {
  kind: isTauri ? "desktop" : "web",
  httpUrl: import.meta.env.VITE_API_HTTP ?? defaultHttpUrl(),
  // Mock by default; real api: VITE_API_WS=ws://127.0.0.1:7100/ws
  wsUrl: import.meta.env.VITE_API_WS ?? "ws://127.0.0.1:7101/ws",
  deviceName: isTauri ? "Desktop app" : `Web (${navigator.platform || "browser"})`,
};

// Opened through Tailscale MagicDNS (https://<host>.ts.net:7103)? Then use the
// api through Tailscale too (https port 7099 → local 7100). Otherwise localhost.
function defaultHttpUrl(): string {
  const { hostname } = window.location;
  if (hostname.endsWith(".ts.net")) return `https://${hostname}:7099`;
  return "http://127.0.0.1:7100";
}
