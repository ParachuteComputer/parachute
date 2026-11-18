import { describe, expect, it } from "vitest";
import { outcomeLines, toRegister } from "./notify";

const host = (u: string) => new URL(u).host;
const o = (x: Partial<Parameters<typeof outcomeLines>[0] & object> = {}) => ({ unread: [], noKey: false, asking: 1, failed: [], ...x });

describe("what Settings says about notifications while closed", () => {
  it("nothing to say when all went through", () => {
    expect(outcomeLines(null, host)).toEqual([]);
    expect(outcomeLines(o(), host)).toEqual([]);
  });
  it("a vault it couldn't read: nothing was handed on, and when it tries again", () => {
    expect(outcomeLines(o({ unread: ["uni", "arcade"] }), host)).toEqual(["Couldn't reach uni, arcade just now, so notifications weren't updated. Parachute tries again when you come back to it."]);
  });
  it("no applet asking yet, and each gateway that refused, with its reason, once", () => {
    expect(outcomeLines(o({ asking: 0 }), host)).toEqual(["No applet asks to tell you anything yet. Rooms does once you allow it."]);
    const refused = { gateway: "https://uni.example.ts.net:8567/", why: "The gateway refused the registration (400: endpoint on that host must be its push server)." };
    // two relays on one gateway, refused alike: one line
    expect(outcomeLines(o({ failed: [refused, refused] }), host))
      .toEqual(["Couldn't register with uni.example.ts.net:8567: The gateway refused the registration (400: endpoint on that host must be its push server)."]);
  });
  it("a step that failed says so, and a key it couldn't read says that first", () => {
    expect(outcomeLines(o({ asking: 0, error: "notify_set failed" }), host)).toEqual(["Notifications weren't updated: notify_set failed"]);
    expect(outcomeLines(o({ noKey: true, unread: ["uni"] }), host)).toEqual(["Couldn't read this device's key just now, so notifications weren't updated."]);
  });
});

describe("which gateways a phone registers with", () => {
  const want = [{ gateway: "https://g.example/", relay: "wss://r.example" }];
  it("none without a push service: Parachute's own connection serves the applets, and nothing is reported refused", async () => {
    let asked = 0;
    expect(await toRegister(want, { distributors: [], distributor: null }, async () => { asked++; })).toEqual([]);
    expect(asked).toBe(0);
  });
  it("the only one installed is chosen first, then all of them; a refused choice registers none", async () => {
    let asked = 0;
    expect(await toRegister(want, { distributors: [{ id: "io.heckel.ntfy", name: "ntfy" }], distributor: null }, async () => { asked++; })).toEqual(want);
    expect(asked).toBe(1);
    expect(await toRegister(want, { distributors: [{ id: "io.heckel.ntfy", name: "ntfy" }], distributor: null }, async () => { throw new Error("no"); })).toEqual([]);
  });
  it("one in use: all of them; several and none chosen: none (the person picks)", async () => {
    const two = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    expect(await toRegister(want, { distributors: two, distributor: "b" }, async () => {})).toEqual(want);
    expect(await toRegister(want, { distributors: two, distributor: null }, async () => {})).toEqual([]);
  });
});
