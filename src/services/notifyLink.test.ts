import { describe, expect, it } from "vitest";
import { launchOf, notifyPath } from "./notifyLink";

const ev = "a".repeat(64);
describe("a notification's link", () => {
  it("opens the applet at the room and message", () => {
    expect(notifyPath(`parachute://notify?subject=${encodeURIComponent("/v/k1/a/n1")}&room=garden-1&event=${ev}`)).toBe(`/v/k1/a/n1?room=garden-1&event=${ev}`);
    expect(notifyPath(`parachute://notify/?subject=${encodeURIComponent("/v/k1/a/n1")}&room=garden-1`)).toBe("/v/k1/a/n1?room=garden-1");
  });
  it("goes nowhere but the app's own applet addresses, and drops what isn't a room or an event", () => {
    for (const s of ["https://evil.example/x", "/settings", "/v/k1/a/../x", "//evil.example", "/v/k1/n/n1", "/v/k1/a/n1?x=1"]) expect(notifyPath(`parachute://notify?subject=${encodeURIComponent(s)}&room=r`), s).toBe("/");
    expect(notifyPath(`parachute://notify?subject=${encodeURIComponent("/v/k1/a/n1")}&room=a%20b&event=xyz`)).toBe("/v/k1/a/n1");
    expect(notifyPath("parachute://open?url=x")).toBeNull();
    expect(notifyPath("https://notify")).toBeNull();
  });
  it("hands the applet only a well-formed room and event", () => {
    expect(launchOf(new URLSearchParams(`room=r1&event=${ev}`))).toEqual({ room: "r1", event: ev });
    expect(launchOf(new URLSearchParams("room=r1&event=nope"))).toEqual({ room: "r1" });
    expect(launchOf(new URLSearchParams("event=" + ev))).toBeNull();
  });
});
