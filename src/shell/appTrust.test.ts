// The app record is a trust surface (docs/design/APP-RECORD.md "What a record can't do"): anyone who can write the home
// vault (the person's agent, a token, the hub) can change it without a signature. Such a change may move the home, the
// pins and the list, and nothing else: it never lowers how careful approving is, grants nothing and carries no code.
import { describe, expect, it } from "vitest";
import { appOf, followed, openApp, appsFrom, recordOf } from "./apps";
import { DEFAULTS, fullOf, raise } from "./levelRules";

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

  it("never asks less than the device unlock: any word for approving code but passcode leaves it at the unlock", () => {
    for (const approve of ["nothing", "none", "", null, 0, false, "unlock", { level: "nothing" }]) {
      expect(fullOf(appOf({ ...HOSTILE, security: { approve } }, "Parachute/Apps/uni", "n")!.security).code).toBe("unlock");
      expect(fullOf(appOf({ ...HOSTILE, security: { code: approve } }, "Parachute/Apps/uni", "n")!.security).code).toBe("unlock");
    }
    expect(fullOf(appOf({ ...HOSTILE, security: undefined }, "Parachute/Apps/uni", "n")!.security).code).toBe("unlock");
    expect(appOf({ ...HOSTILE, security: { approve: "passcode" } }, "Parachute/Apps/uni", "n")!.security).toEqual({ code: "passcode" });
  });

  // a device's levels are raised by the open app's record and never lowered by one (src-tauri/src/levels.rs `raise`;
  // the lowering it takes is the person's signature, levels.test.ts)
  it("can't lower the levels once this device has read them: they stay when a later record drops them", () => {
    const rec = (security: unknown) => appOf({ ...HOSTILE, security }, "Parachute/Apps/uni", "n")!.security;
    let device = DEFAULTS;
    device = raise(device, rec({ approve: "unlock" }));
    expect(device.code).toBe("unlock");
    device = raise(device, rec({ code: "passcode", approvals: "passcode", idle: 5 }));
    for (const later of [{ approve: "unlock" }, { code: "unlock", approvals: "none", join: "none", idle: 0 }, undefined, { idle: 60 }]) {
      expect(raise(device, rec(later))).toEqual({ ...DEFAULTS, code: "passcode", approvals: "passcode", idle: 5 });
    }
  });

  it("can't lower them by breaking the record, deleting it, or naming another app that says less", () => {
    const strict = appOf({ ...HOSTILE, security: { code: "passcode" } }, "Parachute/Apps/uni", "n")!;
    const device = raise(DEFAULTS, strict.security);
    // the record broken or gone: the device opens the next app it can (Everything, or what the settings note names)
    const fallback = openApp(appsFrom([]), "uni", null);
    expect(fallback.id).toBe("everything");
    expect(raise(device, fallback.security).code).toBe("passcode");
    // a new record of the agent's, saying less, named in the settings note
    const other = appOf({ contract: 1, id: "uni2", name: "Uni 2", sources: [{ vault: "home", applet: "*" }], security: { code: "unlock", approvals: "none" } }, "Parachute/Apps/uni2", "m")!;
    expect(raise(device, openApp(appsFrom([other]), null, "uni2").security)).toEqual(device);
  });

  it("an app someone else offers, followed live, can't lower what the person's own record asks", () => {
    const own = appOf({ contract: 1, id: "techne", name: "Techne", live: { hub: "https://techne.example", vault: "techne", path: "Parachute/Apps/techne" }, security: { approve: "passcode" } }, "Parachute/Apps/techne", "01T")!;
    const theirs = { contract: 1, id: "techne", name: "Their name", sources: [{ vault: "techne", applet: "*" }], security: { approve: "unlock" } };
    const merged = appOf(followed(own, { name: "Techne" }, theirs), "Parachute/Apps/techne", "01T")!;
    expect(merged.security).toEqual({ code: "passcode" });
    // each level the stricter of the two: theirs may raise what the person's asks, never lower it
    const own2 = appOf({ contract: 1, id: "techne", name: "Techne", live: { hub: "https://techne.example", vault: "techne", path: "Parachute/Apps/techne" }, security: { approvals: "passcode", idle: 15 } }, "Parachute/Apps/techne", "01T")!;
    const theirs2 = { ...theirs, security: { approvals: "none", idle: 5, join: "passcode" } };
    expect(appOf(followed(own2, {}, theirs2), "Parachute/Apps/techne", "01T")!.security).toEqual({ approvals: "passcode", idle: 5, join: "passcode" });
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
