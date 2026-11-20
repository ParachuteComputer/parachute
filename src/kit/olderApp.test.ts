// An applet lives in the vault and the app on each device updates later, so a shipped applet meets older apps. A part
// of the kit an older app doesn't have arrives there as undefined: an applet that imports one falls back when it is
// missing (`const Part = KitPart ?? …`), or it stops on that app. Found 11-18: Rooms' room view stopped on build
// 2934228 ("Cannot read properties of undefined (reading 'find')") once its record used `link`.
// The floor: the kit of 11-20 (T-476, the kit as the standard library). The shipped applets are written on it, so they
// need an app from then or later (docs/WRITE-AN-APPLET.md "Older apps"): their records go to a vault only after the
// person's devices have that app. A part added after the floor needs a fallback again.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PART_NAMES } from "../applet/kits/modules";

const KIT_FLOOR = [
  "Button", "Card", "Days", "Empty", "Field", "Link", "Linked", "List", "Loading", "Note", "Page", "Problem", "Record", "Search", "Tabs", "Write",
  "link", "toast", "useSaved", "useTheme", "useTranscripts", "voiceNote", "when",
];
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
  it("the list names only parts there are", () => { for (const p of KIT_FLOOR) expect(PART_NAMES as readonly string[]).toContain(p); });
  it.each(shipped)("%s falls back for each newer part", (f) => {
    const src = readFileSync(join(dir, f), "utf8");
    for (const { part, as } of partsOf(src).filter((x) => !KIT_FLOOR.includes(x.part))) {
      expect(as, `${f}: ${part} is newer than the floor: import it under another name and fall back`).not.toBe(part);
      expect(src, `${f}: ${part} needs a fallback (\`${as} ?? …\`)`).toMatch(new RegExp(`\\b${as}\\s*\\?\\?`));
    }
  });
});
