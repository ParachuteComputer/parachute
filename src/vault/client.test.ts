import { beforeEach, describe, expect, it } from "vitest";
import { refreshOnce } from "./client";
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
});
