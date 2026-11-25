// What a screen says when a vault read fails (T-476): a read that reached no hub in plain words, never the request line;
// a bug's own error is not dressed up as the network.
import { VaultServerError, VaultUnreachableError } from "@openparachute/surface-client";
import { describe, expect, it } from "vitest";
import { messageOf } from "./hooks";

describe("messageOf", () => {
  it("a read that reached no hub says so plainly, in every engine's words", () => {
    expect(messageOf(new VaultUnreachableError("GET /api/notes?id=x failed: Failed to fetch", 0))).toBe("Can't reach the vault just now.");
    for (const m of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) expect(messageOf(new TypeError(m))).toBe("Can't reach the vault just now.");
  });
  it("a hub that answered with an error, or a bug, keeps its own words", () => {
    expect(messageOf(new VaultServerError("GET /api/notes failed: 502", 502))).not.toBe("Can't reach the vault just now.");
    expect(messageOf(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe("Cannot read properties of undefined (reading 'id')");
  });
});
