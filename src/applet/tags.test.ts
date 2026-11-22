// The app reads some tags itself (an applet's note is tagged `applet`). Every such tag must be one no applet can
// claim, or an applet could take over how the app's own notes open. This scans the app's source for tag literals
// it compares against, and fails on one that isn't reserved. It sees only tags written inline: a tag held in a
// constant first would escape it, so the app keeps tag literals inline.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isReservedType } from "./opens";

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/fixtures/.test(f) ? [p] : []; });
// `tags.includes("x")`, `hasType(tags, "x")`, `tag === "x"`, `t === "x" || t.startsWith("x/")` on a tag
const PATTERNS = [/tags[^;\n]{0,40}?\.includes\(\s*"([^"]+)"\s*\)/g, /hasType\([^,]+,\s*"([^"]+)"\)/g, /(?<!typeof )\b(?:tag|t)\s*===\s*"([^"]+)"/g, /\b(?:tag|t)\.startsWith\("([^"/]+)\//g];

/** Tags the app reads only for a hint, never for how a note opens or what may run: an applet claiming one changes
 *  nothing but that hint. Each says where and why. */
const HINTS: Record<string, string> = {
  guide: "the list's Start here (src/frame/views/Launcher.tsx): a hub's #guide notes aren't the person's own, so Start here shows until something of theirs is in the home",
};

describe("tags the app reads", () => {
  it("are all reserved", () => {
    const found = new Map<string, string>();
    for (const f of files(join(import.meta.dirname, ".."))) {
      const src = readFileSync(f, "utf8");
      for (const re of PATTERNS) for (const m of src.matchAll(re)) found.set(m[1], f);
    }
    expect(found.size).toBeGreaterThan(0);
    for (const [tag, file] of found) expect(isReservedType(tag) || tag in HINTS, `${file} reads the tag "${tag}", which an applet could claim`).toBe(true);
  });
});
