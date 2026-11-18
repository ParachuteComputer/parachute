// Which vaults the launcher offers as new (newVaults.ts), without a key: the hub's public list, only on a hub where the
// sign-in found the person reaches every vault, never one held or waved away, and asked at most once a minute.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissVault, newVaultsOn, noteEvery, relistVaults, resetNewVaults, RELIST_MS } from "./newVaults";
import { saveVault } from "./store";

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
