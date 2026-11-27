// The bundle record is a trust surface (docs/design/APP-RECORD.md "What a record can't do"): anyone who can write the home
// vault (the person's agent, a token, the hub) can change it without a signature. Such a change may move the home, the
// pins and the list, and nothing else: it never lowers how careful approving is, grants nothing and carries no code.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bundleOf, followed, offersOwn, openBundle, bundlesFrom, recordOf } from "./bundles";
import { OFFICIAL_NAMES, PARACHUTE_PUBLISHER } from "../applet/parachuteSource";
import { DEFAULTS, fullOf, raise } from "./levelRules";

/** What a hostile writer might put in a record: a home and pins, plus every field that would loosen or grant. */
const HOSTILE = {
  contract: 1, id: "uni", name: "Uni", sources: [{ vault: "home", applet: "*" }],
  start: { vault: "home", applet: "Applets/Home" }, bar: [{ vault: "home", applet: "Applets/Rooms" }],
  security: { approve: "nothing", idle: 0 }, grants: [{ applet: "Applets/Rooms", allow: "all" }], approved: true,
  approvals: [{ record: "01ROOMS", approved: true, code: "tsx:abc" }], code: "<script>alert(1)</script>", body: "export default 1",
  frame: "vault:Frames/Mine", access: [{ path: "/", can: "write" }], services: [{ kind: "nostr-relay", url: "wss://evil.example" }],
  keys: ["npub1evil"], passcode: false, unlock: false,
  // a publisher of the writer's, with a key of theirs: the record can only name Parachute's or leave it out
  publishers: [{ url: "https://evil.example/applets/", keys: ["3ea0evil"] }],
};
/** Everything a record can carry into the running app: an App's own fields. */
const APP_FIELDS = ["id", "name", "glyph", "note", "look", "sources", "hide", "bar", "base", "start", "opens", "keep", "security", "parachute", "own", "live", "noteId", "hubOf"];


