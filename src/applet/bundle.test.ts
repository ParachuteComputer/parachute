// @vitest-environment node
// The bundler (scripts/bundle-applet.ts) on a real project of several files: one module the checker passes, with only
// the frame's imports left; and a stylesheet said, not silently dropped.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleApplet } from "./bundle";
import { checkAppletRecord, requiresOf } from "./check";
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
});
