import { defineConfig } from "vite";

import { site } from "./src/config";

// Swaps {{SITE_URL}}-style tokens in index.html for values from src/config.ts,
// so links work without JavaScript.
export default defineConfig({
  plugins: [
    {
      name: "site-config",
      transformIndexHtml: (html) =>
        html.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
          if (!(key in site)) throw new Error(`Unknown config key in index.html: ${key}`);
          return site[key as keyof typeof site];
        }),
    },
  ],
});
