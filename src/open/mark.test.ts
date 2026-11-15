import { beforeEach, describe, expect, it } from "vitest";
import { arrived, carryMark, markTap, setClock, takeMark } from "./mark";

let now = 0;
beforeEach(() => { now = 1_000; setClock(() => now); takeMark("x"); });

describe("tap marks", () => {
  it("start the screen they were made for, once", () => {
    markTap("/v/recipes/n/abc");
    expect(takeMark("/v/recipes/n/abc")).toBe(true);
    expect(takeMark("/v/recipes/n/abc")).toBe(false);
  });
  it("lapse after 10 seconds", () => {
    markTap("/v/recipes/n/abc");
    now += 10_001;
    expect(takeMark("/v/recipes/n/abc")).toBe(false);
  });
  it("are dropped when the person goes somewhere else first, so an old tap can't start a later link from outside", () => {
    markTap("/v/recipes/n/abc");
    arrived("/v/recipes");
    arrived("/v/recipes/n/abc");
    expect(takeMark("/v/recipes/n/abc")).toBe(false);
  });
  it("move with the note route's decision to the applet's screen, and only from the note tapped", () => {
    markTap("/v/recipes/n/abc");
    expect(carryMark("/v/recipes/n/other", "/v/recipes/a/app?note=other")).toBe(false);
    markTap("/v/recipes/n/abc");
    expect(carryMark("/v/recipes/n/abc", "/v/recipes/a/app")).toBe(true);
    expect(takeMark("/v/recipes/n/abc")).toBe(false);
  });
  it("aren't made for other addresses", () => {
    markTap("/settings");
    expect(takeMark("/settings")).toBe(false);
  });
});
