// What a note link leads to: the shell's answer from the vaults it holds, and what a frame can learn from it.
import { describe, expect, it } from "vitest";
import { resolveLink, wikiPaths, type ResolveDeps } from "./resolve";
import type { VaultRecord } from "../vault/store";

const ID = "01KA3Z9V6B2W8XQJ4M7N5P0R1S", OTHER = "01KA3Z9V6B2W8XQJ4M7N5P0R1T";
const rec = (vault: string, issuer = "https://hub.example", more: Partial<VaultRecord> = {}): VaultRecord =>
  ({ key: vault, issuer, vault, tokenEndpoint: "x", clientId: "x", accessToken: "x", scope: "", addedAt: "", ...more });
const kitchen = rec("kitchen"), cloud = rec("notes", "https://hub.example", { key: "notes", url: "https://cloud.example/vault/notes" });
/** The notes each vault holds, by id and by path: what the hub answers for each (it also matches a title, or another case). */
const notes: Record<string, Record<string, { id: string; path: string; code?: boolean }>> = {
  kitchen: { [ID]: { id: ID, path: "Recipes/Tomato toast" }, "Recipes/Tomato toast": { id: ID, path: "Recipes/Tomato toast" }, "Recipes/Rice and beans": { id: OTHER, path: "Recipes/Rice and beans" } },
  notes: { [OTHER]: { id: OTHER, path: "Notes/x" } },
};
function deps(): ResolveDeps & { asked: string[] } {
  const asked: string[] = [];
  return { asked, vaults: () => [kitchen, cloud], here: () => kitchen, mayRead: (p) => p.startsWith("Recipes/"), find: async (r, p) => { asked.push(`${r.vault}:${p}`); const n = notes[r.vault]?.[p]; return n ? { id: n.id, path: n.path, code: n.code ?? false } : null; } };
}

