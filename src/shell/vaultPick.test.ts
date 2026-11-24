// docs/ACCESS.md proposal 5, end to end inside the app: an applet given one vault of three reaches that one through
// every word that reaches across vaults (vaults, sharing, recent, changes, links), and the others through none; a tap
// (follow) still goes anywhere the device holds, telling the applet only whether it went. The shell's own modules run as
// they are (the vaults module over vaultsDeps, the app module over appDeps, the device's store of vaults); only the hub
// is faked, at the network, and every request it gets is written down.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter } from "../applet/router";
import { createVaultsModule, NOT_GIVEN } from "../applet/modules/vaults";
import { createAppModule } from "../applet/modules/app";
import { heldIn, reachOf } from "../applet/vaultPick";
import { originOf, saveVault, listVaults, type VaultRecord } from "../vault/store";
import { dropClient } from "../vault/client";
import { setWhose } from "../vault/whose";
import { setHome } from "./frameSource";
import { appDeps } from "./appDeps";
import { vaultsDeps } from "./vaultsDeps";

const HUB = "https://hub.example";
const ID = "01KA3Z9V6B2W8XQJ4M7N5P0R1S";
const asked: string[] = [];

function hold(vault: string): VaultRecord {
  const rec = saveVault({ issuer: HUB, vault, tokenEndpoint: `${HUB}/oauth/token`, clientId: "c", accessToken: "t", scope: `vault:${vault}:read vault:${vault}:write`, addedAt: "2026-11-23T00:00:00Z" });
  setWhose(rec, "mine");
  return rec;
}

