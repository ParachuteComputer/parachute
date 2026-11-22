// A section of Settings from an applet (settingsSection.ts): the field is checked strictly, someone else's applet has
// none, it is on the card and in the grant's key only when declared (every other applet's key and approval stay as
// they were), and a reader that doesn't know it lists the applet as before.
import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import { grantKey, grantLines, grantOf } from "./grant";
import { asksHash } from "./approvals";
import { readApplet } from "./discovery";
import { parseSettings } from "./settingsSection";
import { RECIPES } from "./fixtures";

const m = (() => { const r = parseManifest({ ...RECIPES, screens: [{ id: "home", name: "Recipes" }, { id: "use", name: "Use" }] }); if (!r.ok) throw new Error(r.error); return r.manifest; })();
const SECTION = { name: "Claude usage", screen: "use" };
const row = (fields: Record<string, unknown>) => ({ id: "n1", path: "Applets/Recipes", tags: ["applet"], metadata: { applet: { ...RECIPES, screens: [{ id: "home", name: "Recipes" }, { id: "use", name: "Use" }] }, ...fields } });

describe("a section of Settings", () => {
  it("is one heading and one of the applet's screens, nothing else", () => {
    expect(parseSettings(undefined, m)).toEqual({ ok: true, value: null });
    expect(parseSettings(SECTION, m)).toEqual({ ok: true, value: SECTION });
    for (const bad of [{ name: "Usage" }, { screen: "use" }, { ...SECTION, screen: "elsewhere" }, { ...SECTION, name: "" }, { ...SECTION, name: "x".repeat(41) },
      { ...SECTION, name: "two\nlines" }, { ...SECTION, name: "hidden​" }, { ...SECTION, also: 1 }, ["use"], "use"])
      expect(parseSettings(bad, m).ok, JSON.stringify(bad)).toBe(false);
  });
  it("is read for an applet of the person's own; a bad one costs the section, not the applet; someone else's has none", () => {
    const mine = readApplet(row({ settings: SECTION }), "home");
    expect(mine.ok && mine.entry.settings).toEqual(SECTION);
    const bad = readApplet(row({ settings: { name: "Usage", screen: "nowhere" } }), "home");
    expect(bad.ok && bad.entry.settings).toBeFalsy();
    expect(bad.ok && bad.entry.settingsError).toMatch(/screen/);
    const theirs = readApplet(row({ settings: SECTION }), "home", true);
    expect(theirs.ok && theirs.entry.settings).toBeFalsy();
  });
  it("is on the card, and in the grant's key only when declared: every other applet's key stays as it was", async () => {
    const without = await grantKey(grantOf(m, "home", []), "Applets/Recipes");
    expect(await grantKey(grantOf(m, "home", [], [], [], [], null), "Applets/Recipes")).toBe(without);
    const withIt = await grantKey(grantOf(m, "home", [], [], [], [], SECTION), "Applets/Recipes");
    expect(withIt).not.toBe(without);
    expect(await grantKey(grantOf(m, "home", [], [], [], [], { ...SECTION, name: "Claude use" }), "Applets/Recipes")).not.toBe(withIt);
    expect(grantLines(grantOf(m, "home", [], [], [], [], SECTION), "Applets/").map((l) => l.text)).toContain("Show a section in Settings, «Claude usage»: what it reads, nothing it changes");
  });
  it("is in the approval's hash only when declared: an approval made before it holds", async () => {
    const s = { hub: "https://hub.example", vault: "home", record: "n1", applet: "recipes" };
    const fields = { applet: RECIPES };
    expect(await asksHash(s, "Applets/Recipes", fields)).toBe(await asksHash(s, "Applets/Recipes", { ...fields, settings: undefined }));
    expect(await asksHash(s, "Applets/Recipes", { ...fields, settings: SECTION })).not.toBe(await asksHash(s, "Applets/Recipes", fields));
  });
});
