// @vitest-environment node
// The bundler (scripts/bundle-applet.ts) on a real project of several files: one module the checker passes, with only
// the frame's imports left; and a stylesheet said, not silently dropped.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleApplet } from "./bundle";
import { checkAppletRecord, requiresOf } from "./check";
import { importsOf } from "./imports";
import { transpile } from "./code";

const FIXTURE = join(process.cwd(), "e2e", "fixtures", "bundled");
const meta = { path: "Applets/Shelf", extension: "jsx", tags: ["applet"], fields: { applet: { contract: 2, id: "shelf", name: "Shelf", access: [{ vault: "here", allow: [{ path: "Shelf/", verbs: ["read"] }] }] }, needs: 3 } };

describe("bundleApplet", () => {
  it("makes a project of several files (and an npm package) one module the frame loads", async () => {
    const r = await bundleApplet(join(FIXTURE, "src", "main.tsx"));
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const compiled = await transpile(r.code, "jsx");
    if (!compiled.ok) throw new Error(compiled.error);
    // what's left to load is the frame's own: no file of the project, no npm package
    expect(requiresOf(compiled.js).sort()).toEqual(["parachute", "react", "react/jsx-runtime"]);
    expect(r.code).toContain("14 days"); // ms, folded in
    const checked = await checkAppletRecord({ ...meta, body: r.code });
    expect(checked.errors).toEqual([]);
    expect(checked.ok).toBe(true);
  }, 30_000);

  it("refuses a stylesheet or a picture, saying why, rather than dropping it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-applet-"));
    writeFileSync(join(dir, "look.css"), ".x { color: red }");
    writeFileSync(join(dir, "main.tsx"), `import "./look.css";\nexport default function A() { return <p className="x">hi</p>; }\n`);
    const r = await bundleApplet(join(dir, "main.tsx"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/look\.css .*can't come along/);
  });

  /** A throwaway project: its files, and npm packages in its node_modules (each name → its index.js). */
  function project(files: Record<string, string>, packages: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "bundle-applet-"));
    writeFileSync(join(dir, "package.json"), '{"name":"p","private":true}');
    for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
    for (const [name, text] of Object.entries(packages)) {
      mkdirSync(join(dir, "node_modules", name), { recursive: true });
      writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, main: "index.js" }));
      writeFileSync(join(dir, "node_modules", name, "index.js"), text);
    }
    return dir;
  }

  it("says every import at the top, where the frame reads them, past npm code that would hide one", async () => {
    // a package whose regex holds a quote reads, to the frame's reader, as a string that runs on (imports.ts)
    const dir = project({ "main.tsx": `import Foo from "component:foo";\nimport fix from "quotedep";\nexport default function A() { return <Foo text={fix('a"b')} />; }\n` }, { quotedep: `module.exports = (s) => s.replace(/"/g, "'");` });
    for (const minify of [false, true]) {
      const r = await bundleApplet(join(dir, "main.tsx"), { minify });
      if (!r.ok) throw new Error(r.errors.join("\n"));
      expect(importsOf(r.code)).toEqual(["foo"]);
      expect(r.imports).toEqual(["component:foo", "react/jsx-runtime"]);
    }
  });

  it("refuses a path into the frame's packages it doesn't give, from the project or a package in it", async () => {
    const dir = project({ "main.tsx": `import render from "ssr";\nexport default function A() { return <p>{String(render)}</p>; }\n` }, { ssr: `module.exports = require("react-dom/server");` });
    const r = await bundleApplet(join(dir, "main.tsx"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/react-dom\/server .*isn't one the frame gives/);
  });

  it("builds for production, awaits at its top level, and writes no path of the machine it ran on", async () => {
    const dir = project({ "main.tsx": `import mode from "modal";\nconst ready = await Promise.resolve(mode);\nexport default function A() { return <p>{ready}</p>; }\n` }, { modal: `if (process.env.NODE_ENV === "production") module.exports = require("./prod.js"); else module.exports = require("./dev.js");` });
    writeFileSync(join(dir, "node_modules", "modal", "prod.js"), `module.exports = "PRODBUILD";`);
    writeFileSync(join(dir, "node_modules", "modal", "dev.js"), `module.exports = "DEVBUILD";`);
    const r = await bundleApplet(join(dir, "main.tsx"));
    if (!r.ok) throw new Error(r.errors.join("\n"));
    // the package's production build, and only that
    expect(r.code).toContain("PRODBUILD");
    expect(r.code).not.toContain("DEVBUILD");
    expect(r.code).not.toContain(tmpdir());
    expect(r.code).not.toMatch(/\.\.\//);
  });
});
