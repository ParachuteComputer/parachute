// An applet of this repo, or one of yours, as a website you link your Parachute to:
//   APPLET=applets/starter npx vite --config packages/applet-kit/site/vite.config.ts        (dev)
//   APPLET=../my-applet/applet npx vite build --config packages/applet-kit/site/vite.config.ts  (dist/ to host)
// APPLET is the record's stem: <stem>.json (its id and name) and its code, <stem>.tsx or .jsx.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { parachuteApplet } from "../src/vite.ts";

const stem = resolve(process.env.APPLET ?? "applets/starter");
const code = ["tsx", "jsx"].map((e) => `${stem}.${e}`).find((f) => existsSync(f));
if (!code) throw new Error(`No ${stem}.tsx or .jsx`);
const applet = (JSON.parse(readFileSync(`${stem}.json`, "utf8")) as { fields: { applet: { id: string; name: string } } }).fields.applet;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), parachuteApplet(), { name: "applet-entry", config: () => ({ resolve: { alias: [{ find: /^applet-entry$/, replacement: code }] } }) }],
  define: { "import.meta.env.VITE_APPLET_ID": JSON.stringify(applet.id), "import.meta.env.VITE_APPLET_NAME": JSON.stringify(applet.name) },
  build: { outDir: resolve(process.env.OUT ?? `dist-web/${applet.id}`), emptyOutDir: true },
  // the hub sends the visitor back to /oauth/callback: the dev server and the preview answer it with the page
  appType: "spa",
});
