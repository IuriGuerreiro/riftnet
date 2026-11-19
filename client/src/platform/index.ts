export interface Platform {
  kind: "desktop" | "web";
  httpUrl: string;
  wsUrl: string;
  webUrl: string;
  deviceName: string;
}

const isTauri = "__TAURI_INTERNALS__" in window;
const httpUrl = import.meta.env.VITE_API_HTTP ?? defaultHttpUrl();

function webUrl(): string {
  if (!isTauri) return window.location.origin;
  const url = new URL(httpUrl, window.location.href);
  if (url.hostname.startsWith("api.")) {
    url.hostname = `app.${url.hostname.slice(4)}`;
    return url.origin;
  }
  return "http://localhost:7104";
}

export const platform: Platform = {
  kind: isTauri ? "desktop" : "web",
  httpUrl,
  webUrl: webUrl(),
  wsUrl: import.meta.env.VITE_API_WS ?? defaultHttpUrl().replace(/^http/, "ws") + "/ws",
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  deviceName: isTauri ? "Desktop app" : `Web (${navigator.platform || "browser"})`,
};

function defaultHttpUrl(): string {
  const { hostname } = window.location;
  if (hostname.endsWith(".ts.net")) return `https://${hostname}:7099`;
  return "http://127.0.0.1:7100";
}
