import { beforeEach, describe, expect, it } from "vitest";
import { completeSignIn, PendingApprovalError, type Pending } from "./oauth";

const PENDING = "parachute.oauth.pending.v1";
const pending = (over: Partial<Pending> = {}): Pending => ({ issuer: "https://hub.example", vault: "recipes", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c1",
  codeVerifier: "v", state: "s1", redirectUri: "http://localhost/oauth/callback", startedAt: Date.now(), ...over });
// the hub's token endpoint, which this app does not control: answered here
const hub = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(() => localStorage.clear());

describe("completeSignIn", () => {
  it("stores nothing and refuses when the state doesn't match the flow this app started", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "other", hub(200, { access_token: "t", scope: "vault:recipes:read" }))).rejects.toThrow(/doesn't match/);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
  it("refuses a second use of the same flow", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await completeSignIn("code", "s1", hub(200, { access_token: "t", vault: "recipes", scope: "vault:recipes:read vault:recipes:write" }));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", vault: "recipes" }))).rejects.toThrow(/expired or was already used/);
  });
  it("refuses a flow older than half an hour", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending({ startedAt: Date.now() - 31 * 60_000 })));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", vault: "recipes" }))).rejects.toThrow(/expired/);
  });
  it("refuses an account-wide token: it can't read the vault", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "account:self:vaults" }))).rejects.toThrow(/other than the recipes vault/);
  });
  it("refuses a token for another vault", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", vault: "journal", scope: "vault:journal:read" }))).rejects.toThrow(/other than the recipes vault/);
  });
  it("accepts a token whose scope names the vault", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    const r = await completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "vault:recipes:read vault:recipes:write" }));
    expect(r.vault).toBe("recipes");
  });
  it("says the hub wants the app approved, with the hub's own approve address", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    const e = await completeSignIn("code", "s1", hub(400, { error: "invalid_client", approve_url: "https://hub.example/admin/approve-client/c1" })).catch((x) => x);
    expect(e).toBeInstanceOf(PendingApprovalError);
    expect((e as PendingApprovalError).approveUrl).toBe("https://hub.example/admin/approve-client/c1");
  });
  it("never offers a non-web approve address", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    const e = await completeSignIn("code", "s1", hub(400, { error: "invalid_client", approve_url: "javascript:alert(1)" })).catch((x) => x);
    expect(e).not.toBeInstanceOf(PendingApprovalError);
  });
});
