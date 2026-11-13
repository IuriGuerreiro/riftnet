// The UI only talks to this interface. Each target implements it:
// - desktop/mobile: Tauri commands -> Rust client-core (native media, 60fps)
// - web: browser APIs (WebSocket, browser WebRTC, getDisplayMedia)
export interface Platform {
  kind: "desktop" | "web";
  apiUrl: string;
}

const isTauri = "__TAURI_INTERNALS__" in window;

export const platform: Platform = {
  kind: isTauri ? "desktop" : "web",
  // Mock by default; point at the real api with VITE_API_URL=ws://127.0.0.1:7100/ws
  apiUrl: import.meta.env.VITE_API_URL ?? "ws://127.0.0.1:7101/ws",
};
