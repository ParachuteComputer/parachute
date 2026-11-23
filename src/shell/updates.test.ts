import { beforeEach, describe, expect, it } from "vitest";
import { afterTry, checkUpdates, download, installState, offerFor, OWN, parseFeed, resetUpdates, updateNow, type Tried } from "./updates";

const FEED = "https://builds.example.org/parachute/latest.json";
const SUM = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const feed = (o: Record<string, unknown> = {}) => JSON.stringify({ v: 1, at: 2_000, commit: "abc1234", files: { android: "parachute-abc1234-arm64.apk", mac: "parachute-abc1234.dmg" }, ...o });

describe("parseFeed", () => {
  it("resolves the files against the feed", () => {
    expect(parseFeed(feed(), FEED)).toEqual({ at: 2_000, commit: "abc1234", files: {
      android: "https://builds.example.org/parachute/parachute-abc1234-arm64.apk", mac: "https://builds.example.org/parachute/parachute-abc1234.dmg" }, sha256: {} });
  });
  it("reads each file's sha256, for a file it names; a feed without them is still one", () => {
    const f = parseFeed(feed({ sha256: { android: SUM.toUpperCase(), mac: "not a sum", linux: SUM, windows: 7 } }), FEED);
    expect(f?.sha256).toEqual({ android: SUM });
    expect(parseFeed(feed({ sha256: "x" }), FEED)?.sha256).toEqual({});
    expect(parseFeed(feed({ sha256: [SUM] }), FEED)?.sha256).toEqual({});
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
  it("carries the file's sha256 when the feed has it, and none when it doesn't", () => {
    const g = parseFeed(feed({ sha256: { android: SUM } }), FEED);
    expect(offerFor(g, { at: 1_000, commit: "1111111" }, "android")?.sha256).toBe(SUM);
    expect(offerFor(g, { at: 1_000, commit: "1111111" }, "mac")?.sha256).toBeUndefined();
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
  it("keeps an offer when a later read fails", async () => {
    await checkUpdates(true, async () => ({ feed: FEED, body: feed({ at: OWN.at + 60, commit: "fedcba9" }), platform: "android" }));
    await checkUpdates(true, async () => { throw new Error("Couldn't reach the update address."); });
    expect(updateNow()).toMatchObject({ kind: "offer", offer: { commit: "fedcba9" } });
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

describe("afterTry", () => {
  const own = { at: 1_000, commit: "1111111" };
  const tried: Tried = { from: "1111111", to: "abc1234", toAt: 2_000, when: 5 };
  it("knows nothing without a try", () => {
    expect(afterTry(null, own)).toEqual({ kind: "none" });
  });
  it("knows it was updated when this build is the one tried", () => {
    expect(afterTry(tried, { at: 2_000, commit: "abc1234" })).toEqual({ kind: "updated", at: 2_000 });
  });
  it("says the old build still runs after a try, with Android's reason when it gave one", () => {
    expect(afterTry(tried, own)).toEqual({ kind: "stuck", to: "abc1234", at: 2_000, why: "" });
    expect(afterTry({ ...tried, why: "Not installed: you cancelled it." }, own)).toMatchObject({ kind: "stuck", why: "Not installed: you cancelled it." });
  });
  it("says nothing on a build installed some other way", () => {
    expect(afterTry({ ...tried, from: "0000000" }, own)).toEqual({ kind: "none" });
    expect(afterTry(tried, { at: 3_000, commit: "fedcba9" })).toEqual({ kind: "none" });
  });
});

describe("download on Android", () => {
  const offer = { at: OWN.at + 60, commit: "fedcba9", url: "https://builds.example.org/parachute/p.apk", sha256: SUM };
  beforeEach(() => { resetUpdates(); localStorage.clear(); });
  it("shows the download, then Android's installer, and remembers the build the shell handed it", async () => {
    const seen: string[] = [];
    await download(offer, "android", async (step) => {
      step({ stage: "download", got: 5, total: 10 });
      seen.push(JSON.stringify(installState().install));
      // the feed read by the shell names a later build than the offer on screen: that is the one tried
      step({ stage: "install", checked: true, commit: "0123456", at: offer.at + 60 });
      seen.push(JSON.stringify(installState().install));
    });
    expect(seen).toEqual([JSON.stringify({ kind: "downloading", got: 5, total: 10 }), JSON.stringify({ kind: "installing", checked: true })]);
    expect(JSON.parse(localStorage.getItem("parachute.update.tried")!)).toMatchObject({ from: OWN.commit, to: "0123456", toAt: offer.at + 60 });
    // this build still runs: the next start would say so
    expect(installState().after).toEqual({ kind: "stuck", to: "0123456", at: offer.at + 60, why: "" });
  });
  it("keeps Android's refusal with the try", async () => {
    await download(offer, "android", async (step) => { step({ stage: "install", checked: false, commit: "fedcba9", at: offer.at }); throw new Error("Not installed: you cancelled it."); });
    expect(installState().install).toEqual({ kind: "failed", message: "Not installed: you cancelled it." });
    expect(installState().after).toEqual({ kind: "stuck", to: "fedcba9", at: offer.at, why: "Not installed: you cancelled it." });
  });
  it("a download that fails (a file that doesn't match) is no try", async () => {
    await download(offer, "android", async () => { throw new Error("The downloaded file isn't the one the update list names."); });
    expect(installState().install).toMatchObject({ kind: "failed" });
    expect(localStorage.getItem("parachute.update.tried")).toBeNull();
    expect(installState().after).toEqual({ kind: "none" });
  });
  it("a second Download while Android is asking replaces the first, which then says nothing", async () => {
    let refuse: (e: Error) => void = () => {};
    const first = download(offer, "android", (step) => new Promise<void>((_, no) => { step({ stage: "install", checked: true, commit: "fedcba9", at: offer.at }); refuse = no; }));
    await Promise.resolve();
    expect(installState().install).toEqual({ kind: "installing", checked: true });
    const second = download(offer, "android", async (step) => { step({ stage: "download", got: 1, total: 10 }); refuse(new Error("Not installed: a newer try replaced this one.")); await Promise.resolve(); step({ stage: "download", got: 2, total: 10 }); });
    await Promise.all([first, second]);
    expect(installState().install).toEqual({ kind: "idle" });
    expect(installState().after).toMatchObject({ kind: "stuck", why: "" });
  });
});

describe("a refusal belongs to its build", () => {
  beforeEach(() => { resetUpdates(); localStorage.clear(); });
  it("goes when the feed offers another build, and stays for the same one", async () => {
    const one = async () => ({ feed: FEED, body: feed({ at: OWN.at + 60, commit: "fedcba9" }), platform: "android" });
    const two = async () => ({ feed: FEED, body: feed({ at: OWN.at + 120, commit: "0123456" }), platform: "android" });
    await checkUpdates(true, one);
    const o = updateNow();
    if (o.kind !== "offer") throw new Error("no offer");
    await download(o.offer, "android", async () => { throw new Error("Not installed: the file is an older build than this one."); });
    expect(installState().install.kind).toBe("failed");
    await checkUpdates(true, one);
    expect(installState().install.kind).toBe("failed");
    await checkUpdates(true, two);
    expect(installState().install).toEqual({ kind: "idle" });
  });
});
