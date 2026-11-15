import { readFileSync } from "node:fs";
import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// The app's content policy lives in src-tauri/tauri.conf.json (frame-src about: is what stops an applet frame from
// navigating). The dev and preview servers send the same policy, so the browser the tests drive behaves like the app.
const csp = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")).app?.security?.csp as Record<string, string> | string | null | undefined;
const cspHeader = typeof csp === "string" ? csp : csp ? Object.entries(csp).map(([k, v]) => `${k} ${v}`).join("; ") : null;
const headers = cspHeader ? { "Content-Security-Policy": cspHeader } : undefined;

// Code the app puts inside sealed frames, each bundled once to an IIFE string (src/applet/kits): surface-client's
// VaultClient (from the Uni app's vite.config.ts), and React for applets written as TSX/JSX modules.
function iifeKit(id: string, entry: string, name: string): Plugin {
  return {
    name: id,
    resolveId: (source) => (source === id ? `\0${id}` : null),
    async load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const out = await build({
        configFile: false, logLevel: "silent",
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        build: { write: false, minify: true, lib: { entry: new URL(entry, import.meta.url).pathname, formats: ["iife"], name } },
      });
      const result = Array.isArray(out) ? out[0] : out;
      const code = "output" in result ? result.output[0].code : "";
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

// The frame (src/frame): its own bundle, one script and its styles, which the shell runs in a sealed frame.
function frameKit(): Plugin {
  const id = "virtual:frame-kit";
  return {
    name: id,
    resolveId: (source) => (source === id ? `\0${id}` : null),
    async load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const out = await build({
        configFile: false, logLevel: "silent", plugins: [react()],
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        build: { write: false, minify: true, cssCodeSplit: false, lib: { entry: new URL("./src/frame/entry.tsx", import.meta.url).pathname, formats: ["iife"], name: "__ParachuteFrame" } },
      });
      const result = Array.isArray(out) ? out[0] : out;
      const files = "output" in result ? result.output : [];
      const js = files.flatMap((f) => (f.type === "chunk" ? [f.code] : []))[0] ?? "";
      const css = files.filter((f) => f.type === "asset" && f.fileName.endsWith(".css")).map((f) => (f.type === "asset" ? String(f.source) : "")).join("\n");
      return `export default ${JSON.stringify({ js, css })};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), iifeKit("virtual:vault-client-kit", "./src/applet/kits/vaultClientEntry.ts", "__UniVC"), iifeKit("virtual:react-kit", "./src/applet/kits/reactEntry.ts", "__ParachuteReact"), frameKit()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, headers },
  preview: { headers },
  build: { target: "es2022" },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["src/test-setup.ts"], globals: false },
});
