// A Mac's disk (and Windows') doesn't tell "frameHost.ts" from "FrameHost.tsx": there an import of "./FrameHost" can
// find either one, and the Mac build failed on exactly that. Two modules in one folder must differ by more than case.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sameButCase(dir: string, out: string[] = []): string[] {
  const seen = new Map<string, { stem: string; name: string }>();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const stem = e.isDirectory() ? e.name : e.name.replace(/\.[^.]+$/, "");
    const other = seen.get(stem.toLowerCase());
    if (other !== undefined && other.stem !== stem) out.push(`${join(dir, other.name)} / ${join(dir, e.name)}`);
    else seen.set(stem.toLowerCase(), { stem, name: e.name });
    if (e.isDirectory()) sameButCase(join(dir, e.name), out);
  }
  return out;
}

describe("file names", () => {
  it("no two modules in a folder differ only by case", () => {
    expect(["src", "packages", "e2e"].flatMap((d) => sameButCase(d))).toEqual([]);
  });
});
