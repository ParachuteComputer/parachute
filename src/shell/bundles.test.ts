// The bundle record (docs/design/APP-RECORD.md): what an app offers is what its sources name, less what it hides; a record
// that would widen what is offered is read narrowly; the device's choice wins over the settings note's.
import { describe, expect, it } from "vitest";
import { bundleOf, bundlesFrom, builtInBundle, offered, offersIn, openBundle, recordOf } from "./bundles";

const HOME = "https://uni.example";
const v = (vault: string, hub = HOME) => ({ hub, vault });
const a = (noteId: string, path: string) => ({ noteId, path });
const uni = bundleOf({ contract: 1, id: "uni", name: "Uni", sources: [
  { vault: "home", applet: "*" },
  { vault: "garden", applet: "Applets/SeedLog" },
  { hub: "https://techne.example", vault: "techne", applet: "Applets/Events" },
], hide: [{ vault: "home", applet: "Applets/Scratch" }], bar: [{ vault: "home", applet: "Applets/Journal" }], keep: 4 }, "Parachute/Bundles/uni", "01UNI")!;

describe("the bundle record", () => {
  it("offers what its sources name, one applet, a whole vault or a whole hub, less what it hides", () => {
    expect(offered(uni, v("home"), a("01J", "Applets/Journal.tsx"), HOME)).toBe(true);
    expect(offered(uni, v("home"), a("01S", "Applets/Scratch.tsx"), HOME)).toBe(false);
    expect(offered(uni, v("garden"), a("01G", "Applets/SeedLog.tsx"), HOME)).toBe(true);
    expect(offered(uni, v("garden"), a("01O", "Applets/Other.tsx"), HOME)).toBe(false);
    expect(offered(uni, v("techne", "https://techne.example"), a("01E", "Applets/Events.html"), HOME)).toBe(true);
    // the same vault name on another hub is another vault
    expect(offered(uni, v("home", "https://elsewhere.example"), a("01J", "Applets/Journal.tsx"), HOME)).toBe(false);
    expect(offersIn(uni, v("playground"), HOME)).toBe(false);
    const hub = bundleOf({ contract: 1, id: "lab", name: "Lab", sources: [{ hub: HOME, vault: "*", applet: "*" }] }, "Parachute/Bundles/lab", "x")!;
    expect(offered(hub, v("playground"), a("01I", "Applets/Ideas.tsx"), HOME)).toBe(true);
  });
  it("refuses what would widen it: every hub, a star inside a name, a hub with a star, a pin; an id that isn't its path", () => {
    const bad = bundleOf({ contract: 1, id: "x", name: "X", sources: [{ vault: "*", applet: "*" }, { vault: "home", applet: "Applets/*" }, { hub: "https://*.example", vault: "home", applet: "*" }, { vault: "home", applet: "Applets/A", code: "sha256:1" }, { vault: "home", applet: "*" }] }, "Parachute/Bundles/x", "n")!;
    expect(bad.sources).toEqual([{ vault: "home", applet: "*" }]);
    expect(bundleOf({ contract: 1, id: "uni", name: "Uni", sources: [] }, "Parachute/Bundles/other", "n")).toBeNull();
    // only Everything may say every vault everywhere
    expect(bundleOf({ contract: 1, id: "mine", name: "Mine", everywhere: true }, "Parachute/Bundles/mine", "n")!.sources).toEqual([]);
  });
  it("the two built-ins are always there; a record changes them; the device's choice wins, then the settings note's, then everything", () => {
    const apps = bundlesFrom([uni, bundleOf({ contract: 1, id: "simple", name: "Simple", look: "notes", sources: [{ vault: "home", applet: "Applets/Capture" }] }, "Parachute/Bundles/simple", "01S")!]);
    expect(apps.map((x) => x.id).sort()).toEqual(["everything", "simple", "uni"]);
    expect(apps.find((x) => x.id === "simple")!.noteId).toBe("01S");
    expect(openBundle(apps, "uni", "simple").id).toBe("uni");
    expect(openBundle(apps, null, "simple").id).toBe("simple");
    expect(openBundle(apps, "gone", null).id).toBe("everything");
    expect(offered(builtInBundle("everything"), v("anything", "https://any.example"), a("1", "A"), HOME)).toBe(true);
  });
  it("what the app writes for Everything reads back as Everything", () => {
    const e = { ...builtInBundle("everything"), bar: [{ vault: "home", applet: "Applets/Rooms" }] };
    const back = bundleOf(recordOf(e), "Parachute/Bundles/everything", "n")!;
    expect(back.sources).toEqual(e.sources);
    expect(back.bar).toEqual(e.bar);
    expect(bundleOf(recordOf(uni), "Parachute/Bundles/uni", "n")).toEqual({ ...uni, noteId: "n" });
  });
});

describe("the bar and home an app gives", async () => {
  const { effective } = await import("./homeSettings");
  const S = { bar: [{ vault: "home", applet: "Applets/Mail" }], start: { vault: "home", applet: "Applets/Rooms" }, hubs: [], services: [], bundle: null as string | null };
  it("no record: the settings note's, as before", () => {
    expect(effective(S, bundlesFrom([]))).toMatchObject({ bar: S.bar, start: S.start });
  });
  it("a record's own bar, and the settings note's home when it says none; an explicit null home is none", () => {
    const only = bundleOf({ contract: 1, id: "lab", name: "Lab", sources: [], bar: [{ vault: "home", applet: "Applets/Ideas" }] }, "Parachute/Bundles/lab", "1")!;
    expect(effective({ ...S, bundle: "lab" }, bundlesFrom([only]))).toMatchObject({ bar: only.bar, start: S.start });
    const none = bundleOf({ contract: 1, id: "lab", name: "Lab", sources: [], start: null }, "Parachute/Bundles/lab", "1")!;
    expect(effective({ ...S, bundle: "lab" }, bundlesFrom([none]))).toMatchObject({ bar: S.bar, start: null });
  });
  it("a live app's places that name no hub are on its Parachute", () => {
    const live = { ...bundleOf({ contract: 1, id: "techne", name: "Techne", sources: [], bar: [{ vault: "techne", applet: "Applets/Events" }] }, "Parachute/Bundles/techne", "1")!, hubOf: "https://techne.example" };
    expect(effective({ ...S, bundle: "techne" }, bundlesFrom([live])).bar).toEqual([{ vault: "techne", applet: "Applets/Events", hub: "https://techne.example" }]);
  });
});
