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
  wsUrl: import.meta.env.VITE_API_WS ?? defaultHttpUrl().replace(/^http/, "ws") + "/ws",
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  deviceName: isTauri ? "Desktop app" : `Web (${navigator.platform || "browser"})`,
};

function defaultHttpUrl(): string {
  const { hostname } = window.location;
  if (hostname.endsWith(".ts.net")) return `https://${hostname}:7099`;
  return "http://127.0.0.1:7100";
}
