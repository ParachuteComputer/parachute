import { beforeEach, describe, expect, it } from "vitest";
import { beginSignIn, completeSignIn, PendingApprovalError, type Pending } from "./oauth";

const PENDING = "parachute.oauth.pending.v1";
const pending = (over: Partial<Pending> = {}): Pending => ({ issuer: "https://hub.example", vault: "recipes", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c1",
  codeVerifier: "v", state: "s1", redirectUri: "http://localhost/oauth/callback", startedAt: Date.now(), ...over });
// the hub's token endpoint, which this app does not control: answered here
const hub = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(() => localStorage.clear());

describe("completeSignIn", () => {
  it("refuses a state that isn't the flow's, before any call to the hub, and leaves the real flow waiting", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    let called = 0;
    const counting = (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch;
    await expect(completeSignIn("code", "other", counting)).rejects.toThrow(/doesn't match/);
    expect(called).toBe(0);
    expect(localStorage.getItem(PENDING)).not.toBeNull();
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

// the hub's discovery, registration and nothing else: what beginSignIn reaches
function discovery(meta: Record<string, string>, registered: string[]) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/.well-known/oauth-authorization-server")) return new Response(JSON.stringify(meta));
    if (url.endsWith("/oauth/register")) { registered.push(url); return new Response(JSON.stringify({ client_id: `client-${registered.length}` }), { status: 201 }); }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}
const META = { issuer: "https://hub.example", authorization_endpoint: "https://hub.example/oauth/authorize", token_endpoint: "https://hub.example/oauth/token", registration_endpoint: "https://hub.example/oauth/register", code_challenge_methods_supported: ["S256"] } as unknown as Record<string, string>;

describe("beginSignIn", () => {
  it("asks for the named vault's scopes with S256, and registers once per hub", async () => {
    const reg: string[] = [];
    const first = new URL(await beginSignIn({ issuer: "https://hub.example", vault: "recipes" }, discovery(META, reg)));
    expect(first.searchParams.get("scope")).toBe("vault:recipes:read vault:recipes:write");
    expect(first.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first.searchParams.get("client_id")).toBe("client-1");
    // the first flow came back
    localStorage.removeItem(PENDING);
    const second = new URL(await beginSignIn({ issuer: "https://hub.example", vault: "recipes" }, discovery(META, reg)));
    expect(second.searchParams.get("client_id")).toBe("client-1");
    expect(reg).toHaveLength(1);
  });
  it("registers again when the last sign-in to that hub never came back", async () => {
    const reg: string[] = [];
    await beginSignIn({ issuer: "https://hub.example", vault: "recipes" }, discovery(META, reg));
    const again = new URL(await beginSignIn({ issuer: "https://hub.example", vault: "recipes" }, discovery(META, reg)));
    expect(again.searchParams.get("client_id")).toBe("client-2");
  });
  it("refuses a hub that names another issuer", async () => {
    await expect(beginSignIn({ issuer: "https://a.example", vault: "notes" }, discovery({ ...META, issuer: "https://b.example" }, []))).rejects.toThrow(/calls itself/);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
  it("refuses sign-in addresses off the hub's origin", async () => {
    await expect(beginSignIn({ issuer: "https://hub.example", vault: "notes" }, discovery({ ...META, token_endpoint: "https://evil.example/token" }, []))).rejects.toThrow(/aren't on the hub/);
  });
});
