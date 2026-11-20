import { describe, expect, it } from "vitest";
import { isWriteRefusal, NeedsWriteError } from "./writeAsk";

describe("a refused change, told apart from other failures", () => {
  it("the refusal itself, or as the vault client wraps it, for this vault only", () => {
    const own = new NeedsWriteError("garden", "k1");
    expect(isWriteRefusal(own, "garden")).toBe(true);
    expect(isWriteRefusal(new Error(`POST /api/notes failed: ${own.message}`), "garden")).toBe(true);
    expect(isWriteRefusal(new Error(`POST /api/notes failed: ${new NeedsWriteError("work", "k2").message}`), "garden")).toBe(false);
  });
  it("anything else is not: a path taken, the network, a note the vault doesn't list", () => {
    expect(isWriteRefusal(new Error("A note at Applets/Journal that isn't Journal is in garden already: rename it, then add Journal again."), "garden")).toBe(false);
    expect(isWriteRefusal(new Error("POST /api/notes failed: Failed to fetch"), "garden")).toBe(false);
    expect(isWriteRefusal("nope", "garden")).toBe(false);
  });
});
