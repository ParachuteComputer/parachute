import { describe, expect, it } from "vitest";
import { RefreshHttpError, VaultAuthError, VaultNotFoundError, VaultPermissionError, VaultUnreachableError } from "@openparachute/surface-client";
import { failureOf } from "./failure";

describe("failureOf", () => {
  it("a request that reached no one is unreached, whatever the engine called it", () => {
    expect(failureOf(new VaultUnreachableError("GET /api/notes failed: Load failed", 0))).toBe("unreached");
    expect(failureOf(new TypeError("Failed to fetch"))).toBe("unreached");
  });
  it("a refused sign-in is refused; anything else is other", () => {
    expect(failureOf(new VaultAuthError("expired", 401))).toBe("refused");
    expect(failureOf(new VaultPermissionError())).toBe("refused");
    expect(failureOf(new RefreshHttpError(400, '{"error":"invalid_grant"}'))).toBe("refused");
    expect(failureOf(new VaultNotFoundError())).toBe("other");
    expect(failureOf(new Error("its code doesn't compile"))).toBe("other");
    expect(failureOf("Load failed")).toBe("other");
  });
});
