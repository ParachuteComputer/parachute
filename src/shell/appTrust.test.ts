// The app record is a trust surface (docs/design/APP-RECORD.md "What a record can't do"): anyone who can write the home
// vault (the person's agent, a token, the hub) can change it without a signature. Such a change may move the home, the
// pins and the list, and nothing else: it never lowers how careful approving is, grants nothing and carries no code.
import { describe, expect, it } from "vitest";
import { appOf, followed, openApp, appsFrom, recordOf } from "./apps";
import { approveLevel, FLOOR_KEY } from "./appFloor";

/** What a hostile writer might put in a record: a home and pins, plus every field that would loosen or grant. */
const HOSTILE = {
  contract: 1, id: "uni", name: "Uni", sources: [{ vault: "home", applet: "*" }],
  start: { vault: "home", applet: "Applets/Home" }, bar: [{ vault: "home", applet: "Applets/Rooms" }],
  security: { approve: "nothing", idle: 0 }, grants: [{ applet: "Applets/Rooms", allow: "all" }], approved: true,
  approvals: [{ record: "01ROOMS", approved: true, code: "tsx:abc" }], code: "<script>alert(1)</script>", body: "export default 1",
  frame: "vault:Frames/Mine", access: [{ path: "/", can: "write" }], services: [{ kind: "nostr-relay", url: "wss://evil.example" }],
  keys: ["npub1evil"], passcode: false, unlock: false,
};
/** Everything a record can carry into the running app: an App's own fields. */
const APP_FIELDS = ["id", "name", "glyph", "note", "look", "sources", "hide", "bar", "start", "opens", "keep", "security", "live", "noteId", "hubOf"];

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

describe("an unsigned app record", () => {
  it("changes only the home, the pins and the list: every other word it says is read as nothing", () => {
    const app = appOf(HOSTILE, "Parachute/Apps/uni", "01UNI")!;
    expect(Object.keys(app).every((k) => APP_FIELDS.includes(k))).toBe(true);
    expect(app.start).toEqual({ vault: "home", applet: "Applets/Home" });
    expect(app.bar).toEqual([{ vault: "home", applet: "Applets/Rooms" }]);
    expect(app.sources).toEqual([{ vault: "home", applet: "*" }]);
    // no grant, approval, code, access, service or key comes through it
    for (const k of ["grants", "approved", "approvals", "code", "body", "frame", "access", "services", "keys", "passcode", "unlock"]) expect(app).not.toHaveProperty(k);
    // and what the app writes back for it (a pin made here) carries none of them as its own
    expect(Object.keys(recordOf(app)).sort()).toEqual(["bar", "contract", "glyph", "id", "look", "name", "sources", "start"]);
  });

  it("never asks less than the device unlock: any level but passcode reads as unlock", () => {
    for (const approve of ["nothing", "none", "", null, 0, false, "unlock", { level: "nothing" }]) {
      expect(appOf({ ...HOSTILE, security: { approve } }, "Parachute/Apps/uni", "n")!.security).toEqual({ approve: "unlock" });
    }
    expect(appOf({ ...HOSTILE, security: undefined }, "Parachute/Apps/uni", "n")!.security).toEqual({ approve: "unlock" });
    expect(appOf({ ...HOSTILE, security: { approve: "passcode" } }, "Parachute/Apps/uni", "n")!.security).toEqual({ approve: "passcode" });
  });

  it("can't lower the level once this device has read it: passcode stays when a later record drops it", () => {
    const s = memory();
    const strict = appOf({ ...HOSTILE, security: { approve: "passcode" } }, "Parachute/Apps/uni", "n")!;
    const loose = appOf({ ...HOSTILE, security: { approve: "unlock" } }, "Parachute/Apps/uni", "n")!;
    const gone = appOf({ ...HOSTILE, security: undefined }, "Parachute/Apps/uni", "n")!;
    expect(approveLevel(loose, "home", s)).toBe("unlock");
    expect(approveLevel(strict, "home", s)).toBe("passcode");
    expect(approveLevel(loose, "home", s)).toBe("passcode");
    expect(approveLevel(gone, "home", s)).toBe("passcode");
    // a record can't write the floor down either: it is the device's, and only ever raised
    s.setItem(FLOOR_KEY, JSON.stringify({ home: "unlock" }));
    expect(approveLevel(strict, "home", s)).toBe("passcode");
    // another home is its own
    expect(approveLevel(loose, "other", s)).toBe("unlock");
  });

  it("can't lower it by breaking the record, deleting it, or naming another app that says less", () => {
    const s = memory();
    const strict = appOf({ ...HOSTILE, security: { approve: "passcode" } }, "Parachute/Apps/uni", "n")!;
    expect(approveLevel(strict, "home", s)).toBe("passcode");
    // the record broken or gone: the device opens the next app it can (Everything, or what the settings note names)
    const fallback = openApp(appsFrom([]), "uni", null);
    expect(fallback.id).toBe("everything");
    expect(approveLevel(fallback, "home", s)).toBe("passcode");
    // a new record of the agent's, saying less, named in the settings note
    const other = appOf({ contract: 1, id: "uni2", name: "Uni 2", sources: [{ vault: "home", applet: "*" }], security: { approve: "unlock" } }, "Parachute/Apps/uni2", "m")!;
    expect(approveLevel(openApp(appsFrom([other]), null, "uni2"), "home", s)).toBe("passcode");
  });

  it("an app someone else offers, followed live, can't lower what the person's own record asks", () => {
    const own = appOf({ contract: 1, id: "techne", name: "Techne", live: { hub: "https://techne.example", vault: "techne", path: "Parachute/Apps/techne" }, security: { approve: "passcode" } }, "Parachute/Apps/techne", "01T")!;
    const theirs = { contract: 1, id: "techne", name: "Their name", sources: [{ vault: "techne", applet: "*" }], security: { approve: "unlock" } };
    const merged = appOf(followed(own, { name: "Techne" }, theirs), "Parachute/Apps/techne", "01T")!;
    expect(merged.security).toEqual({ approve: "passcode" });
    expect(merged.name).toBe("Techne");
    expect(merged.sources).toEqual([{ vault: "techne", applet: "*" }]);
  });

  it("a record that doesn't parse is no app: the device opens the next one it can, never nothing", () => {
    const broken = [appOf({ contract: 9, id: "uni", name: "Uni" }, "Parachute/Apps/uni", "n"), appOf({ contract: 1, id: "Uni!", name: "Uni" }, "Parachute/Apps/Uni!", "n"), appOf("not an object", "Parachute/Apps/uni", "n")];
    expect(broken).toEqual([null, null, null]);
    expect(openApp(appsFrom([]), "uni", "uni").id).toBe("everything");
    expect(openApp(appsFrom([]), "uni", "simple").id).toBe("simple");
  });
});
