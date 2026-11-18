// The applets in this repo, as the app runs them: an imported name that the module also declares at its top level is a
// duplicate declaration, which the transpiler doesn't refuse; it rewrites every use of the name to the import instead
// (Room's media cache `shown` became the kit's `shown`, and every room stopped). Each applet is checked here.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "applets");
const files = readdirSync(dir).filter((f) => /\.(tsx|jsx)$/.test(f));

/** The names a module imports (`import { a, b as c } from "x"`, `import d from "x"`, `import * as e from "x"`). */
function imported(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/^import\s+([^;]+?)\s+from\s+["'][^"']+["'];?/gm)) {
    const spec = m[1].replace(/^type\s+/, "");
    const braces = /\{([^}]*)\}/.exec(spec);
    if (braces) for (const part of braces[1].split(",")) { const p = part.trim().replace(/^type\s+/, ""); if (p) out.push((p.split(/\s+as\s+/)[1] ?? p).trim()); }
    const head = spec.replace(/\{[^}]*\}/, "").split(",").map((x) => x.trim()).filter(Boolean);
    for (const h of head) out.push(h.replace(/^\*\s+as\s+/, ""));
  }
  return out;
}
/** The names a module declares at its top level (a line that starts with the declaration). */
const declared = (code: string) => [...code.matchAll(/^(?:export\s+(?:default\s+)?)?(?:const|let|var|function\*?|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);

describe("applets: no top-level name that is also imported", () => {
  it("finds the applets", () => expect(files.length).toBeGreaterThan(3));
  for (const f of files) it(f, () => {
    const code = readFileSync(join(dir, f), "utf8");
    const names = new Set(imported(code));
    expect(declared(code).filter((d) => names.has(d))).toEqual([]);
  });
  it("would have caught the shown that stopped every room", () => {
    const code = `import { shown } from "parachute";\nconst shown = new Map();\n`;
    expect(declared(code).filter((d) => new Set(imported(code)).has(d))).toEqual(["shown"]);
  });
});