describe("an unsigned bundle record", () => {
  it("can leave Parachute's own applets out, never give a publisher a key (docs/design/PARACHUTE-SOURCE.md)", () => {
    expect(bundleOf(HOSTILE, "Parachute/Bundles/uni", "01UNI")!.parachute).toBe(false);
    const named = bundleOf({ ...HOSTILE, publishers: [{ url: "https://parachute.computer/applets/", keys: ["3ea0evil"] }] }, "Parachute/Bundles/uni", "01UNI")!;
    expect(named.parachute).toBe(true);
    expect(JSON.stringify(named)).not.toContain("3ea0evil");
    // none said: a default of the same id fills it in (on); a bundle of the person's own offers them once it names them
    expect(bundleOf({ contract: 1, id: "uni", name: "Uni" }, "Parachute/Bundles/uni", "01UNI")!.parachute).toBe(false);
    expect(bundleOf({ contract: 1, id: "simple", publishers: [] }, "Parachute/Bundles/simple", "01S")!.parachute).toBe(false);
    expect(bundleOf({ contract: 1, id: "simple" }, "Parachute/Bundles/simple", "01S")!.parachute).toBe(true);
  });
  it("can name which of Parachute's own it offers (`applets`): only those, and naming never widens", () => {
    const uni = (applets: unknown) => bundleOf({ contract: 1, id: "uni", name: "Uni", publishers: [{ url: PARACHUTE_PUBLISHER, applets }] }, "Parachute/Bundles/uni", "01UNI")!;
    // Aaron's `uni` bundle has its own Home and Journal: it takes Vault alone
    const vault = uni(["vault"]);
    expect(OFFICIAL_NAMES.filter((n) => offersOwn(vault, n))).toEqual(["vault"]);
    // what the app writes for it (a copy of the bundle) keeps the names
    expect(recordOf(vault).publishers).toEqual([{ url: PARACHUTE_PUBLISHER, applets: ["vault"] }]);
    expect(OFFICIAL_NAMES.filter((n) => offersOwn(bundleOf(recordOf(vault), "Parachute/Bundles/uni", "01UNI")!, n))).toEqual(["vault"]);
    // a name this build doesn't know is left out; a list that isn't names, or names nothing known, offers none
    expect(OFFICIAL_NAMES.filter((n) => offersOwn(uni(["vault", "prism", "connect"]), n))).toEqual(["vault", "connect"]);
    for (const bad of [[], "vault", "*", ["*"], [["vault"]], [{ name: "vault" }], null, 6, ["prism"], ["vault", 6], ["vault", null]]) expect(OFFICIAL_NAMES.filter((n) => offersOwn(uni(bad), n))).toEqual([]);
    // none named: all of them, as before
    const all = bundleOf({ contract: 1, id: "uni", name: "Uni", publishers: [{ url: PARACHUTE_PUBLISHER }] }, "Parachute/Bundles/uni", "01UNI")!;
    expect(OFFICIAL_NAMES.filter((n) => offersOwn(all, n))).toEqual([...OFFICIAL_NAMES]);
    expect(recordOf(all).publishers).toEqual([{ url: PARACHUTE_PUBLISHER }]);
    // a default's own record that names some narrows the default
    expect(OFFICIAL_NAMES.filter((n) => offersOwn(bundleOf({ contract: 1, id: "simple", publishers: [{ url: PARACHUTE_PUBLISHER, applets: ["notes", "vault"] }] }, "Parachute/Bundles/simple", "01S")!, n))).toEqual(["notes", "vault"]);
  });
  it("scripts/install-applets.ts names the same publisher and applets as the app (it can't import the app's build)", () => {
    const script = readFileSync("scripts/install-applets.ts", "utf8");
    expect(script).toContain(`const PARACHUTE_PUBLISHER = ${JSON.stringify(PARACHUTE_PUBLISHER)};`);
    expect(script).toContain(`const OFFICIAL_NAMES = ${JSON.stringify([...OFFICIAL_NAMES]).replace(/,/g, ", ")};`);
  });
  it("changes only the home, the pins and the list: every other word it says is read as nothing", () => {
    const app = bundleOf(HOSTILE, "Parachute/Bundles/uni", "01UNI")!;
    expect(Object.keys(app).every((k) => APP_FIELDS.includes(k))).toBe(true);
    expect(app.start).toEqual({ vault: "home", applet: "Applets/Home" });
    expect(app.bar).toEqual([{ vault: "home", applet: "Applets/Rooms" }]);
    expect(app.sources).toEqual([{ vault: "home", applet: "*" }]);
    // no grant, approval, code, access, service or key comes through it
    for (const k of ["grants", "approved", "approvals", "code", "body", "frame", "access", "services", "keys", "passcode", "unlock"]) expect(app).not.toHaveProperty(k);
    // and what the app writes back for it (a pin made here) carries none of them as its own
    expect(Object.keys(recordOf(app)).sort()).toEqual(["bar", "contract", "glyph", "id", "look", "name", "publishers", "sources", "start"]);
    expect(recordOf(app).publishers).toEqual([]);
  });

  it("never asks less than the device unlock: any word for approving code but passcode leaves it at the unlock", () => {
    for (const approve of ["nothing", "none", "", null, 0, false, "unlock", { level: "nothing" }]) {
      expect(fullOf(bundleOf({ ...HOSTILE, security: { approve } }, "Parachute/Bundles/uni", "n")!.security).code).toBe("unlock");
      expect(fullOf(bundleOf({ ...HOSTILE, security: { code: approve } }, "Parachute/Bundles/uni", "n")!.security).code).toBe("unlock");
    }
    expect(fullOf(bundleOf({ ...HOSTILE, security: undefined }, "Parachute/Bundles/uni", "n")!.security).code).toBe("unlock");
    expect(bundleOf({ ...HOSTILE, security: { approve: "passcode" } }, "Parachute/Bundles/uni", "n")!.security).toEqual({ code: "passcode" });
  });

  // a device's levels are raised by the open bundle's record and never lowered by one (src-tauri/src/levels.rs `raise`;
  // the lowering it takes is the person's signature, levels.test.ts)
  it("can't lower the levels once this device has read them: they stay when a later record drops them", () => {
    const rec = (security: unknown) => bundleOf({ ...HOSTILE, security }, "Parachute/Bundles/uni", "n")!.security;
    let device = DEFAULTS;
    device = raise(device, rec({ approve: "unlock" }));
    expect(device.code).toBe("unlock");
    device = raise(device, rec({ code: "passcode", approvals: "passcode", idle: 5 }));
    for (const later of [{ approve: "unlock" }, { code: "unlock", approvals: "none", join: "none", idle: 0 }, undefined, { idle: 60 }]) {
      expect(raise(device, rec(later))).toEqual({ ...DEFAULTS, code: "passcode", approvals: "passcode", idle: 5 });
    }
  });

  it("can't lower them by breaking the record, deleting it, or naming another app that says less", () => {
    const strict = bundleOf({ ...HOSTILE, security: { code: "passcode" } }, "Parachute/Bundles/uni", "n")!;
    const device = raise(DEFAULTS, strict.security);
    // the record broken or gone: the device opens the next app it can (Everything, or what the settings note names)
    const fallback = openBundle(bundlesFrom([]), "uni", null);
    expect(fallback.id).toBe("everything");
    expect(raise(device, fallback.security).code).toBe("passcode");
    // a new record of the agent's, saying less, named in the settings note
    const other = bundleOf({ contract: 1, id: "uni2", name: "Uni 2", sources: [{ vault: "home", applet: "*" }], security: { code: "unlock", approvals: "none" } }, "Parachute/Bundles/uni2", "m")!;
    expect(raise(device, openBundle(bundlesFrom([other]), null, "uni2").security)).toEqual(device);
  });

  it("an app someone else offers, followed live, can't lower what the person's own record asks", () => {
    const own = bundleOf({ contract: 1, id: "techne", name: "Techne", live: { hub: "https://techne.example", vault: "techne", path: "Parachute/Bundles/techne" }, security: { approve: "passcode" } }, "Parachute/Bundles/techne", "01T")!;
    const theirs = { contract: 1, id: "techne", name: "Their name", sources: [{ vault: "techne", applet: "*" }], security: { approve: "unlock" } };
    const merged = bundleOf(followed(own, { name: "Techne" }, theirs), "Parachute/Bundles/techne", "01T")!;
    expect(merged.security).toEqual({ code: "passcode" });
    // each level the stricter of the two: theirs may raise what the person's asks, never lower it
    const own2 = bundleOf({ contract: 1, id: "techne", name: "Techne", live: { hub: "https://techne.example", vault: "techne", path: "Parachute/Bundles/techne" }, security: { approvals: "passcode", idle: 15 } }, "Parachute/Bundles/techne", "01T")!;
    const theirs2 = { ...theirs, security: { approvals: "none", idle: 5, join: "passcode" } };
    expect(bundleOf(followed(own2, {}, theirs2), "Parachute/Bundles/techne", "01T")!.security).toEqual({ approvals: "passcode", idle: 5, join: "passcode" });
    expect(merged.name).toBe("Techne");
    expect(merged.sources).toEqual([{ vault: "techne", applet: "*" }]);
  });

  it("a record that doesn't parse is no app: the device opens the next one it can, never nothing", () => {
    const broken = [bundleOf({ contract: 9, id: "uni", name: "Uni" }, "Parachute/Bundles/uni", "n"), bundleOf({ contract: 1, id: "Uni!", name: "Uni" }, "Parachute/Bundles/Uni!", "n"), bundleOf("not an object", "Parachute/Bundles/uni", "n")];
    expect(broken).toEqual([null, null, null]);
    expect(openBundle(bundlesFrom([]), "uni", "uni").id).toBe("everything");
    expect(openBundle(bundlesFrom([]), "uni", "simple").id).toBe("simple");
  });
});
