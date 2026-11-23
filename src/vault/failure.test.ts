import { describe, expect, it } from "vitest";
import { VaultAuthError, VaultNotFoundError, VaultPermissionError, VaultServerError, VaultUnreachableError } from "@openparachute/surface-client";
import { failureOf } from "./failure";
import { TooLargeError } from "./limited";

describe("failureOf", () => {
  it("a request that reached no one is offline, whatever the engine called it", () => {
    expect(failureOf(new VaultUnreachableError("GET /api/notes failed: Load failed", 0))).toBe("offline");
    expect(failureOf(new TypeError("Failed to fetch"))).toBe("offline");
  });
  it("a 401 is a refused sign-in; a 403 is the vault's answer and a 5xx a hub that was reached", () => {
    expect(failureOf(new VaultAuthError("expired", 401))).toBe("refused");
    expect(failureOf(new VaultPermissionError())).toBe("other");
    expect(failureOf(new VaultServerError("GET /api/notes: 500", 500))).toBe("other");
  });
  it("too large is large; anything else is other", () => {
    expect(failureOf(new TooLargeError())).toBe("large");
    expect(failureOf(new VaultNotFoundError())).toBe("other");
    expect(failureOf(new Error("its code doesn't compile"))).toBe("other");
    expect(failureOf("Load failed")).toBe("other");
  });
});
