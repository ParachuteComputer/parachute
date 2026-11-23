// Where the frame may send the person (allowedDestination): the app's own screens, and nothing that only looks like one.
import { describe, expect, it } from "vitest";
import { allowedDestination, parseRequest, PF } from "./protocol";

describe("the frame's destinations", () => {
  it("Parachute Simplified's screens: a new note, a note's words, Connect, Capture, Journal", () => {
    for (const to of ["/v/kitchen/new", "/v/kitchen/n/01ABC/edit", "/connect", "/capture", "/journal", "/?in=kitchen&q=beans"]) expect(allowedDestination(to), to).toBe(true);
  });
  it("as before: the launcher, a vault, a note, an applet, Settings, Add", () => {
    for (const to of ["/", "/v/kitchen", "/v/kitchen/n/01ABC", "/v/kitchen/a/01DEF", "/settings", "/add"]) expect(allowedDestination(to), to).toBe(true);
  });
  it("not an applet's edit, not deeper paths, not another origin or a sign-in's return", () => {
    for (const to of ["/v/kitchen/a/01DEF/edit", "/v/kitchen/n/01ABC/edit/x", "/v/kitchen/new/x", "/v/kitchen/x/01ABC/edit", "/oauth/callback", "/key", "//evil.example/connect", "https://evil.example/capture", "/connect/x"]) expect(allowedDestination(to), to).toBe(false);
  });
});

describe("vault.query offset", () => {
  it("accepts non-negative integer offset up to 1_000_000 and refuses invalid offsets", () => {
    expect(parseRequest({ pf: PF, id: "q1", method: "vault.query", params: { vault: "home", query: { limit: 200, offset: 200 } } })).toMatchObject({ method: "vault.query" });
    expect(parseRequest({ pf: PF, id: "q2", method: "vault.query", params: { vault: "home", query: { limit: 200, offset: 0 } } })).toMatchObject({ method: "vault.query" });
    for (const bad of [-1, 1.5, "200", 1_000_001]) {
      expect(parseRequest({ pf: PF, id: "q3", method: "vault.query", params: { vault: "home", query: { limit: 200, offset: bad } } })).toMatchObject({ error: "bad_params" });
    }
  });
});
