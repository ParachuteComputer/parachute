// The guide's parts table names exactly what the kit gives applets (a promise each), and the frame's library has them too.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PART_NAMES } from "../applet/kits/modules";
import * as lib from "../frame/lib";

const guide = readFileSync(join(process.cwd(), "docs", "WRITE-AN-APPLET.md"), "utf8");
const table = guide.slice(guide.indexOf("### The parts"), guide.indexOf("## A worked example"));

describe("the parts", () => {
  it("the guide lists every part the kit gives, and no other", () => {
    const named = [...table.matchAll(/^\| `<?(\w+)[ (>]/gm)].map((m) => m[1]);
    expect(named.sort()).toEqual([...PART_NAMES].sort());
  });
  it("a frame of the person's can use the same parts", () => {
    for (const p of PART_NAMES.filter((n) => n !== "useTheme")) expect(lib, p).toHaveProperty(p);
  });
});
