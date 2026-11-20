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
  // Found in review (T-476): giving write back keeps a read-only sign-in and ends the one that could write. A refresh
  // of the old one still on its way then laid its read+write tokens over the record that said "reads".
  it("a refresh that comes back after the sign-in was replaced is ended at the hub, never laid over the record", async () => {
    const base = { issuer: "https://hub.example", vault: "letters", tokenEndpoint: "https://hub.example/oauth/token", revocationEndpoint: "https://hub.example/oauth/revoke", clientId: "c", addedAt: "" };
    saveVault({ ...base, accessToken: "rwA1", refreshToken: "rw1", scope: "vault:letters:read vault:letters:write" });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const revoked: string[] = [];
    const hub = (async (u: unknown, init?: RequestInit) => {
      if (String(u).endsWith("/oauth/revoke")) { revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? ""); return new Response("{}"); }
      await gate;
      return new Response(JSON.stringify({ access_token: "rwA2", refresh_token: "rw2" }));
    }) as unknown as typeof fetch;
    const running = refreshOnce("letters", hub);
    // the person gave write back meanwhile (signInFlow.ts keep): the record now holds the read-only sign-in
    saveVault({ ...base, accessToken: "readA", refreshToken: "read1", scope: "vault:letters:read" });
    release();
    expect(await running).toBe("readA");
    const rec = findVault("letters")!;
    expect({ refresh: rec.refreshToken, access: rec.accessToken, scope: rec.scope }).toEqual({ refresh: "read1", access: "readA", scope: "vault:letters:read" });
    await new Promise((r) => setTimeout(r, 0));
    expect(revoked).toEqual(["rw2"]);
  });
  it("the hub refusing a refresh of a sign-in that was replaced meanwhile isn't a refusal of the one held now", async () => {
    const base = { issuer: "https://hub.example", vault: "attic2", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c", addedAt: "" };
    saveVault({ ...base, accessToken: "rwA1", refreshToken: "rw1", scope: "vault:attic2:read vault:attic2:write" });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // the old sign-in was ended at the hub (keep's revoke) before its refresh got there: 400
    const hub = (async () => { await gate; return new Response("{}", { status: 400 }); }) as unknown as typeof fetch;
    const running = refreshOnce("attic2", hub);
    saveVault({ ...base, accessToken: "readA", refreshToken: "read1", scope: "vault:attic2:read" });
    release();
    expect(await running).toBe("readA");
    expect(findVault("attic2")?.refreshToken).toBe("read1");
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
    // a 403 for a replaced token goes again too; a stopped request stays stopped
    seen.length = 0;
    const forbids = (async (_u: unknown, init?: RequestInit) => { const t = new Headers(init?.headers).get("Authorization") ?? ""; seen.push(t); return new Response("{}", { status: t === "Bearer fresh" ? 200 : 403 }); }) as unknown as typeof fetch;
    expect((await withCurrentToken("pantry", forbids)("https://hub.example/x", { headers: { Authorization: "Bearer old" } })).status).toBe(200);
    seen.length = 0;
    const aborts = (async (_u: unknown, init?: RequestInit) => { seen.push(new Headers(init?.headers).get("Authorization") ?? ""); throw new DOMException("stopped", "AbortError"); }) as unknown as typeof fetch;
    await expect(withCurrentToken("pantry", aborts)("https://hub.example/x", { headers: { Authorization: "Bearer old" } })).rejects.toThrow("stopped");
    expect(seen).toEqual(["Bearer old"]);
    // the current token refused: nothing to retry with, the refusal goes to the caller (and its refresh)
    saveVault({ issuer: "https://hub.example", vault: "pantry", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c", accessToken: "revoked", refreshToken: "r1", scope: "", addedAt: "" });
    seen.length = 0;
    expect((await f("https://hub.example/vault/pantry/api/records", { headers: { Authorization: "Bearer revoked" } })).status).toBe(401);
    expect(seen).toEqual(["Bearer revoked"]);
  });
  it("a refusal that arrives while the vault's refresh is on its way waits for it, then goes with the new token", async () => {
    saveVault({ issuer: "https://hub.example", vault: "attic", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c", accessToken: "old", refreshToken: "r1", scope: "", addedAt: "" });
    let release!: () => void;
    const slowHub = (async () => { await new Promise<void>((r) => { release = r; }); return new Response(JSON.stringify({ access_token: "fresh", refresh_token: "r2" })); }) as unknown as typeof fetch;
    const refreshed = refreshOnce("attic", slowHub);
    const seen: string[] = [];
    const vault = (async (_u: unknown, init?: RequestInit) => { const t = new Headers(init?.headers).get("Authorization") ?? ""; seen.push(t); return new Response("{}", { status: t === "Bearer fresh" ? 200 : 401 }); }) as unknown as typeof fetch;
    const read = withCurrentToken("attic", vault)("https://hub.example/x", { headers: { Authorization: "Bearer old" } });
    await new Promise((r) => setTimeout(r, 5));
    release();
    expect((await read).status).toBe(200);
    expect(await refreshed).toBe("fresh");
    expect(seen).toEqual(["Bearer old", "Bearer fresh"]);
  });
});
