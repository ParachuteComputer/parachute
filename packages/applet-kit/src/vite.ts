// A website that is an applet, built by Vite: `plugins: [react(), parachuteApplet()]`. `import … from "parachute"`
// becomes the web kit (parachute.ts); the kit's note renderer and its styles resolve as in the app (vite.config.ts);
// React is one copy.
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const repo = here("../../../");

export function parachuteApplet(): Plugin {
  const sr = (p: string) => `${repo}packages/surface-render/${p}`;
  return {
    name: "parachute-applet",
    config: () => ({
      resolve: {
        alias: [
          { find: /^parachute$/, replacement: here("./parachute.ts") },
          { find: /^@openparachute\/surface-render\/(styles\.css|rich-notes-kit\.css)$/, replacement: sr("$1") },
          { find: /^@openparachute\/surface-render\/(\w+)$/, replacement: sr("src/$1/index.ts") },
          { find: /^@openparachute\/surface-render$/, replacement: sr("src/index.ts") },
        ],
        dedupe: ["react", "react-dom"],
      },
      server: { fs: { allow: [repo] } },
    }),
  };
}
