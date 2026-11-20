// @vitest-environment node
// An older app opening a record set written for a newer one (docs/design/VERSIONS.md): Aaron's own records, as
// scripts/install-applets.ts writes them, then made newer the three ways a newer app writes: `needs` past this app's
// level, a manifest key it doesn't know, an app record for a later level. Nothing of them is read further or allowed;
// each is listed by its name, so its screen can say "Update Parachute to use …".
import { describe, expect, it } from "vitest";
import { appletRecord } from "../../applets/record";
import { discoverApplets, readApplet } from "./discovery";
import { APP_LEVEL, updateLine } from "./level";
import { appOf, newerApp, placeOf } from "../shell/apps";

const vars = { relay: "wss://relay.example", mail: "https://mail.example/mail/", uni: "a".repeat(64), push: "https://push.example/" };
const row = (name: string, i: number, change: (f: Record<string, unknown>) => Record<string, unknown> = (f) => f) => {
  const r = appletRecord(name, vars);
  return { id: `01NOTE${i}`, path: r.path, tags: r.tags, metadata: change(r.fields) };
};
const names = ["today", "rooms", "mail", "journal", "accounts"];

describe("an older app opening a newer record set", () => {
  it("today's records run here as they are", () => {
    const found = discoverApplets(names.map((n, i) => row(n, i)), "home");
    expect(found.skipped).toBe(0);
    expect(found.entries.map((e) => [e.manifest.name, !!e.newer])).toEqual([["Claude accounts", false], ["Home", false], ["Journal", false], ["Mail", false], ["Rooms", false]]);
  });

  it("records that need a later app are listed by name, with nothing asked, allowed or run", () => {
    const later = { needs: APP_LEVEL + 1 };
    const found = discoverApplets(names.map((n, i) => row(n, i, (f) => ({ ...f, ...later }))), "home");
    expect(found.skipped).toBe(0);
    for (const e of found.entries) {
      expect(e.newer, e.manifest.name).toBe(true);
      expect({ allow: e.manifest.allow, services: e.services, signals: e.signals, app: e.app, opens: e.opens, search: e.manifest.search, reach: e.manifest.reach }, e.manifest.name)
        .toEqual({ allow: [], services: [], signals: [], app: [], opens: [], search: [], reach: undefined });
    }
    const home = found.entries.find((e) => e.path === "Applets/Home")!;
    expect([home.manifest.name, home.manifest.glyph, home.manifest.id]).toEqual(["Home", "◠", "home"]);
    expect(updateLine(home.manifest.name)).toBe("Update Parachute to use Home.");
    // the same record on an app at that level reads as it is
    const there = readApplet(row("today", 0, (f) => ({ ...f, ...later })), "home", false, () => false, APP_LEVEL + 1);
    expect(there.ok && !there.entry.newer && there.entry.services.length).toBe(1);
  });

  it("a manifest key or contract this app doesn't know reads as newer, not as broken", () => {
    const key = readApplet(row("today", 0, (f) => ({ ...f, applet: { ...(f.applet as object), later: { anything: true } } })), "home");
    expect(key.ok && key.entry.newer && key.entry.manifest.name).toBe("Home");
    const contract = readApplet(row("mail", 1, (f) => ({ ...f, applet: { ...(f.applet as object), contract: 3 } })), "home");
    expect(contract.ok && contract.entry.newer && contract.entry.manifest.name).toBe("Mail");
    // a mistake is still a mistake: a known key with a wrong value is refused, and says why
    const wrong = readApplet(row("mail", 1, (f) => ({ ...f, applet: { ...(f.applet as object), glyph: "two" } })), "home");
    expect(wrong).toEqual({ ok: false, error: "its manifest is invalid: glyph must be one visible character" });
    // a name that isn't a short line isn't shown; the path's last part is
    const odd = readApplet({ ...row("rooms", 2, (f) => ({ ...f, needs: 99, applet: { ...(f.applet as object), name: "x\n".repeat(50) } })) }, "home");
    expect(odd.ok && odd.entry.manifest.name).toBe("Rooms");
    // nor may it take the app's own id
    const own = readApplet(row("rooms", 2, (f) => ({ ...f, needs: 99, applet: { ...(f.applet as object), id: "vault" } })), "home");
    expect(own.ok && own.entry.manifest.id).not.toBe("vault");
  });

  it("an app record for a later app isn't read here; a place with a key this app doesn't know keeps its place", () => {
    const app = { contract: 1, id: "uni", name: "Uni", look: "launcher", sources: [{ vault: "uni", applet: "*" }], bar: [{ vault: "uni", applet: "Applets/Home" }], start: { vault: "uni", applet: "Applets/Home" } };
    expect(appOf(app, "Parachute/Apps/uni", "n1")?.bar).toEqual([{ vault: "uni", applet: "Applets/Home" }]);
    expect(appOf({ ...app, needs: APP_LEVEL + 1 }, "Parachute/Apps/uni", "n1")).toBeNull();
    expect(newerApp({ ...app, needs: APP_LEVEL + 1 })).toBe(true);
    expect(newerApp({ ...app, contract: 2 })).toBe(true);
    expect(newerApp(app)).toBe(false);
    expect(appOf({ ...app, bar: [{ vault: "uni", applet: "Applets/Home", screen: "today" }] }, "Parachute/Apps/uni", "n1")?.bar).toEqual([{ vault: "uni", applet: "Applets/Home" }]);
    expect(placeOf({ vault: "uni", applet: "Applets/Rooms", later: 1 })).toEqual({ vault: "uni", applet: "Applets/Rooms" });
  });
});
