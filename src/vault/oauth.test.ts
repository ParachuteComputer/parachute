import { beforeEach, describe, expect, it } from "vitest";
import { beginSignIn, CLOUD_CLIENT_NAME, SHELL_RETURN, completeSignIn, PendingApprovalError, type Begin, type Pending } from "./oauth";

const PENDING = "parachute.oauth.pending.v1";
const P = { hub: "https://hub.example", issuer: "https://hub.example", accountMcp: "https://hub.example/account/mcp", vaultTemplate: "https://hub.example/vault/{name}" };
const pending = (over: Partial<Pending> = {}): Pending => ({ parachute: P, step: "open", vault: "recipes", level: "read", why: "signin", how: "page", issuer: "https://hub.example", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c1",
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
  it("where the hub says who sent each return (RFC 9207), a code that comes back without that hub's issuer is refused before it goes anywhere", async () => {
    let called = 0;
    const counting = (async () => { called++; return new Response(JSON.stringify({ access_token: "t", scope: "vault:recipes:read" })); }) as unknown as typeof fetch;
    for (const iss of [null, "https://evil.example", "https://hub.example.evil"]) {
      localStorage.setItem(PENDING, JSON.stringify(pending({ iss: true })));
      await expect(completeSignIn("code", "s1", counting, iss)).rejects.toThrow(/came back from somewhere other than the hub/);
    }
    expect(called).toBe(0);
    localStorage.setItem(PENDING, JSON.stringify(pending({ iss: true })));
    await completeSignIn("code", "s1", counting, "https://hub.example");
    expect(called).toBe(1);
  });
  it("refuses a second use of the same flow", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await completeSignIn("code", "s1", hub(200, { access_token: "t", vault: "recipes", scope: "vault:recipes:read" }));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", vault: "recipes" }))).rejects.toThrow(/expired or was already used/);
  });
  it("refuses a flow older than half an hour", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending({ startedAt: Date.now() - 31 * 60_000 })));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", vault: "recipes" }))).rejects.toThrow(/expired/);
  });
  it("refuses an account-wide token for a vault step: it can't read the vault", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "account:self:vaults" }))).rejects.toThrow(/didn't give Parachute the recipes vault/);
  });
  it("refuses a token for another vault than the one asked for", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "vault:secret:read vault:secret:write" }))).rejects.toThrow(/didn't give Parachute the recipes vault/);
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: jwt("vault.secret"), scope: "vault:recipes:read" }))).rejects.toThrow(/wasn't asked for/);
  });
  it("refuses more than was asked (extra access ticked on the hub's page): the app holds only what it asked for", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: jwt("vault.recipes"), scope: "vault:recipes:read vault:recipes:admin" }))).rejects.toThrow(/more than Parachute asked for \(vault:recipes:admin\)/);
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: jwt("vault.recipes"), scope: "vault:recipes:read vault:recipes:write" }))).rejects.toThrow(/more than Parachute asked for/);
  });
  it("says what the hub gave of the vault: read where read was asked, read where it capped a write ask", async () => {
    localStorage.setItem(PENDING, JSON.stringify(pending()));
    const r = await completeSignIn("code", "s1", hub(200, { access_token: jwt("vault.recipes"), scope: "vault:recipes:read" }));
    expect([r.vault, r.level]).toEqual(["recipes", "read"]);
    localStorage.setItem(PENDING, JSON.stringify(pending({ level: "write", why: "allow" })));
    expect((await completeSignIn("code", "s1", hub(200, { access_token: jwt("vault.recipes"), scope: "vault:recipes:read" }))).level).toBe("read");
    localStorage.setItem(PENDING, JSON.stringify(pending({ level: "write", why: "allow" })));
    expect((await completeSignIn("code", "s1", hub(200, { access_token: jwt("vault.recipes"), scope: "vault:recipes:read vault:recipes:write" }))).level).toBe("write");
  });
  it("the listing step wants a token that may list the person's vaults", async () => {
    const list = () => pending({ step: "list", vault: undefined, level: undefined });
    localStorage.setItem(PENDING, JSON.stringify(list()));
    await expect(completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "vault:recipes:read" }))).rejects.toThrow(/see which vaults are yours/);
    localStorage.setItem(PENDING, JSON.stringify(list()));
    expect((await completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "account:self:vaults" }))).vault).toBeNull();
    // core 0.9 grants it per vault
    localStorage.setItem(PENDING, JSON.stringify(list()));
    expect((await completeSignIn("code", "s1", hub(200, { access_token: "t", scope: "account:self:vaults:garden:read account:self:vaults:kitchen:read" }))).vault).toBeNull();
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

