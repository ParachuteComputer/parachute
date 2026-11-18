import { describe, expect, it } from "vitest";
import { outcomeLines } from "./notify";

const host = (u: string) => new URL(u).host;
const o = (x: Partial<Parameters<typeof outcomeLines>[0] & object> = {}) => ({ unread: [], noKey: false, asking: 1, failed: [], ...x });

describe("what Settings says about notifications while closed", () => {
  it("nothing to say when all went through", () => {
    expect(outcomeLines(null, host)).toEqual([]);
    expect(outcomeLines(o(), host)).toEqual([]);
  });
  it("a vault it couldn't read: nothing was handed on, and when it tries again", () => {
    expect(outcomeLines(o({ unread: ["uni", "arcade"] }), host)).toEqual(["Couldn't read uni, arcade just now, so what your applets ask for wasn't brought up to date. Parachute tries again when it comes back to the front."]);
  });
  it("no applet asking yet, and each gateway that refused this phone, with its reason", () => {
    expect(outcomeLines(o({ asking: 0 }), host)).toEqual(["No applet asks to tell you anything yet. Rooms does once you allow it."]);
    expect(outcomeLines(o({ failed: [{ gateway: "https://uni.example.ts.net:8567/", why: "The gateway refused the registration (400: endpoint on that host must be its push server)." }] }), host))
      .toEqual(["uni.example.ts.net:8567 didn't take this phone: The gateway refused the registration (400: endpoint on that host must be its push server)."]);
  });
  it("no key on the device says so first", () => {
    expect(outcomeLines(o({ noKey: true, unread: ["uni"] }), host)).toEqual(["This device has no key yet, so nothing can tell you anything while Parachute is closed."]);
  });
});
