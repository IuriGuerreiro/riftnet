import { build } from "esbuild";

await build({
  entryPoints: ["src/seed.ts", "src/http.ts", "src/ws.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "es2022",
  external: ["k6", "k6/*"],
  logLevel: "info",
});
