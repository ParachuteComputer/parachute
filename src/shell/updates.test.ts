import { beforeEach, describe, expect, it } from "vitest";
import { checkUpdates, offerFor, OWN, parseFeed, resetUpdates, updateNow } from "./updates";

const FEED = "https://builds.example.org/parachute/latest.json";
const feed = (o: Record<string, unknown> = {}) => JSON.stringify({ v: 1, at: 2_000, commit: "abc1234", files: { android: "parachute-abc1234-arm64.apk", mac: "parachute-abc1234.dmg" }, ...o });

describe("parseFeed", () => {
  it("resolves the files against the feed", () => {
    expect(parseFeed(feed(), FEED)).toEqual({ at: 2_000, commit: "abc1234", files: {
      android: "https://builds.example.org/parachute/parachute-abc1234-arm64.apk", mac: "https://builds.example.org/parachute/parachute-abc1234.dmg" } });
  });
  it("drops a file on another origin, or not on the web", () => {
    const f = parseFeed(feed({ files: { android: "https://elsewhere.example/evil.apk", mac: "//elsewhere.example/x.dmg", linux: "javascript:alert(1)", windows: "/parachute/p.msi" } }), FEED);
    expect(f?.files).toEqual({ windows: "https://builds.example.org/parachute/p.msi" });
  });
  it("refuses what isn't a feed", () => {
    for (const bad of ["", "nope", "[]", feed({ v: 2 }), feed({ at: "2000" }), feed({ at: -1 }), feed({ at: 1.5 }), feed({ commit: "ABC" }), feed({ commit: "abc" }), feed({ files: [] })])
      expect(parseFeed(bad, FEED)).toBeNull();
  });
});

describe("offerFor", () => {
  const f = parseFeed(feed(), FEED);
  it("offers a later build that has a file for this platform", () => {
    expect(offerFor(f, { at: 1_000, commit: "1111111" }, "android")).toEqual({ at: 2_000, commit: "abc1234", url: "https://builds.example.org/parachute/parachute-abc1234-arm64.apk" });
    expect(offerFor(f, { at: 1_000, commit: "1111111" }, "mac")?.url).toMatch(/\.dmg$/);
  });
  it("offers nothing for the same, an older build, a platform without a file, or a build not made from git", () => {
    expect(offerFor(f, { at: 2_000, commit: "abc1234" }, "android")).toBeNull();
    expect(offerFor(f, { at: 3_000, commit: "2222222" }, "android")).toBeNull();
    expect(offerFor(f, { at: 1_000, commit: "1111111" }, "linux")).toBeNull();
    expect(offerFor(f, { at: 0, commit: "" }, "android")).toBeNull();
    expect(offerFor(null, { at: 1_000, commit: "1111111" }, "android")).toBeNull();
  });
});

describe("checkUpdates", () => {
  beforeEach(() => resetUpdates());
  it("is nothing without a feed, and says what went wrong when the read fails", async () => {
    await checkUpdates(true, async () => null);
    expect(updateNow()).toEqual({ kind: "none" });
    await checkUpdates(true, async () => { throw new Error("The update address answered 404."); });
    expect(updateNow()).toEqual({ kind: "error", message: "The update address answered 404." });
  });
  it("offers what the feed has, compared with this build", async () => {
    const later = feed({ at: OWN.at + 60, commit: "fedcba9" });
    await checkUpdates(true, async () => ({ feed: FEED, body: later, platform: "android" }));
    // vitest builds from git, so this build has a time: the feed's later one is offered
    expect(OWN.at).toBeGreaterThan(0);
    expect(updateNow()).toMatchObject({ kind: "offer", offer: { commit: "fedcba9" }, platform: "android" });
    await checkUpdates(true, async () => ({ feed: FEED, body: feed({ at: OWN.at, commit: OWN.commit }), platform: "android" }));
    expect(updateNow()).toEqual({ kind: "current" });
  });
  it("reads by itself at most every few hours", async () => {
    let reads = 0;
    const read = async () => { reads++; return null; };
    await checkUpdates(false, read);
    await checkUpdates(false, read);
    expect(reads).toBe(1);
    await checkUpdates(true, read);
    expect(reads).toBe(2);
  });
});
