// @openparachute/applet-host as ONE html file (an MCP App view loads nothing from elsewhere under a host's default
// content policy): `npm run build --workspace` or, from the repo root,
//   npx vite build --config packages/applet-host/vite.config.ts      → packages/applet-host/dist/applet-host.html
// The frame's kits (React, the vault client, the frame kit) are the app's own, built by the app's Vite plugins.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type PluginOption } from "vite";
import app from "../../vite.config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(here("./package.json"), "utf8")) as { version: string };
const out = here("./dist");
// the app's kit plugins, by name (virtual:react-kit, virtual:vault-client-kit, virtual:react-note-kit, virtual:frame-kit)
const kits = ((app as { plugins?: PluginOption[] }).plugins ?? []).flat().filter((p): p is Plugin => !!p && typeof p === "object" && "name" in p && String(p.name).startsWith("virtual:"));

// after Vite has written the build (so every chunk is final), fold the scripts and styles into the page, one file
const oneFile = (): Plugin => ({
  name: "one-html",
  apply: "build",
  writeBundle(_o, bundle) {
    const page = Object.values(bundle).find((f) => f.type === "asset" && f.fileName.endsWith(".html"));
    if (!page || page.type !== "asset") return;
    let html = String(page.source);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const f of Object.values(bundle)) {
      if (f.type === "chunk") {
        const safe = f.code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\x21--");
        html = html.replace(new RegExp(`<script[^>]*src="[^"]*${esc(f.fileName)}"[^>]*></script>`), () => `<script type="module">${safe}</script>`);
      } else if (f.fileName.endsWith(".css")) {
        html = html.replace(new RegExp(`<link[^>]*href="[^"]*${esc(f.fileName)}"[^>]*>`), () => `<style>${String(f.source)}</style>`);
      }
    }
    if (/<script[^>]*\ssrc=|<link[^>]*stylesheet/.test(html)) throw new Error("applet-host: a script or sheet was left outside the page");
    for (const f of Object.keys(bundle)) rmSync(join(out, f), { force: true, recursive: true });
    rmSync(join(out, "assets"), { force: true, recursive: true });
    writeFileSync(join(out, "applet-host.html"), html);
  },
});

export default defineConfig({
  root: here("."),
  base: "./",
  plugins: [...kits, oneFile()],
  resolve: { alias: app.resolve?.alias },
  define: { __HOST_VERSION__: JSON.stringify(pkg.version), "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: out, emptyOutDir: true, target: "es2022", assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false,
    rollupOptions: { input: here("./index.html"), output: { inlineDynamicImports: true } } },
});
