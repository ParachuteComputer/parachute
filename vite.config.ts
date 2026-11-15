import { readFileSync } from "node:fs";
import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// The app's content policy lives in src-tauri/tauri.conf.json (frame-src about: is what stops an applet frame from
// navigating). The dev and preview servers send the same policy, so the browser the tests drive behaves like the app.
const csp = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")).app?.security?.csp as Record<string, string> | string | null | undefined;
const cspHeader = typeof csp === "string" ? csp : csp ? Object.entries(csp).map(([k, v]) => `${k} ${v}`).join("; ") : null;
const headers = cspHeader ? { "Content-Security-Policy": cspHeader } : undefined;

// surface-client's VaultClient, bundled once to an IIFE string that the app injects into every sealed frame
// (src/applet/kits). From the Uni app's vite.config.ts.
function vaultClientKit(): Plugin {
  const id = "virtual:vault-client-kit";
  return {
    name: "vault-client-kit",
    resolveId: (source) => (source === id ? `\0${id}` : null),
    async load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const out = await build({
        configFile: false, logLevel: "silent",
        build: { write: false, minify: true, lib: { entry: new URL("./src/applet/kits/vaultClientEntry.ts", import.meta.url).pathname, formats: ["iife"], name: "__UniVC" } },
      });
      const result = Array.isArray(out) ? out[0] : out;
      const code = "output" in result ? result.output[0].code : "";
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), vaultClientKit()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, headers },
  preview: { headers },
  build: { target: "es2022" },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["src/test-setup.ts"], globals: false },
});
