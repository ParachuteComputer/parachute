import { describe, expect, it } from "vitest";
import { reachOf, viewBase } from "./published";
import { CLOUD } from "./parachute";

describe("a published record's link", () => {
  it("is the hub's page under the vault's address", () => {
    expect(viewBase({ issuer: "https://hub.example", vault: "home" })).toBe("https://hub.example/vault/home/view/");
    expect(viewBase({ issuer: "https://hub.example", vault: "home", url: "https://vaults.example/home/" })).toBe("https://vaults.example/home/view/");
  });
  it("is none on Parachute Cloud, which has no page for it yet (a link there would be a 404)", () => {
    expect(viewBase({ issuer: CLOUD, vault: "home", url: "https://my.parachute.computer/vault/home" })).toBeNull();
  });
});

describe("who can open an address", () => {
  it.each([
    ["http://127.0.0.1:27401/vault/default/view/x", "this-device"],
    ["http://localhost:1939/v", "this-device"],
    ["http://Localhost:1939/v", "this-device"],
    ["http://hub.localhost/v", "this-device"],
    ["http://[::1]:1939/v", "this-device"],
    ["http://0.0.0.0:1939/v", "this-device"],
    ["http://192.168.1.20:1939/v", "network"],
    ["http://10.0.0.5/v", "network"],
    ["http://172.20.0.5/v", "network"],
    ["https://100.99.1.2/v", "network"],
    ["https://my-mac.tail1234.ts.net/v", "network"],
    ["http://nas.local:1939/v", "network"],
    ["https://hub.example/v", "anyone"],
    ["https://127.example.com/v", "anyone"],
    ["https://172.40.0.5/v", "anyone"],
  ])("%s → %s", (address, reach) => {
    expect(reachOf(address)).toBe(reach);
  });
});
