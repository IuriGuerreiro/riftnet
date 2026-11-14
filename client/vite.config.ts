import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Same config serves the web build and the Tauri desktop shell.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 7104,
    strictPort: true,
    // Allow access through Tailscale MagicDNS (tailscale serve proxies HTTPS to this port).
    allowedHosts: [".ts.net"],
    // TEST: voice-call spike SFU (spikes/sfu-audio). Same origin = no CORS, works over Tailscale HTTPS.
    proxy: { "/sfu": { target: "http://127.0.0.1:3000", rewrite: (p) => p.replace(/^\/sfu/, "") } },
  },
});
