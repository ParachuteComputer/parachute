import { describe, expect, it } from "vitest";
import { isLoopback, VAULT_NAME } from "./address";

describe("what addresses share", () => {
  it("plain http only on this machine", () => {
    for (const h of ["localhost", "127.0.0.1", "127.9.9.9", "[::1]"]) expect(isLoopback(h), h).toBe(true);
    for (const h of ["127.0.0.1.evil.example", "hub.example", "0.0.0.0", "10.0.0.1"]) expect(isLoopback(h), h).toBe(false);
  });
  it("a vault's name", () => {
    for (const n of ["recipes", "my_notes", "a-1"]) expect(VAULT_NAME.test(n), n).toBe(true);
    for (const n of ["Recipes", "-x", "_x", "a/b", "", "x".repeat(65)]) expect(VAULT_NAME.test(n), n).toBe(false);
  });
});
