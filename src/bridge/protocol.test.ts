// Where the frame may send the person (allowedDestination): the app's own screens, and nothing that only looks like one.
import { describe, expect, it } from "vitest";
import { allowedDestination } from "./protocol";

describe("the frame's destinations", () => {
  it("the simple app's screens: a new note, a note's words, Connect, Capture", () => {
    for (const to of ["/v/kitchen/new", "/v/kitchen/n/01ABC/edit", "/connect", "/capture", "/?in=kitchen&q=beans"]) expect(allowedDestination(to), to).toBe(true);
  });
  it("as before: the launcher, a vault, a note, an applet, Settings, Add", () => {
    for (const to of ["/", "/v/kitchen", "/v/kitchen/n/01ABC", "/v/kitchen/a/01DEF", "/settings", "/add"]) expect(allowedDestination(to), to).toBe(true);
  });
  it("not an applet's edit, not deeper paths, not another origin or a sign-in's return", () => {
    for (const to of ["/v/kitchen/a/01DEF/edit", "/v/kitchen/n/01ABC/edit/x", "/v/kitchen/new/x", "/v/kitchen/x/01ABC/edit", "/oauth/callback", "/key", "//evil.example/connect", "https://evil.example/capture", "/connect/x"]) expect(allowedDestination(to), to).toBe(false);
  });
});
