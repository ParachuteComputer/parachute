import { describe, expect, it } from "vitest";
import { candidates, resolve, type Status } from "./resolve";
import type { AppletEntry } from "../applet/discovery";
import { parseManifest } from "../applet/manifest";
import { RECIPES } from "../applet/fixtures";

const m = (() => { const r = parseManifest(RECIPES); if (!r.ok) throw new Error(r.error); return r.manifest; })();
const applet = (noteId: string, opens = [{ type: "recipe", path: "Recipes/" }]): AppletEntry => ({ manifest: { ...m, id: noteId, name: noteId }, vault: "v", noteId, path: `Applets/${noteId}`, opens, app: [], embeds: [], services: [] });
const recipe = { id: "n1", path: "Recipes/Soup", tags: ["recipe"] };
const st = (map: Record<string, Status>) => (e: AppletEntry) => map[e.noteId] ?? "none";

describe("candidates", () => {
  it("are the applets whose opens claims one of the note's types in its folder", () => {
    const a = applet("A"), b = applet("B", [{ type: "recipe", path: "Other/" }]), c = applet("C", [{ type: "dish", path: "Recipes/" }]);
    expect(candidates(recipe, [a, b, c], st({})).map((x) => x.entry.noteId)).toEqual(["A"]);
  });
  it("count a type beneath the claimed one", () => {
    expect(candidates({ ...recipe, tags: ["recipe/soup"] }, [applet("A")], st({}))).toHaveLength(1);
  });
  it("never claim an applet's own note or any HTML note", () => {
    expect(candidates({ id: "A", path: "Recipes/x", tags: ["recipe"] }, [applet("A")], st({}))).toHaveLength(0);
    expect(candidates({ id: "n", path: "Recipes/x", tags: ["recipe"], extension: "html" }, [applet("A")], st({}))).toHaveLength(0);
    expect(candidates({ id: "n", path: "Recipes/x", tags: ["recipe", "applet"] }, [applet("A")], st({}))).toHaveLength(0);
  });
  it("never claim by a role tag of the vault", () => {
    const pins = applet("P", [{ type: "favourite", path: "Recipes/" }]);
    expect(candidates({ ...recipe, tags: ["favourite"] }, [pins], st({}), ["favourite"])).toHaveLength(0);
    expect(candidates({ ...recipe, tags: ["favourite"] }, [pins], st({}), ["pinned"])).toHaveLength(1);
  });
});

describe("resolve", () => {
  const A = applet("A"), B = applet("B");
  const dec = (s: Record<string, Status>, d: Record<string, string> = {}) => resolve(candidates(recipe, [A, B], st(s)), d);
  it("1. a default naming an ok applet opens it", () => expect(dec({ A: "ok", B: "ok" }, { recipe: "B" })).toMatchObject({ kind: "applet", by: "default", candidate: { entry: { noteId: "B" } } }));
  it("1. a default naming the vault view opens it, even with one ok applet", () => expect(dec({ A: "ok" }, { recipe: "vault" })).toEqual({ kind: "vault", line: null, by: "default" }));
  it("1. a default naming an applet that is gone falls through", () => expect(dec({ A: "ok" }, { recipe: "Z" })).toMatchObject({ kind: "applet", by: "only", candidate: { entry: { noteId: "A" } } }));
  it("1. a default naming an applet that isn't ok falls through", () => expect(dec({ A: "ok", B: "updated" }, { recipe: "B" })).toMatchObject({ kind: "applet", by: "only", candidate: { entry: { noteId: "A" } } }));
  it("2. exactly one ok applet opens it", () => expect(dec({ A: "ok", B: "none" })).toMatchObject({ kind: "applet", by: "only", candidate: { entry: { noteId: "A" } } }));
  it("3. several ok applets: ask", () => expect(dec({ A: "ok", B: "ok" })).toMatchObject({ kind: "ask" }));
  it("4. none ok, one never allowed: the vault view with its line", () => expect(dec({ B: "off" })).toMatchObject({ kind: "vault", line: { status: "none", candidate: { entry: { noteId: "A" } }, others: [] } }));
  it("4. none ok, two never allowed: the line names both", () => expect(dec({})).toMatchObject({ kind: "vault", line: { status: "none", candidate: { entry: { noteId: "A" } }, others: [{ entry: { noteId: "B" } }] } }));
  it("4. none ok, one changed since allowed: the vault view with that line", () => expect(dec({ A: "updated", B: "off" })).toMatchObject({ kind: "vault", line: { status: "updated" } }));
  it("4. a changed applet's line comes before one never allowed", () => expect(dec({ A: "none", B: "updated" })).toMatchObject({ kind: "vault", line: { status: "updated", candidate: { entry: { noteId: "B" } } } }));
  it("4. applets off on this device: the vault view, no line", () => expect(dec({ A: "off", B: "off" })).toEqual({ kind: "vault", line: null }));
  it("1. a note of two types whose defaults disagree: ask, whichever applet comes first", () => {
    const R = applet("R"), M = applet("M", [{ type: "menu", path: "Recipes/" }]);
    const both = { ...recipe, tags: ["recipe", "menu"] };
    for (const order of [[R, M], [M, R]]) {
      expect(resolve(candidates(both, order, st({ R: "ok", M: "ok" })), { recipe: "R", menu: "M" })).toMatchObject({ kind: "ask" });
      expect(resolve(candidates(both, order, st({ R: "ok", M: "ok" })), { recipe: "R", menu: "vault" })).toMatchObject({ kind: "ask" });
      // defaults that agree still open straight away
      expect(resolve(candidates(both, order, st({ R: "ok", M: "ok" })), { recipe: "R", menu: "R" })).toMatchObject({ kind: "applet", by: "default", candidate: { entry: { noteId: "R" } } });
    }
  });
  it("no candidates: the vault view, no line", () => expect(resolve([], {})).toEqual({ kind: "vault", line: null }));
});
