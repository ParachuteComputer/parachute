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
});
