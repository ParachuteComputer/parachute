import { beforeEach, describe, expect, it } from "vitest";
import { forgetWhoseCache, HOME_KEY, importable, isMine, setWhose, WHOSE_KEY, whoseOf, askedAbout } from "./whose";
import { VAULTS_KEY, type VaultRecord } from "./store";
import { homeVault } from "../shell/frameSource";

const rec = (key: string, issuer: string, addedAt: string): VaultRecord => ({ key, issuer, vault: key, tokenEndpoint: `${issuer}/oauth/token`, clientId: "c", accessToken: "t", scope: "", addedAt });
const kitchen = rec("kitchen", "https://home.example", "2026-01-01"), techne = rec("techne", "https://techne.example", "2026-02-01"), journal = rec("journal", "https://home.example", "2026-03-01");

beforeEach(() => { localStorage.clear(); forgetWhoseCache(); });

describe("whose a vault is", () => {
  it("a device that held vaults before: its home is mine, the others are someone else's until the person says", () => {
    localStorage.setItem(VAULTS_KEY, JSON.stringify([techne, kitchen, journal]));
    localStorage.setItem(HOME_KEY, "kitchen");
    expect(whoseOf(kitchen)).toBe("mine");
    expect(whoseOf(techne)).toBe("theirs");
    expect(whoseOf(journal)).toBe("theirs");
    expect(askedAbout([techne, kitchen, journal]).map((v) => v.key).sort()).toEqual(["journal", "techne"]);
    setWhose(journal, "mine");
    expect(askedAbout([techne, kitchen, journal]).map((v) => v.key)).toEqual(["techne"]);
  });
  it("a vault no one said anything about is someone else's; only mine and trusted may be imported from", () => {
    localStorage.setItem(WHOSE_KEY, JSON.stringify({ whose: {}, ask: [] }));
    expect(isMine(techne)).toBe(false);
    expect(importable(techne)).toBe(false);
    setWhose(techne, "trusted");
    expect(importable(techne)).toBe(true);
    expect(isMine(techne)).toBe(false);
  });
  it("someone else's vault is never the home, even signed in to first or chosen before", () => {
    localStorage.setItem(VAULTS_KEY, JSON.stringify([techne, kitchen]));
    localStorage.setItem(WHOSE_KEY, JSON.stringify({ whose: { "https://techne.example techne": "theirs", "https://home.example kitchen": "mine" }, ask: [] }));
    localStorage.setItem(HOME_KEY, "techne");
    expect(homeVault()?.key).toBe("kitchen");
    setWhose(kitchen, "theirs");
    expect(homeVault()).toBe(null);
  });
  it("is kept by hub and name, so signing in again keeps it", () => {
    localStorage.setItem(WHOSE_KEY, JSON.stringify({ whose: {}, ask: [] }));
    setWhose(techne, "trusted");
    expect(whoseOf({ ...techne, key: "techne@techne.example", accessToken: "new" })).toBe("trusted");
  });
});
