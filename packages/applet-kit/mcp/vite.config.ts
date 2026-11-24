// The MCP App view (host.tsx) as ONE html file, for a connector to serve as ui://parachute/applet-host:
//   npx vite build --config packages/applet-kit/mcp/vite.config.ts   → dist-mcp/applet-host.html
// Everything is inline (a view's default CSP loads nothing from elsewhere): the script, the kit's styles, the fonts.
import { writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { parachuteApplet } from "../src/vite.ts";

const out = resolve(process.env.OUT ?? "dist-mcp");
const inline = (): Plugin => ({
  name: "one-html",
  apply: "build",
  writeBundle(_o, bundle) {
    const js = Object.values(bundle).filter((c) => c.type === "chunk").map((c) => (c as { code: string }).code).join("\n");
    const css = Object.values(bundle).filter((a) => a.type === "asset" && a.fileName.endsWith(".css")).map((a) => String((a as { source: string | Uint8Array }).source)).join("\n");
    const safe = js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\x21--");
    writeFileSync(`${out}/applet-host.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Parachute</title><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`);
    for (const f of Object.keys(bundle)) rmSync(`${out}/${f}`, { force: true });
  },
});

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), parachuteApplet(), inline()],
  build: {
    outDir: out, emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false,
    rollupOptions: { input: fileURLToPath(new URL("./host.tsx", import.meta.url)), output: { format: "iife", inlineDynamicImports: true, entryFileNames: "host.js" } },
  },
});
