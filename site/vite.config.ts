import { defineConfig } from "vite";

import { site } from "./src/config";

export default defineConfig({
  plugins: [
    {
      name: "site-config",
      transformIndexHtml: (html) =>
        html.replaceAll(/\{\{(\w+)\}\}/g, (match, key: string) => {
          if (!(key in site)) throw new Error(`Unknown config key in index.html: ${key}`);
          return site[key as keyof typeof site];
        }),
    },
  ],
});
