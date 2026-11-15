// The frame's bundle never contains the shell's keepers: what it imports, followed all the way down, reaches no module
// that holds sign-ins, tokens, grants, the self-test or the tap marks. (The sandbox is what stops a frame reaching the
// shell's storage; this keeps the built-in frame from even carrying that code.)
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src");
const FORBIDDEN = ["vault/store.ts", "vault/oauth.ts", "vault/client.ts", "vault/hooks.ts", "applet/grants.ts", "applet/useApplets.ts", "open/defaults.ts", "open/mark.ts", "open/status.ts", "shell/", "applet/selftest/", "views/"];

export function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^"']*?\sfrom\s+)?["'](\.[^"']+)["']/g)) {
      if (/^\s*import\s+type\b/.test(m[0])) continue;
      const base = join(dirname(file), m[1]);
      const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(p) && !p.endsWith("/"));
      if (hit && /\.tsx?$/.test(hit)) walk(hit);
    }
  };
  walk(join(ROOT, entry));
  return [...seen].map((f) => relative(ROOT, f));
}

describe("the frame's bundle", () => {
  it("reaches none of the shell's keepers", () => {
    const files = reachable("frame/entry.tsx");
    expect(files).toContain("frame/bridge.ts");
    expect(files).toContain("open/resolve.ts");
    expect(files.filter((f) => FORBIDDEN.some((x) => f === x || f.startsWith(x)))).toEqual([]);
  });
});
