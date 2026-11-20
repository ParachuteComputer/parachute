// An applet lives in the vault and the app on each device updates later, so a shipped applet meets older apps
// (docs/design/VERSIONS.md). Each kit part has the level of the app it came in (kits/modules.ts PART_LEVEL); a record
// says the oldest level it runs on (`needs`, the floor when it says none). A part above that is undefined on an older
// app, so the applet falls back for it (`const Part = KitPart ?? …`), or it raises its `needs` and an older app says
// "Update Parachute to use …" instead of running it. Found 11-18: Rooms' room view stopped on build 2934228 ("Cannot
// read properties of undefined (reading 'find')") once its record used `link`.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PART_LEVEL, PART_NAMES } from "../applet/kits/modules";
import { APP_LEVEL, FLOOR, levelNeeded } from "../applet/level";

const dir = join(process.cwd(), "applets");
const shipped = readdirSync(dir).filter((f) => /\.(tsx|jsx)$/.test(f));

/** The parts an applet imports from "parachute", each with the name it uses for it. */
function partsOf(src: string): { part: string; as: string }[] {
  const m = /import\s*\{([^}]*)\}\s*from\s*"parachute"/.exec(src);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [part, as] = s.split(/\s+as\s+/); return { part, as: as ?? part }; })
    .filter((x) => (PART_NAMES as readonly string[]).includes(x.part));
}
/** What a shipped applet's record says it needs (applets/<name>.json `fields.needs`). */
function needsOf(f: string): number {
  const json = join(dir, f.replace(/\.(tsx|jsx)$/, ".json"));
  if (!existsSync(json)) return FLOOR;
  return levelNeeded((JSON.parse(readFileSync(json, "utf8")) as { fields?: { needs?: unknown } }).fields?.needs);
}

describe("levels: this app, its parts, the floor", () => {
  it("every part came in at the floor or later, and no later than this app", () => {
    for (const [p, l] of Object.entries(PART_LEVEL)) { expect(l, p).toBeGreaterThanOrEqual(FLOOR); expect(l, p).toBeLessThanOrEqual(APP_LEVEL); }
  });
  it("a record that says nothing needs the floor; a level it can't read is more than any app", () => {
    expect(levelNeeded(undefined)).toBe(FLOOR);
    expect(levelNeeded(3)).toBe(3);
    for (const odd of ["2", 2.5, 0, -1, { app: 2 }]) expect(levelNeeded(odd), JSON.stringify(odd)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("shipped applets still run on every app their record lets in", () => {
  it.each(shipped)("%s falls back for each part newer than its needs", (f) => {
    const src = readFileSync(join(dir, f), "utf8"), needs = needsOf(f);
    expect(needs, `${f}: needs ${needs} is past this app (${APP_LEVEL})`).toBeLessThanOrEqual(APP_LEVEL);
    for (const { part, as } of partsOf(src).filter((x) => PART_LEVEL[x.part as keyof typeof PART_LEVEL] > needs)) {
      expect(as, `${f}: ${part} is newer than its needs (${needs}): import it under another name and fall back, or raise needs`).not.toBe(part);
      expect(src, `${f}: ${part} needs a fallback (\`${as} ?? …\`), or raise needs`).toMatch(new RegExp(`\\b${as}\\s*\\?\\?`));
    }
  });
});
