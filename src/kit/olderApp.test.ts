// An applet lives in the vault and the app on each device updates later, so a shipped applet meets older apps. A part
// of the kit the first builds didn't have (PARTS_BEFORE_NOTE_LINKS, as in build 2934228) arrives there as undefined:
// an applet that imports one falls back when it is missing (`const Part = KitPart ?? …`), or it stops on that app.
// Found 11-18: Rooms' room view stopped on build 2934228 ("Cannot read properties of undefined (reading 'find')")
// once its record used `link`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PART_NAMES } from "../applet/kits/modules";

const PARTS_BEFORE_NOTE_LINKS = ["Card", "Days", "Empty", "Field", "List", "Note", "useTheme"];
const dir = join(process.cwd(), "applets");
const shipped = readdirSync(dir).filter((f) => /\.(tsx|jsx)$/.test(f));

/** The parts an applet imports from "parachute", each with the name it uses for it. */
function partsOf(src: string): { part: string; as: string }[] {
  const m = /import\s*\{([^}]*)\}\s*from\s*"parachute"/.exec(src);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [part, as] = s.split(/\s+as\s+/); return { part, as: as ?? part }; })
    .filter((x) => (PART_NAMES as readonly string[]).includes(x.part));
}

describe("shipped applets still run on an app from before a part they use", () => {
  it("the list names only parts there are", () => { for (const p of PARTS_BEFORE_NOTE_LINKS) expect(PART_NAMES as readonly string[]).toContain(p); });
  it.each(shipped)("%s falls back for each newer part", (f) => {
    const src = readFileSync(join(dir, f), "utf8");
    for (const { part, as } of partsOf(src).filter((x) => !PARTS_BEFORE_NOTE_LINKS.includes(x.part))) {
      expect(as, `${f}: ${part} is newer than the first builds: import it under another name and fall back`).not.toBe(part);
      expect(src, `${f}: ${part} needs a fallback (\`${as} ?? …\`)`).toMatch(new RegExp(`\\b${as}\\s*\\?\\?`));
    }
  });
});
