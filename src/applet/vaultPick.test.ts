// @vitest-environment node
// The pick's own rules (docs/ACCESS.md proposal 5): what a pick may hold, what no pick means, and a pick of one.
import { describe, expect, it } from "vitest";
import { asksVaults, parsePick, pickToSign, reachOf } from "./vaultPick";

const HOME = { hub: "https://uni.example", vault: "kitchen" }, OWN = { hub: "https://uni.example", vault: "letters" }, OTHER = { hub: "https://other.example", vault: "pantry" };

describe("a pick", () => {
  it("is a short list of {hub, vault}, a hub's origin and a vault's name, each once; anything else is no pick at all", () => {
    expect(parsePick([HOME, OTHER])).toEqual([OTHER, HOME]);
    expect(parsePick([OTHER, HOME])).toEqual([OTHER, HOME]);
    expect(parsePick([])).toEqual([]);
    for (const bad of [null, "kitchen", [HOME, HOME], [{ ...HOME, path: "/" }], [{ hub: "https://uni.example/vault", vault: "k" }], [{ hub: "file:///x", vault: "k" }], [{ hub: HOME.hub, vault: "" }], [{ hub: HOME.hub, vault: "a\nb" }], Array(51).fill(0).map((_, i) => ({ hub: HOME.hub, vault: `v${i}` }))])
      expect(parsePick(bad)).toBeNull();
  });
  it("only the words that reach across vaults ask for one", () => {
    expect(asksVaults(["vaults"])).toBe(true);
    expect(asksVaults(["recent", "pins"])).toBe(true);
    expect(asksVaults(["open", "links", "copy", "storage"])).toBe(false);
  });
  it("no pick: the home, and for an applet with a card its own vault too; never more", () => {
    expect(reachOf(null, HOME, null)).toEqual([HOME]);
    expect(reachOf(null, HOME, OWN)).toEqual([HOME, OWN]);
    expect(reachOf([OTHER], HOME, OWN)).toEqual([OTHER]);
  });
  it("nothing is signed for the default, so its approval hashes as before", () => {
    expect(pickToSign([OWN, HOME], HOME, OWN)).toBeNull();
    expect(pickToSign([HOME], HOME, OWN)).toEqual([HOME]);
    expect(pickToSign([HOME, OTHER], HOME, null)).toEqual([OTHER, HOME]);
  });
  it("a pick of one reaches one vault, however many the pick holds: the first, else its own, else the home", () => {
    expect(reachOf([OWN, OTHER], HOME, null, true)).toEqual([OTHER]);
    expect(reachOf([OWN], HOME, null, true)).toEqual([OWN]);
    expect(reachOf(null, HOME, OWN, true)).toEqual([OWN]);
    expect(reachOf(null, HOME, null, true)).toEqual([HOME]);
    expect(pickToSign([HOME], HOME, null, true)).toBeNull();
    expect(pickToSign([OWN], HOME, null, true)).toEqual([OWN]);
  });
});
