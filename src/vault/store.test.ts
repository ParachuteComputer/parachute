import { describe, expect, it } from "vitest";
import { keyFor, type VaultRecord } from "./store";

const rec = (key: string, issuer: string, vault: string) => ({ key, issuer, vault } as VaultRecord);

describe("keyFor", () => {
  it("is the vault's name when no other vault has it", () => expect(keyFor([], "https://a.example", "recipes")).toBe("recipes"));
  it("keeps the key of the same hub and vault (signing in again)", () =>
    expect(keyFor([rec("recipes@a.example", "https://a.example", "recipes")], "https://a.example", "recipes")).toBe("recipes@a.example"));
  it("adds the host when another hub holds a vault of that name", () =>
    expect(keyFor([rec("recipes", "https://a.example", "recipes")], "https://b.example", "recipes")).toBe("recipes@b.example"));
});
