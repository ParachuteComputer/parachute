import { describe, expect, it } from "vitest";
import { parseAddress } from "./address";

describe("parseAddress", () => {
  it.each([
    ["https://hub.example/vault/recipes", "https://hub.example", "recipes"],
    ["hub.example/vault/recipes/", "https://hub.example", "recipes"],
    ["  https://HUB.example:8443/vault/my_notes  ", "https://hub.example:8443", "my_notes"],
    ["https://hub.example/vault/recipes/api", "https://hub.example", "recipes"],
    ["https://hub.example/vault/recipes/mcp", "https://hub.example", "recipes"],
    ["http://127.0.0.1:1939/vault/default", "http://127.0.0.1:1939", "default"],
  ])("%s → %s, %s", (input, issuer, vault) => {
    expect(parseAddress(input)).toEqual({ ok: true, address: { issuer, vault } });
  });

  it.each([
    ["", "Type"],
    ["https://hub.example", "Add the vault's name"],
    ["https://hub.example/notes/recipes", "looks like"],
    ["https://hub.example/vault/Recipes", "can't be right"],
    ["https://hub.example/vault/a/b", "looks like"],
    ["ftp://hub.example/vault/x", "starts with https"],
    ["http://hub.example/vault/x", "starts with https"],
    ["javascript:alert(1)", "isn't a web address"],
    ["https://me:pw@hub.example/vault/x", "name and password"],
    ["https://hub.example/vault/x?y=1", "after ?"],
  ])("refuses %j", (input, words) => {
    const r = parseAddress(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(words);
  });
});