const begin = (b: Partial<Begin>, hub = "https://hub.example"): Begin => ({ parachute: { ...P, hub, issuer: hub }, step: "open", how: "page", ...b });

describe("beginSignIn", () => {
  it("asks for one vault at a time: read alone, or read and write; never another vault and never more than asked", async () => {
    const reg: string[] = [];
    const read = new URL(await beginSignIn(begin({ vault: "recipes", level: "read" }), discovery(META, reg)));
    expect(read.searchParams.get("scope")).toBe("vault:recipes:read");
    expect(read.searchParams.get("vault")).toBe("recipes");
    expect(read.searchParams.get("code_challenge_method")).toBe("S256");
    expect(read.searchParams.get("client_id")).toBe("client-1");
    localStorage.removeItem(PENDING);
    const write = new URL(await beginSignIn(begin({ vault: "journal", level: "write", why: "allow" }), discovery(META, reg)));
    expect(write.searchParams.get("scope")).toBe("vault:journal:read vault:journal:write");
    // the first flow came back: the listing uses the same registration
    localStorage.removeItem(PENDING);
    const list = new URL(await beginSignIn(begin({ step: "list" }), discovery(META, reg)));
    expect(list.searchParams.get("scope")).toBe("account:vaults");
    expect(list.searchParams.get("vault")).toBeNull();
    expect(reg).toHaveLength(1);
    await expect(beginSignIn(begin({ vault: undefined }), discovery(META, reg))).rejects.toThrow(/No vault/);
  });
  it("registers again when the last sign-in to that hub never came back", async () => {
    const reg: string[] = [];
    // with the key, the consent is the first step
    await beginSignIn(begin({ vault: "recipes", why: "signin", fresh: true, how: "key" }), discovery(META, reg));
    const again = new URL(await beginSignIn(begin({ vault: "recipes", why: "signin", fresh: true, how: "key" }), discovery(META, reg)));
    expect(again.searchParams.get("client_id")).toBe("client-2");
  });
  it("keeps the registration when the last sign-in stopped past its first step (the hub had taken it)", async () => {
    const reg: string[] = [];
    // without a key, the listing came back (the registration worked); the person left at the consent
    await beginSignIn(begin({ vault: "recipes", why: "signin", how: "page" }), discovery(META, reg));
    const again = new URL(await beginSignIn(begin({ step: "list", fresh: true, how: "page" }), discovery(META, reg)));
    expect(again.searchParams.get("client_id")).toBe("client-1");
  });
  it("keeps the registration from the listing step for the consent that follows it", async () => {
    const reg: string[] = [];
    await beginSignIn(begin({ step: "list", fresh: true }), discovery(META, reg));
    const next = new URL(await beginSignIn(begin({ vault: "recipes" }), discovery(META, reg)));
    expect(next.searchParams.get("client_id")).toBe("client-1");
  });
  it("on Parachute Cloud, registers under a name Cloud takes from an app outside it (it keeps \"Parachute\" for its own pages)", async () => {
    const names: string[] = [];
    const cloud = { ...P, hub: "https://cloud.example", issuer: "https://cloud.example", door: "cloud" as const };
    const meta = { ...META, issuer: "https://cloud.example", authorization_endpoint: "https://cloud.example/oauth/authorize", token_endpoint: "https://cloud.example/oauth/token", registration_endpoint: "https://cloud.example/oauth/register" };
    const url = new URL(await beginSignIn({ parachute: cloud, step: "list", how: "page" }, cloudLike(meta, names)));
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(names).toEqual([CLOUD_CLIENT_NAME]);
    // a hub of Parachute's own (core) still sees the app's own name
    localStorage.clear();
    await beginSignIn(begin({ step: "list" }), cloudLike(META, names)).catch(() => null);
    expect(names.at(-1)).toBe("Parachute");
  });
  it("on a device, signs in under the id the hub reserves for the app (Cloud's parachute-app) where the hub says who sent each return: no registration, so its page names Parachute", async () => {
    const names: string[] = [];
    const cloud = { ...P, hub: "https://cloud.example", issuer: "https://cloud.example", door: "cloud" as const, appClientId: "parachute-app" };
    const meta = { ...META, issuer: "https://cloud.example", authorization_endpoint: "https://cloud.example/oauth/authorize", token_endpoint: "https://cloud.example/oauth/token", registration_endpoint: "https://cloud.example/oauth/register" };
    const withIss = { ...meta, authorization_response_iss_parameter_supported: true } as unknown as Record<string, string>;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      const url = new URL(await beginSignIn({ parachute: cloud, step: "list", how: "page" }, cloudLike(withIss, names)));
      expect(url.searchParams.get("client_id")).toBe("parachute-app");
      expect(url.searchParams.get("redirect_uri")).toBe(SHELL_RETURN);
      expect(names).toEqual([]);
      // a hub that doesn't say who sent a return: the one loopback can't tell hubs apart, so the app registers
      localStorage.clear();
      const noIss = new URL(await beginSignIn({ parachute: cloud, step: "list", how: "page" }, cloudLike(meta, names)));
      expect(noIss.searchParams.get("client_id")).toBe("client-1");
    } finally { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; }
    // a browser tab's return address isn't the one the id is pinned to: it registers, as before
    localStorage.clear(); names.length = 0;
    const tab = new URL(await beginSignIn({ parachute: cloud, step: "list", how: "page" }, cloudLike(withIss, names)));
    expect(tab.searchParams.get("client_id")).toBe("client-1");
    expect(names).toEqual([CLOUD_CLIENT_NAME]);
  });
  it("a hub that refused the reserved id gets a registration on the next sign-in", async () => {
    const cloud = { ...P, hub: "https://cloud.example", issuer: "https://cloud.example", door: "cloud" as const, appClientId: "parachute-app" };
    const meta = { ...META, issuer: "https://cloud.example", authorization_endpoint: "https://cloud.example/oauth/authorize", token_endpoint: "https://cloud.example/oauth/token", registration_endpoint: "https://cloud.example/oauth/register", authorization_response_iss_parameter_supported: true } as unknown as Record<string, string>;
    localStorage.setItem(PENDING, JSON.stringify(pending({ parachute: cloud, issuer: "https://cloud.example", clientId: "parachute-app", reserved: true, iss: true })));
    await expect(completeSignIn("code", "s1", hub(401, { error: "invalid_client" }), "https://cloud.example")).rejects.toThrow(/refused/);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      const names: string[] = [];
      const url = new URL(await beginSignIn({ parachute: cloud, step: "list", how: "page" }, cloudLike(meta, names)));
      expect(url.searchParams.get("client_id")).toBe("client-1");
    } finally { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; }
  });
  it("refuses a hub that names another issuer", async () => {
    await expect(beginSignIn(begin({ vault: "notes" }, "https://a.example"), discovery({ ...META, issuer: "https://b.example" }, []))).rejects.toThrow(/calls itself/);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
  it("refuses sign-in addresses off the hub's origin", async () => {
    await expect(beginSignIn(begin({ vault: "notes" }), discovery({ ...META, token_endpoint: "https://evil.example/token" }, []))).rejects.toThrow(/aren't on the hub/);
  });
});

// Parachute Cloud's registration as it answered on 2026-11-18: a name that looks like "Parachute" from an app whose
// return address isn't Cloud's own is refused with this 400 (parachute-cloud workers/identity/src/oauth-register.ts)
function cloudLike(meta: Record<string, string>, names: string[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/.well-known/oauth-authorization-server")) return new Response(JSON.stringify(meta));
    if (url.endsWith("/oauth/register")) {
      const name = String(JSON.parse(String(init?.body ?? "{}")).client_name ?? "");
      names.push(name);
      if (/p\W*a\W*r\W*a\W*c\W*h\W*u\W*t\W*e/i.test(name)) return new Response(JSON.stringify({ error: "invalid_client_metadata", error_description: "client_name is reserved: an app registered here can't be named Parachute" }), { status: 400 });
      return new Response(JSON.stringify({ client_id: `client-${names.length}`, status: "pending" }), { status: 201 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}
