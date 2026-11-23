import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
// Which build this is (src/shell/updates.ts): its commit and that commit's time, which only grows along next, so a feed's
// newer build is the one with the later time (and on Android the version code, scripts/android-build.sh). From
// PARACHUTE_BUILD_AT / PARACHUTE_BUILD_COMMIT, else git; neither (a tarball) is build 0, which is offered nothing.
function git(...args: string[]) { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }
const BUILD = { at: Number(process.env.PARACHUTE_BUILD_AT || git("log", "-1", "--format=%ct")) || 0, commit: process.env.PARACHUTE_BUILD_COMMIT || git("rev-parse", "--short=7", "HEAD") };

// The app's content policy lives in src-tauri/tauri.conf.json (frame-src about: is what stops an applet frame from
// navigating). The dev and preview servers send the same policy, so the browser the tests drive behaves like the app.
const csp = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")).app?.security?.csp as Record<string, string> | string | null | undefined;
const cspHeader = typeof csp === "string" ? csp : csp ? Object.entries(csp).map(([k, v]) => `${k} ${v}`).join("; ") : null;
const headers = cspHeader ? { "Content-Security-Policy": cspHeader } : undefined;

// The note renderer lives in this repo (packages/surface-render, copied from parachute-surface; AUDIT.md), under its
// published name, so its imports read the same. Every build below (the app, the frame, the kits) resolves it here.
const sr = (p: string) => fileURLToPath(new URL(`./packages/surface-render/${p}`, import.meta.url));
const alias = [
  { find: /^@openparachute\/surface-render\/(styles\.css|rich-notes-kit\.css)$/, replacement: sr("$1") },
  { find: /^@openparachute\/surface-render\/(\w+)$/, replacement: sr("src/$1/index.ts") },
  { find: /^@openparachute\/surface-render$/, replacement: sr("src/index.ts") },
];

// Code the app puts inside sealed frames, each bundled once to an IIFE string (src/applet/kits): surface-client's
// VaultClient (from the Uni app's vite.config.ts), and React for applets written as TSX/JSX modules.
// The kit's own sheets (base.css, parts.css) are not in these: every frame has them in its head (src/kit/frameCss.ts).
const KIT_SHEET = /[\\/]src[\\/]kit[\\/](?:base|parts)\.css$/;
const noKitSheets: Plugin = {
  name: "no-kit-sheets",
  enforce: "pre",
  async resolveId(source, importer) {
    if (!importer || !source.endsWith(".css")) return null;
    const r = await this.resolve(source, importer, { skipSelf: true });
    return r && KIT_SHEET.test(r.id) ? "\0no-kit-sheet.css" : null;
  },
  load: (id) => (id === "\0no-kit-sheet.css" ? "" : null),
};
function iifeKit(id: string, entry: string, name: string): Plugin {
  return {
    name: id,
    resolveId: (source) => (source === id ? `\0${id}` : null),
    async load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const out = await build({
        configFile: false, logLevel: "silent", resolve: { alias },
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        plugins: [noKitSheets, react()],
        build: { write: false, minify: true, cssCodeSplit: false, lib: { entry: new URL(entry, import.meta.url).pathname, formats: ["iife"], name } },
      });
      const result = Array.isArray(out) ? out[0] : out;
      const files = "output" in result ? result.output : [];
      const code = files.flatMap((f) => (f.type === "chunk" ? [f.code] : []))[0] ?? "";
      // the note renderer's styles go in with the script (the frame's CSP allows inline styles, and loads nothing), at the
      // end of the head: they share the parts' layer with the kit's sheet and come after it there, as they did when the
      // parts' sheet was bundled with them (ahead of them)
      const css = files.filter((f) => f.type === "asset" && f.fileName.endsWith(".css")).map((f) => (f.type === "asset" ? String(f.source) : "")).join("\n");
      const withCss = css ? `(function(){var s=document.createElement("style");s.setAttribute("data-parachute-parts","");s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})();\n${code}` : code;
      return `export default ${JSON.stringify(withCss)};`;
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
        configFile: false, logLevel: "silent", plugins: [react()], resolve: { alias },
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
  plugins: [react(), iifeKit("virtual:vault-client-kit", "./src/applet/kits/vaultClientEntry.ts", "__UniVC"), iifeKit("virtual:react-kit", "./src/applet/kits/reactEntry.ts", "__ParachuteReact"), iifeKit("virtual:react-note-kit", "./src/applet/kits/reactNoteEntry.ts", "__ParachuteReactNote"), frameKit()],
  resolve: { alias },
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD__: JSON.stringify(BUILD) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, headers },
  preview: { headers },
  build: { target: "es2022" },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}", "packages/applet-kit/src/**/*.test.{ts,tsx}"], setupFiles: ["src/test-setup.ts"], globals: false },
});
