import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import { claimOf, parseOpens, withoutRoles } from "./opens";
import { RECIPES } from "./fixtures";

const ok = (raw: unknown) => { const r = parseManifest(raw); if (!r.ok) throw new Error(r.error); return r.manifest; };
const refused = (raw: unknown, why: RegExp) => { const r = parseManifest(raw); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(why); };
const withRule = (rule: unknown) => ({ ...RECIPES, search: [], access: [{ vault: "here", allow: [rule] }] });

describe("parseManifest", () => {
  it("reads what the Uni app reads: own: false, and a type beside a search's folder", () => {
    expect(ok({ ...RECIPES, access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read"], own: false }] }] }).allow).toEqual([{ path: "Recipes/", verbs: ["read"] }]);
    expect(ok({ ...RECIPES, search: [{ what: "soups", vault: "here", type: "recipe", path: "Recipes/" }] }).search).toEqual([{ what: "soups", type: "recipe", path: "Recipes/" }]);
  });
  it("reads today's Recipes manifest unchanged", () => {
    const m = ok(RECIPES);
    expect(m).toMatchObject({ id: "recipes", name: "Recipes", glyph: "❀", allow: [{ path: "Recipes/", verbs: ["read", "create", "update"] }], screens: [{ id: "home", name: "Recipes" }] });
    expect(m.search).toEqual([{ what: "recipes", path: "Recipes/" }]);
  });
  it.each([
    [{ ...RECIPES, opens: [] }, /key contract 2 doesn't know/],
    [{ ...RECIPES, contract: 1 }, /unsupported contract/],
    [{ ...RECIPES, id: "Recipes" }, /kebab-case/],
    [{ ...RECIPES, name: "Rec​ipes" }, /one short visible line/],
    [{ ...RECIPES, access: [{ door: "mail", ops: ["read"] }] }, /door/],
    [{ ...RECIPES, access: [{ vault: "home", allow: [{ path: "Recipes/", verbs: ["read"] }] }] }, /must be here/],
    [withRule({ path: "Recipes/", verbs: ["read", "delete"] }), /can't delete/],
    [withRule({ type: "recipe", verbs: ["read"] }), /works by folder/],
    [withRule({ path: "Recipes/", verbs: ["read"], own: true }), /works by folder/],
    [withRule({ path: "../Recipes/", verbs: ["read"] }), /plain folder/],
    [withRule({ path: ".parachute/", verbs: ["read"] }), /\.parachute\//],
    [withRule({ path: ".Parachute/settings/", verbs: ["read"] }), /\.parachute\//],
    [{ ...RECIPES, reach: [{ room: "abc", verbs: ["read"] }] }, /rooms are named on the relay service/],
    [{ ...RECIPES, reach: ["voice", "voice"] }, /twice/],
    [{ ...RECIPES, reach: ["camera"] }, /reach is a list of voice/],
    [{ ...RECIPES, reach: "voice" }, /short list/],
    [{ ...RECIPES, search: [{ what: "notes", vault: "here", path: "Journal/" }] }, /can't read them/],
  ])("refuses %j", (raw, why) => refused(raw, why));
});

describe("parseOpens", () => {
  const m = ok(RECIPES);
  it("reads what Recipes opens", () => {
    expect(parseOpens([{ type: "recipe", path: "Recipes/" }], m)).toEqual({ ok: true, opens: [{ type: "recipe", path: "Recipes/" }] });
    expect(parseOpens([{ type: "recipe/soup", path: "Recipes/Soups/", screen: "home" }], m)).toEqual({ ok: true, opens: [{ type: "recipe/soup", path: "Recipes/Soups/", screen: "home" }] });
    expect(parseOpens(undefined, m)).toEqual({ ok: true, opens: [] });
  });
  const no = (raw: unknown, why: RegExp) => { const r = parseOpens(raw, m); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(why); };
  it("refuses a folder outside what it reads", () => no([{ type: "recipe", path: "Journal/" }], /can't read/));
  it("refuses *", () => no([{ type: "*", path: "Recipes/" }], /only the vault view/));
  it("refuses an unknown screen", () => no([{ type: "recipe", path: "Recipes/", screen: "cook" }], /screens/));
  it("refuses a ninth entry", () => no(Array.from({ length: 9 }, (_, i) => ({ type: `t${i}`, path: "Recipes/" })), /more than 8/));
  it("refuses an unknown key in an entry, which refuses the whole list", () => no([{ type: "recipe", path: "Recipes/" }, { type: "dish", path: "Recipes/", icon: "x" }], /\{type, path, screen\?\}/));
  it.each(["applet", "Applet", "APPLET", "applet/x", "view", "View", "capture", "cApTuRe", "parachute", "Parachute-settings", "parachuteX"])("refuses the reserved type %s", (type) =>
    no([{ type, path: "Recipes/" }], /app's own type/));
  it.each(["Applets/", "applets/x/", ".parachute/"])("refuses the reserved folder %s, for being the app's own", (path) => {
    const wide = ok({ ...RECIPES, search: [], access: [{ vault: "here", allow: [{ path: "Applets/", verbs: ["read"] }, { path: "applets/", verbs: ["read"] }, { path: "Recipes/", verbs: ["read"] }] }] });
    const r = parseOpens([{ type: "recipe", path }], wide);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/app's own folder/);
  });
  it("claims only a note plainly inside the folder, as the vault module judges it", () => {
    const opens = [{ type: "recipe", path: "Recipes/" }];
    expect(claimOf(opens, { path: "Recipes/Soup", tags: ["recipe"] })).not.toBeNull();
    for (const path of ["Recipes//x", "Recipes/../Journal/Secret", "Recipes/./x", "Recipes/a\\b", "Recipes/.md", "Recipes"])
      expect(claimOf(opens, { path, tags: ["recipe"] }), path).toBeNull();
  });
  it("drops the vault's role tags", () => {
    expect(withoutRoles([{ type: "recipe", path: "Recipes/" }, { type: "pinned", path: "Recipes/" }, { type: "pinned/x", path: "Recipes/" }], ["pinned"])).toEqual([{ type: "recipe", path: "Recipes/" }]);
    // any letter case, and a type a role sits beneath (it would claim the role's notes)
    expect(withoutRoles([{ type: "favourite", path: "Recipes/" }, { type: "task", path: "Recipes/" }], ["Favourite", "task/urgent"])).toEqual([]);
  });
  it("refuses a list that isn't a list", () => no({ type: "recipe" }, /must be a list/));
});
