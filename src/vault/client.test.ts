import { beforeEach, describe, expect, it } from "vitest";
import { refreshOnce, withCurrentToken } from "./client";
import { findVault, saveVault } from "./store";

beforeEach(() => localStorage.clear());

describe("refreshOnce", () => {
  it("sends one refresh for two overlapping expiries, and stores the rotated token", async () => {
    saveVault({ issuer: "https://hub.example", vault: "recipes", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c", accessToken: "old", refreshToken: "r1", scope: "", addedAt: "" });
    let calls = 0;
    // the hub's token endpoint: rotates r1 to r2 once; a second use of r1 would be a replay
    const hub = (async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return new Response(JSON.stringify({ access_token: `new${calls}`, refresh_token: `r${calls + 1}` })); }) as unknown as typeof fetch;
    const [a, b] = await Promise.all([refreshOnce("recipes", hub), refreshOnce("recipes", hub)]);
    expect(calls).toBe(1);
    expect(a).toBe("new1"); expect(b).toBe("new1");
    expect(findVault("recipes")?.refreshToken).toBe("r2");
  });
  it("a request refused with a token since replaced goes again with the current one; a refusal of the current one stands", async () => {
    // on core 0.9 each refresh retires the token before it: a straggler that refreshed again would take the fresh token
    // away from every other request (seen in CI: a vault's page lost its token to its own parallel reads)
    saveVault({ issuer: "https://hub.example", vault: "pantry", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c", accessToken: "fresh", refreshToken: "r1", scope: "", addedAt: "" });
    const seen: string[] = [];
    // the hub's vault: takes only the fresh token; one that is replaced it refuses, unreadably (no CORS headers)
    const hub = (async (_u: unknown, init?: RequestInit) => {
      const t = new Headers(init?.headers).get("Authorization") ?? "";
      seen.push(t);
      if (t === "Bearer old") throw new TypeError("Failed to fetch");
      return new Response("{}", { status: t === "Bearer fresh" ? 200 : 401 });
    }) as unknown as typeof fetch;
    const f = withCurrentToken("pantry", hub);
    expect((await f("https://hub.example/vault/pantry/api/records", { headers: { Authorization: "Bearer old" } })).status).toBe(200);
    expect(seen).toEqual(["Bearer old", "Bearer fresh"]);
    // a write whose fetch threw may have been saved: not sent twice
    seen.length = 0;
    await expect(f("https://hub.example/vault/pantry/api/records", { method: "POST", body: "{}", headers: { Authorization: "Bearer old" } })).rejects.toThrow("Failed to fetch");
    expect(seen).toEqual(["Bearer old"]);
    // the current token refused: nothing to retry with, the refusal goes to the caller (and its refresh)
    saveVault({ issuer: "https://hub.example", vault: "pantry", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c", accessToken: "revoked", refreshToken: "r1", scope: "", addedAt: "" });
    seen.length = 0;
    expect((await f("https://hub.example/vault/pantry/api/records", { headers: { Authorization: "Bearer revoked" } })).status).toBe(401);
    expect(seen).toEqual(["Bearer revoked"]);
  });
});
