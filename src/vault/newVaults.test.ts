// Which vaults the launcher offers as new (newVaults.ts), without a key: the hub's public list, only on a hub where the
// sign-in found the person reaches every vault, never one held or waved away, and asked at most once a minute.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissVault, newVaultsOn, noteEvery, opensAs, relistVaults, resetNewVaults, RELIST_MS } from "./newVaults";
import { saveVault } from "./store";
import { setWhose } from "./whose";

const HUB = "https://hub.example";
const hold = (vault: string) => saveVault({ issuer: HUB, vault, tokenEndpoint: `${HUB}/oauth/token`, clientId: "c", accessToken: "t", scope: `vault:${vault}:read`, addedAt: "2026-11-18T00:00:00Z" });
let asked = 0;

beforeEach(() => {
  localStorage.clear();
  resetNewVaults();
  asked = 0;
  // the hub's public list: every vault on it (the network is the one thing faked)
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    asked++;
    expect(url).toBe(`${HUB}/.well-known/parachute.json`);
    return new Response(JSON.stringify({ vaults: [{ name: "kitchen" }, { name: "playground" }, { name: "attic" }] }), { status: 200 });
  }));
  hold("kitchen");
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("new vaults without a key", () => {
  it("a hub not known to be the person's own is never asked, and offers nothing", async () => {
    await relistVaults(0);
    expect(asked).toBe(0);
    expect(newVaultsOn(HUB)).toEqual([]);
  });

  it("on a hub the person runs: every vault there not held and not waved away", async () => {
    noteEvery(HUB, true);
    await relistVaults(0);
    expect(newVaultsOn(HUB)).toEqual(["playground", "attic"]);
    dismissVault(HUB, "attic");
    hold("playground");
    expect(newVaultsOn(HUB)).toEqual([]);
  });

  it("is asked at most once a minute per hub", async () => {
    noteEvery(HUB, true);
    await relistVaults(1000);
    await relistVaults(1000 + RELIST_MS - 1);
    expect(asked).toBe(1);
    await relistVaults(1000 + RELIST_MS);
    expect(asked).toBe(2);
  });

  it("a later sign-in that finds the person no longer reaches every vault stops it", async () => {
    noteEvery(HUB, true);
    noteEvery(HUB, false);
    await relistVaults(0);
    expect(asked).toBe(0);
  });
});

// Whose a vault on offer opens as (T-476): Library in a vault made after the sign-in opened as someone else's, so its
// card warned of strangers and its picker was not_granted. On a Parachute the person runs it is theirs, as the sign-in's
// own pick would have ticked it; anywhere else, or once they said otherwise, it is not.
describe("whose a vault on offer opens as", () => {
  const mine = () => setWhose({ issuer: HUB, vault: "kitchen" }, "mine");

  it("on a Parachute the person runs and calls theirs: theirs", () => {
    mine();
    noteEvery(HUB, true);
    expect(opensAs(HUB, "playground")).toBe("mine");
  });

  it("on a hub they don't run (a vault there may be someone else's, shared with them): someone else's", () => {
    mine();
    noteEvery(HUB, false);
    expect(opensAs(HUB, "playground")).toBe("theirs");
  });

  it("on a hub they run but said is someone else's: someone else's", () => {
    setWhose({ issuer: HUB, vault: "kitchen" }, "theirs");
    noteEvery(HUB, true);
    expect(opensAs(HUB, "playground")).toBe("theirs");
  });

  it("what they said of the vault itself stands", () => {
    mine();
    noteEvery(HUB, true);
    setWhose({ issuer: HUB, vault: "playground" }, "theirs");
    setWhose({ issuer: HUB, vault: "attic" }, "trusted");
    expect(opensAs(HUB, "playground")).toBe("theirs");
    expect(opensAs(HUB, "attic")).toBe("theirs");
  });

  it("with the key, a device signed in before this was kept learns that they run the hub when the list asks again", async () => {
    mine();
    // the native shell's answer to the signed list-vaults (the one thing faked: the device's own side)
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_INTERNALS__ = { invoke: async (cmd: string) => { if (cmd === "hub_vaults") return { vaults: ["kitchen", "playground"], all: true }; throw new Error(cmd); } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    try {
      expect(opensAs(HUB, "playground")).toBe("theirs");
      await relistVaults(0);
      expect(newVaultsOn(HUB)).toEqual(["playground"]);
      expect(opensAs(HUB, "playground")).toBe("mine");
    } finally { delete w.__TAURI_INTERNALS__; }
  });
});
