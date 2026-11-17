import { beforeEach, describe, expect, it } from "vitest";
import { beginSignIn, completeSignIn, PendingApprovalError, type Begin, type Pending } from "./oauth";

const PENDING = "parachute.oauth.pending.v1";
const P = { hub: "https://hub.example", issuer: "https://hub.example", accountMcp: "https://hub.example/account/mcp", vaultTemplate: "https://hub.example/vault/{name}" };
const pending = (over: Partial<Pending> = {}): Pending => ({ parachute: P, step: "vaults", vaults: ["recipes", "journal"], queue: [], granted: "", kept: [], how: "page", issuer: "https://hub.example", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c1",
  codeVerifier: "v", state: "s1", redirectUri: "http://localhost/oauth/callback", startedAt: Date.now(), ...over });
// the hub's token endpoint, which this app does not control: answered here
const hub = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(() => localStorage.clear());
/** A token shaped as the hub's (a JWT whose audience names a vault); only its claims are read here. */
const jwt = (aud: string) => `x.${btoa(JSON.stringify({ aud })).replace(/=+$/, "")}.y`;

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
  it("refuses an account-wide token for the vaults step: it can't read a vault", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "account:self:vaults" }))).rejects.toThrow(/none of the vaults asked for/);
  });
  it("refuses a token only for vaults not asked for", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "vault:secret:read vault:secret:write" }))).rejects.toThrow(/none of the vaults asked for/);
  });
  it("keeps the vaults the hub granted, in the order asked, and none it didn't name", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending({ vaults: ["recipes", "journal", "letters"] })));
    // the hub capped journal to read and left letters out; it can't add a vault the app didn't ask for
    const r = await completeSignIn("code", "s1", hub(200, { access_token: jwt("vault.recipes"), scope: "vault:journal:read vault:recipes:read vault:recipes:write vault:other:read" }));
    expect(r.vaults).toEqual(["recipes", "journal"]);
    expect(r.vault).toBe("recipes");
  });
  it("the token is for the vault its audience names, and one for a vault not granted is refused", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending({ vaults: ["recipes", "journal"] })));
    expect((await completeSignIn("code", "s1", hub(200, { access_token: jwt("vault.journal"), scope: "vault:journal:read vault:recipes:read" }))).vault).toBe("journal");
    localStorage.setItem(PENDING, JSON.stringify(pending({ vaults: ["recipes", "journal"] })));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: jwt("vault.secret"), scope: "vault:journal:read" }))).rejects.toThrow(/didn't grant here/);
  });
  it("the listing step wants a token that may list the person's vaults", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending({ step: "list", vaults: [] })));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "vault:recipes:read" }))).rejects.toThrow(/see which vaults are yours/);
    localStorage.setItem(PENDING, JSON.stringify(pending({ step: "list", vaults: [] })));
    expect((await completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "account:self:vaults" }))).vaults).toEqual([]);
    // core 0.9 grants it per vault
    localStorage.setItem(PENDING, JSON.stringify(pending({ step: "list", vaults: [] })));
    expect((await completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "account:self:vaults:garden:read account:self:vaults:kitchen:read" }))).vaults).toEqual([]);
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

const begin = (b: Partial<Begin>, hub = "https://hub.example"): Begin => ({ parachute: { ...P, hub, issuer: hub }, step: "vaults", how: "page", ...b });

describe("beginSignIn", () => {
  it("each other vault asks for exactly what the consent granted it (read only, where that is all it holds)", async () => {
    const url = new URL(await beginSignIn(begin({ step: "vault", vaults: ["family"], granted: "vault:work:read vault:work:write vault:family:read" }), discovery(META, [])));
    expect(url.searchParams.get("scope")).toBe("vault:family:read");
    expect(url.searchParams.get("vault")).toBe("family");
    await expect(beginSignIn(begin({ step: "vault", vaults: ["other"], granted: "vault:work:read" }), discovery(META, []))).rejects.toThrow(/didn't grant/);
  });
  it("asks for every vault's scopes in one consent, with S256, and registers once per hub", async () => {
    const reg: string[] = [];
    const first = new URL(await beginSignIn(begin({ step: "vaults", vaults: ["recipes", "journal"] }), discovery(META, reg)));
    expect(first.searchParams.get("scope")).toBe("vault:recipes:read vault:recipes:write vault:journal:read vault:journal:write");
    expect(first.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first.searchParams.get("client_id")).toBe("client-1");
    // the first flow came back
    localStorage.removeItem(PENDING);
    const second = new URL(await beginSignIn(begin({ step: "list" }), discovery(META, reg)));
    expect(second.searchParams.get("scope")).toBe("account:self:vaults");
    expect(second.searchParams.get("client_id")).toBe("client-1");
    expect(reg).toHaveLength(1);
  });
  it("registers again when the last sign-in to that hub never came back", async () => {
    const reg: string[] = [];
    // with the key, the consent is the first step
    await beginSignIn(begin({ step: "vaults", vaults: ["recipes"], fresh: true, how: "key" }), discovery(META, reg));
    const again = new URL(await beginSignIn(begin({ step: "vaults", vaults: ["recipes"], fresh: true, how: "key" }), discovery(META, reg)));
    expect(again.searchParams.get("client_id")).toBe("client-2");
  });
  it("keeps the registration when the last sign-in stopped past its first step (the hub had taken it)", async () => {
    const reg: string[] = [];
    // without a key, the listing came back (the registration worked); the person left at the consent
    await beginSignIn(begin({ step: "vaults", vaults: ["recipes"], how: "page" }), discovery(META, reg));
    const again = new URL(await beginSignIn(begin({ step: "list", fresh: true, how: "page" }), discovery(META, reg)));
    expect(again.searchParams.get("client_id")).toBe("client-1");
  });
  it("keeps the registration from the listing step for the consent that follows it", async () => {
    const reg: string[] = [];
    await beginSignIn(begin({ step: "list", fresh: true }), discovery(META, reg));
    const next = new URL(await beginSignIn(begin({ step: "vaults", vaults: ["recipes"] }), discovery(META, reg)));
    expect(next.searchParams.get("client_id")).toBe("client-1");
  });
  it("refuses a hub that names another issuer", async () => {
    await expect(beginSignIn(begin({ step: "vaults", vaults: ["notes"] }, "https://a.example"), discovery({ ...META, issuer: "https://b.example" }, []))).rejects.toThrow(/calls itself/);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
  it("refuses sign-in addresses off the hub's origin", async () => {
    await expect(beginSignIn(begin({ step: "vaults", vaults: ["notes"] }), discovery({ ...META, token_endpoint: "https://evil.example/token" }, []))).rejects.toThrow(/aren't on the hub/);
  });
});
