import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshOnce } from "./client";
import { findVault, saveVault } from "./store";

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

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
  it("a request that set off with the old token and fails just after a refresh takes the fresh token: no second refresh", async () => {
    // on core 0.9 each refresh retires the token before it: refreshing again for a straggler would retire the token
    // every other request has just been given (seen in CI: a vault's page lost its fresh token to its own stragglers)
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
    saveVault({ issuer: "https://hub.example", vault: "pantry", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c", accessToken: "spoiled", refreshToken: "r1", scope: "", addedAt: "" });
    let calls = 0;
    const hub = (async () => { calls++; return new Response(JSON.stringify({ access_token: `new${calls}`, refresh_token: `r${calls + 1}` })); }) as unknown as typeof fetch;
    expect(await refreshOnce("pantry", hub)).toBe("new1");
    vi.setSystemTime(new Date("2026-11-17T08:00:02Z"));
    expect(await refreshOnce("pantry", hub)).toBe("new1");
    expect(calls).toBe(1);
    // later, a refusal is a real one: refreshed again
    vi.setSystemTime(new Date("2026-11-17T08:00:30Z"));
    expect(await refreshOnce("pantry", hub)).toBe("new2");
    expect(calls).toBe(2);
  });
});