describe("resolveLink", () => {
  it("a short form of a held vault's note opens it here", async () => {
    expect(await resolveLink(`kitchen:${ID}`, undefined, deps())).toEqual({ answer: "note", href: `/v/kitchen/n/${ID}` });
  });
  it("a vault name this device doesn't hold is nothing: no guess, and no read", async () => {
    const d = deps();
    expect(await resolveLink(`uni:${ID}`, undefined, d)).toEqual({ answer: null });
    expect(d.asked).toEqual([]);
  });
  it("a held vault's name with a note that isn't there is nothing too, so asking can't tell which vaults are held", async () => {
    expect(await resolveLink(`kitchen:${OTHER}`, undefined, deps())).toEqual({ answer: null });
  });
  it("a note's address on a held vault opens here, by its hub or by where a hosted vault lives", async () => {
    expect(await resolveLink(`https://hub.example/vault/kitchen/view/${ID}`, undefined, deps())).toEqual({ answer: "note", href: `/v/kitchen/n/${ID}` });
    expect(await resolveLink(`https://cloud.example/vault/notes/view/${OTHER}`, undefined, deps())).toEqual({ answer: "note", href: `/v/notes/n/${OTHER}` });
  });
  it("an address that names a path or a title, not an id, finds nothing in a held vault: no mapping notes outside the grant", async () => {
    notes.kitchen["Welcome"] = { id: ID, path: "Welcome" };
    notes.kitchen["Passwords"] = { id: OTHER, path: "Passwords" };
    const d = deps();
    for (const name of ["Welcome", "Passwords"]) expect((await resolveLink(`https://hub.example/vault/kitchen/view/${name}`, undefined, d)).answer).toBe("away");
    // not even asked: a word that isn't an id is a path or a title to the hub, and how fast it answers would say
    expect(d.asked).toEqual([]);
    // the same answer as a vault this device doesn't hold
    expect((await resolveLink("https://hub.example/vault/other/view/Welcome", undefined, deps())).answer).toBe("away");
  });
  it("an address of a vault or hub not held leads to the link's screen, which offers to add it", async () => {
    const r = await resolveLink(`https://other.example/vault/garden/view/${ID}`, undefined, deps());
    expect(r.answer).toBe("away");
    const inner = new URL(`http://app.invalid${r.answer === "away" ? r.href : ""}`).searchParams.get("url");
    expect(inner).toBe(`parachute://open?url=${encodeURIComponent(`https://other.example/vault/garden/view/${ID}`)}`);
    // the same vault's name on another hub is not this one
    expect((await resolveLink(`https://other.example/vault/kitchen/view/${ID}`, undefined, deps())).answer).toBe("away");
  });
  it("a wikilink is a note in the applet's own vault: by path, then beside the note it is in", async () => {
    expect(await resolveLink("[[Recipes/Tomato toast]]", undefined, deps())).toEqual({ answer: "note", href: `/v/kitchen/n/${ID}` });
    expect(await resolveLink("[[Rice and beans]]", "Recipes/Tomato toast", deps())).toEqual({ answer: "note", href: `/v/kitchen/n/${OTHER}` });
    expect(await resolveLink("[[Rice and beans]]", undefined, deps())).toEqual({ answer: null });
  });
  it("a wikilink outside the folders the applet may read isn't looked up: a path can be guessed", async () => {
    notes.kitchen["Journal/Private"] = { id: ID, path: "Journal/Private" };
    const d = deps();
    expect(await resolveLink("[[Journal/Private]]", undefined, d)).toEqual({ answer: null });
    expect(d.asked).toEqual([]);
  });
  it("a wikilink whose note the hub finds outside those folders (a title, another case) or in an applet's code is nothing", async () => {
    // a readable-looking path that the hub resolves by title to a note in Journal/, or to an applet's code
    notes.kitchen["Recipes/Plan"] = { id: OTHER, path: "Journal/Plan" };
    notes.kitchen["Recipes/Box"] = { id: OTHER, path: "Recipes/Box", code: true };
    expect(await resolveLink("[[Recipes/Plan]]", undefined, deps())).toEqual({ answer: null });
    expect(await resolveLink("[[Recipes/Box]]", undefined, deps())).toEqual({ answer: null });
  });
  it("a note in the applet's own vault whose hub can't be asked now is a link to it: off the tailnet, a room still shows Uni's links (T-476)", async () => {
    const own = { ...deps(), find: async () => { throw new TypeError("Load failed"); }, unreached: (r: VaultRecord) => r.key === "kitchen" };
    expect(await resolveLink(`kitchen:${ID}`, undefined, own)).toEqual({ answer: "note", href: `/v/kitchen/n/${ID}` });
    expect(await resolveLink(`https://hub.example/vault/kitchen/view/${ID}`, undefined, own)).toEqual({ answer: "note", href: `/v/kitchen/n/${ID}` });
    // still no guess: a vault name not held is nothing, and a wikilink (a path, which can be guessed) is nothing too
    expect(await resolveLink(`uni:${ID}`, undefined, own)).toEqual({ answer: null });
    expect(await resolveLink("[[Recipes/Tomato toast]]", undefined, own)).toEqual({ answer: null });
    // another vault held: its name would tell the applet which vaults are held, so it stays nothing (and an address, the
    // link's screen) until it can be asked
    expect(await resolveLink(`notes:${OTHER}`, undefined, own)).toEqual({ answer: null });
    expect((await resolveLink(`https://cloud.example/vault/notes/view/${OTHER}`, undefined, own)).answer).toBe("away");
    // and without being told, none counts
    expect(await resolveLink(`kitchen:${ID}`, undefined, { ...own, unreached: undefined })).toEqual({ answer: null });
    // the hub's own answer that the note isn't there stays nothing
    expect(await resolveLink(`kitchen:${OTHER}`, undefined, { ...deps(), unreached: () => true })).toEqual({ answer: null });
  });
  it("of two vaults by the applet's own name, the one that has the note wins over one that can't be asked", async () => {
    const old = rec("kitchen", "https://old.example", { key: "old" });
    const two = { ...deps(), vaults: () => [old, kitchen], here: () => old, unreached: (r: VaultRecord) => r.key === "old",
      find: async (r: VaultRecord, p: string) => { if (r.key === "old") throw new TypeError("Load failed"); const n = notes[r.vault]?.[p]; return n ? { id: n.id, path: n.path, code: false } : null; } };
    expect(await resolveLink(`kitchen:${ID}`, undefined, two)).toEqual({ answer: "note", href: `/v/kitchen/n/${ID}` });
    expect(await resolveLink(`kitchen:${OTHER}`, undefined, two)).toEqual({ answer: "note", href: `/v/old/n/${OTHER}` });
  });
  it("anything else is nothing", async () => {
    for (const raw of ["https://example.com/", "javascript:alert(1)", "/v/kitchen/n/x", ""]) expect(await resolveLink(raw, undefined, deps())).toEqual({ answer: null });
  });
});

describe("wikiPaths", () => {
  it("is the target, then beside the note", () => {
    expect(wikiPaths("Rice", "Recipes/Toast")).toEqual(["Rice", "Recipes/Rice"]);
    expect(wikiPaths("/Rice", undefined)).toEqual(["Rice"]);
    expect(wikiPaths("Recipes/Rice", "Recipes/Toast")).toEqual(["Recipes/Rice"]);
  });
  it("is nothing for a target that could climb out of a folder the applet may read", () => {
    for (const t of ["Recipes/../Journal/Private", "../Journal/Private", "Recipes/./x", "Recipes//x", "Recipes\\..\\x"]) expect(wikiPaths(t, "Recipes/Toast"), t).toEqual([]);
  });
});
