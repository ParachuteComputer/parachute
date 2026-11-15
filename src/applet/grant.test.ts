import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import { allowsNote, grantKey, grantLines, grantOf } from "./grant";
import { RECIPES } from "./fixtures";

const m = (() => { const r = parseManifest(RECIPES); if (!r.ok) throw new Error(r.error); return r.manifest; })();
const OPENS = [{ type: "recipe", path: "Recipes/" }];

describe("the grant", () => {
  it("asks again when what it opens changes, and not for a reorder or a rename", async () => {
    const base = await grantKey(grantOf(m, "recipes", OPENS), "Applets/Recipes");
    expect(await grantKey(grantOf(m, "recipes", []), "Applets/Recipes")).not.toBe(base);
    expect(await grantKey(grantOf(m, "recipes", [{ type: "dish", path: "Recipes/" }]), "Applets/Recipes")).not.toBe(base);
    expect(await grantKey(grantOf(m, "recipes", [...OPENS, { type: "recipe", path: "Recipes/", screen: "home" }]), "Applets/Recipes")).not.toBe(base);
    expect(await grantKey(grantOf({ ...m, name: "Cookbook" }, "recipes", OPENS), "Applets/Recipes")).toBe(base);
    const two = [{ type: "a", path: "Recipes/" }, { type: "b", path: "Recipes/" }];
    expect(await grantKey(grantOf(m, "recipes", two), "Applets/Recipes")).toBe(await grantKey(grantOf(m, "recipes", [...two].reverse()), "Applets/Recipes"));
  });
  it("asks again when the note moves or the vault differs", async () => {
    const base = await grantKey(grantOf(m, "recipes", OPENS), "Applets/Recipes");
    expect(await grantKey(grantOf(m, "recipes", OPENS), "Applets/Recipes 2")).not.toBe(base);
    expect(await grantKey(grantOf(m, "other", OPENS), "Applets/Recipes")).not.toBe(base);
  });
  it("shows the two rows for what it opens", () => {
    const lines = grantLines(grantOf(m, "recipes", OPENS), "Applets/").map((l) => l.text);
    expect(lines).toEqual(["Read, add and change notes in Recipes/", "Open recipe notes in Recipes/ when you tap one", "Tag the notes it adds in Recipes/ as recipe"]);
  });
  it("judges a note on its own path", () => {
    const g = grantOf(m, "recipes", OPENS);
    expect(allowsNote(g, "read", "Recipes/Soup")).toBe(true);
    expect(allowsNote(g, "read", "Recipes")).toBe(false);
    expect(allowsNote(g, "read", "Recipes/../Journal/x")).toBe(false);
    expect(allowsNote(g, "read", "Recipes/%2e%2e/x")).toBe(false);
    expect(allowsNote(g, "read", "Journal/x")).toBe(false);
  });
});