beforeEach(() => {
  localStorage.clear();
  asked.length = 0;
  for (const v of ["kitchen", "letters", "pantry"]) hold(v);
  setHome("kitchen");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    asked.push(u.pathname);
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
    const rec = { id: u.searchParams.get("id") ?? ID, path: "Somewhere/A note", body: "secret", types: [], tags: [], fields: {}, createdAt: "2026-11-23T08:00:00Z", updatedAt: "2026-11-23T08:00:00Z" };
    if (/\/api\/records\/[^/]+$/.test(u.pathname)) return json(rec);
    if (/\/api\/records$/.test(u.pathname)) return json(u.searchParams.get("tag") ? [] : [rec]);
    if (/\/api\/(changes|activity)/.test(u.pathname)) return json({ changes: [], more: false });
    return json([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); for (const v of listVaults()) dropClient(v.key); });

/** Given only kitchen (its pick, or no pick: the home), as the applet screen builds it (views/useVaultPick.ts). */
const given = (k: string) => heldIn(listVaults(), reachOf([{ hub: HUB, vault: "kitchen" }], null, null), originOf).some((v) => v.key === k);
const reached = (vault: string) => asked.filter((p) => p.startsWith(`/vault/${vault}/`));
const ctx = { charge() {}, closed: () => false };

describe("an applet given one vault of three (proposal 5)", () => {
  it("vaults and sharing: list and hubs name only it; every call naming another is refused before the hub is asked", async () => {
    const r = createRouter([createVaultsModule(["vaults", "sharing"], vaultsDeps({ confirm: async () => "no", emit: () => {}, back: () => "/", given }))]);
    const list = await r.call("vaults", "list", {}, {}, ctx) as { key: string }[];
    expect(list.map((v) => v.key)).toEqual(["kitchen"]);
    const hubs = await r.call("vaults", "hubs", {}, {}, ctx) as { vaults: string[] }[];
    expect(hubs.flatMap((h) => h.vaults)).toEqual(["kitchen"]);
    for (const [method, params] of [["get", { vault: "letters", id: ID }], ["query", { vault: "letters" }], ["types", { vault: "pantry" }], ["changes", { vault: "letters", since: "2026-11-23T00:00:00Z" }],
      ["history", { vault: "letters", id: ID }], ["watch", { vault: "pantry" }], ["applets", { vault: "letters" }], ["access", { vault: "letters" }], ["people", { vault: "letters" }],
      ["reach", { vault: "pantry" }], ["publish", { vault: "letters", id: ID, on: false }]] as const) {
      await expect(r.call("vaults", method, params, {}, ctx), `${method} on another vault`).rejects.toMatchObject({ message: expect.stringContaining(NOT_GIVEN) });
    }
    expect(reached("letters")).toEqual([]);
    expect(reached("pantry")).toEqual([]);
    // and the one it was given answers
    await r.call("vaults", "get", { vault: "kitchen", id: ID }, {}, ctx);
    expect(reached("kitchen").length).toBeGreaterThan(0);
  });

  it("the shell's own calls under it refuse another vault too (a second lock under the module's)", async () => {
    const d = vaultsDeps({ confirm: async () => "no", emit: () => {}, back: () => "/", given });
    await expect(Promise.resolve().then(() => d.request("letters", "GET", "/records"))).rejects.toThrow(NOT_GIVEN);
    await expect(Promise.resolve().then(() => d.access("pantry"))).rejects.toThrow(NOT_GIVEN);
    await expect(Promise.resolve().then(() => d.people?.("letters"))).rejects.toThrow(NOT_GIVEN);
    await expect(Promise.resolve().then(() => d.watch("letters", null, () => {}))).rejects.toThrow(NOT_GIVEN);
    expect(d.self?.("letters")).toBeNull();
    expect(reached("letters")).toEqual([]);
  });

  it("recent and changes read only it", async () => {
    const d = appDeps(() => {}, () => null, { pick: async () => [] }, () => null, [], given);
    const recent = await d.recent(10, () => {});
    expect(recent.every((n) => n.vaultName === "kitchen")).toBe(true);
    expect(recent.length).toBeGreaterThan(0);
    await d.changes(() => {});
    expect(reached("letters")).toEqual([]);
    expect(reached("pantry")).toEqual([]);
    expect(reached("kitchen").length).toBeGreaterThan(0);
  });

  it("links: a link into another vault is never looked up there (the answer is the same as for a vault not held)", async () => {
    const d = appDeps(() => {}, () => null, { pick: async () => [] }, () => null, [], given);
    expect(await d.links([`letters:${ID}`, `pantry:${ID}`], undefined, () => {})).toEqual([null, null]);
    expect(reached("letters")).toEqual([]);
    expect(reached("pantry")).toEqual([]);
    // in the vault it was given, the same link is found
    expect(await d.links([`kitchen:${ID}`], undefined, () => {})).toEqual(["note"]);
  });

  it("follow: a tap still opens a note in another vault this device holds; the applet hears only that it went", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.getClientRects = () => [{}] as unknown as DOMRectList;
    frame.focus();
    Object.defineProperty(navigator, "userActivation", { configurable: true, get: () => ({ isActive: true }) });
    const went: string[] = [];
    const d = appDeps((h) => went.push(h), () => frame, { pick: async () => [] }, () => null, [], given);
    try {
      expect(await d.follow(`letters:${ID}`, undefined, true)).toBe(true);
      expect(went[0]).toContain("/v/letters/");
      // with no tap, nothing is looked up and nothing opens
      Object.defineProperty(navigator, "userActivation", { configurable: true, get: () => ({ isActive: false }) });
      asked.length = 0;
      expect(await d.follow(`pantry:${ID}`, undefined, true)).toBe(false);
      expect(reached("pantry")).toEqual([]);
    } finally { frame.remove(); }
  });

  it("an applet that doesn't ask (no word across vaults) is untouched: its links reach every vault held, as before", async () => {
    const r = createRouter([createAppModule(["open"], appDeps(() => {}, () => null, { pick: async () => [] }, () => null, [], () => true))]);
    expect(await r.call("app", "links", { links: [`letters:${ID}`] }, {}, ctx)).toEqual(["note"]);
  });
});
