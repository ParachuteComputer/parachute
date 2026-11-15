import { describe, expect, it } from "vitest";
import { linkFor, parseLinkIn } from "./parse";

const wrap = (address: string) => `parachute://open?url=${encodeURIComponent(address)}`;

describe("parseLinkIn", () => {
  it.each([
    ["https://hub.example/surface/parachute/v/recipes/n/01M7FTB30C17B1VBZS5N75B94R"],
    ["https://hub.example/app/v/recipes/n/01M7FTB30C17B1VBZS5N75B94R"],
    ["https://hub.example/v/recipes/n/01M7FTB30C17B1VBZS5N75B94R"],
    ["https://hub.example:8443/surface/notes/v/recipes/n/01M7FTB30C17B1VBZS5N75B94R/"],
  ])("reads %s", (address) => {
    const r = parseLinkIn(wrap(address));
    expect(r).toEqual({ ok: true, issuer: new URL(address).origin, vault: "recipes", note: "01M7FTB30C17B1VBZS5N75B94R" });
  });
  it("reads the link the app itself hands out", () => {
    expect(parseLinkIn(linkFor("https://hub.example", "recipes", "01ABC"))).toEqual({ ok: true, issuer: "https://hub.example", vault: "recipes", note: "01ABC" });
  });
  it.each([
    ["", /empty/],
    ["https://hub.example/v/recipes/n/abc", /isn't a link Parachute knows/],
    ["parachute://evil?url=x", /isn't a link Parachute knows/],
    ["parachute://open/more?url=x", /isn't a link Parachute knows/],
    [`${wrap("https://hub.example/v/recipes/n/abc")}&next=https://evil.example`, /doesn't read/],
    [`${wrap("https://hub.example/v/recipes/n/abc")}&url=x`, /doesn't read/],
    [wrap("http://hub.example/v/recipes/n/abc"), /secure/],
    [wrap("javascript:alert(1)"), /secure/],
    [wrap("https://me:pw@hub.example/v/recipes/n/abc"), /name and password/],
    [wrap("https://hub.example/v/recipes"), /note's address/],
    [wrap("https://hub.example/v/Recipes/n/abc"), /note's address/],
    [wrap("https://hub.example/v/recipes/n/..%2F..%2Fx"), /note's address/],
    [wrap("https://hub.example/evil/v/recipes/n/abc"), /note's address/],
    [wrap(`https://hub.example/v/recipes/n/${"a".repeat(2000)}`), /too long/],
  ])("refuses %j", (raw, why) => {
    const r = parseLinkIn(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(why);
  });
});
