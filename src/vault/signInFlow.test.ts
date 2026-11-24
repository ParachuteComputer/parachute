// A person new to Parachute Cloud signs in from the app with no vault yet (T-476): the listing step keeps its token for
// the first vault, makes it with the account door's `create-vault`, ends the token, and asks for the new vault as home.
// The hub is answered here (the app doesn't control it); the app's own sign-in code runs as it is.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishStep, SignInEnded, type FirstVault } from "./signInFlow";
import { HubRefused, type Parachute } from "./parachute";

const HUB = "https://cloud.example";
const P: Parachute = { hub: HUB, issuer: HUB, accountMcp: `${HUB}/account/mcp`, vaultTemplate: `${HUB}/vault/{name}`, door: "cloud" };
const PENDING = "parachute.oauth.pending.v1";

type Seen = { revoked: number; made: string[]; tools: string[] };
/** The hub: its token for the listing step (with `scope`), an empty list of vaults, create-vault as `create` says. */
function hub(scope: string, create: (name: string) => unknown, seen: Seen) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url === `${HUB}/oauth/token`) return json({ access_token: "acc", refresh_token: "ref", scope, token_type: "Bearer" });
    if (url === `${HUB}/oauth/revoke`) { seen.revoked++; return new Response("", { status: 200 }); }
    if (url === `${HUB}/account/mcp`) {
      const call = JSON.parse(String(init?.body)) as { params: { name: string; arguments: { name?: string } } };
      seen.tools.push(call.params.name);
      if (call.params.name === "list-vaults") return json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ vaults: [] }) }] } });
      if (call.params.name === "create-vault") { seen.made.push(call.params.arguments.name!); return json(create(call.params.arguments.name!)); }
    }
    if (url === `${HUB}/.well-known/oauth-authorization-server`) return json({ issuer: HUB, authorization_endpoint: `${HUB}/oauth/authorize`, token_endpoint: `${HUB}/oauth/token`, registration_endpoint: `${HUB}/oauth/register`, revocation_endpoint: `${HUB}/oauth/revoke`, code_challenge_methods_supported: ["S256"] });
    if (url === `${HUB}/oauth/register`) return json({ client_id: "c2" }, 201);
    return new Response("not here", { status: 404 });
  });
}
const made = (name: string) => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ name, vault_id: "v1" }) }] } });
const VAULTS_AND_CREATE = "account:u1:vaults:*:write account:u1:vault-create";

function listingStep(whose: "mine" | "theirs" = "mine") {
  localStorage.setItem(PENDING, JSON.stringify({ parachute: P, step: "list", why: "signin", how: "page", whose, issuer: HUB, tokenEndpoint: `${HUB}/oauth/token`,
    revocationEndpoint: `${HUB}/oauth/revoke`, clientId: "c1", codeVerifier: "v", state: "s1", redirectUri: "http://localhost/oauth/callback", startedAt: Date.now() }));
}
async function first(seen: Seen, scope = VAULTS_AND_CREATE, create: (name: string) => unknown = made): Promise<FirstVault> {
  vi.stubGlobal("fetch", hub(scope, create, seen));
  listingStep();
  const next = await finishStep("code", "s1");
  if (!("first" in next)) throw new Error(`expected the first-vault step, got ${Object.keys(next)}`);
  return next.first;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("a new person's first vault, made in the app", () => {
  it("keeps the listing token only for the first vault, makes it, ends the token once, then asks for it as the home at write", async () => {
    const seen: Seen = { revoked: 0, made: [], tools: [] };
    const f = await first(seen);
    expect(seen.revoked).toBe(0);
    const go = new URL(await f.make("practice"));
    expect(seen.made).toEqual(["practice"]);
    expect(seen.revoked).toBe(1);
    expect(go.origin + go.pathname).toBe(`${HUB}/oauth/authorize`);
    expect(go.searchParams.get("scope")).toBe("vault:practice:read vault:practice:write");
    const next = JSON.parse(localStorage.getItem(PENDING)!) as { step: string; vault: string; home?: boolean; marks?: { solo: boolean } };
    expect([next.step, next.vault, next.home, next.marks?.solo]).toEqual(["open", "practice", true, true]);
    // leaving afterwards ends nothing twice
    await f.end();
    expect(seen.revoked).toBe(1);
  });

  it("a name the hub refuses stays on the screen in the hub's words, with the same sign-in for the next try", async () => {
    const seen: Seen = { revoked: 0, made: [], tools: [] };
    const f = await first(seen, VAULTS_AND_CREATE, (name) => name === "practice"
      ? { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "That vault name is already taken." } } : made(name));
    await expect(f.make("practice")).rejects.toThrow(HubRefused);
    expect(seen.revoked).toBe(0);
    await f.make("lena-practice");
    expect(seen.made).toEqual(["practice", "lena-practice"]);
    expect(seen.revoked).toBe(1);
  });

  it("an answer it can't read ends the token: the person signs in again rather than retrying into 'already taken'", async () => {
    const seen: Seen = { revoked: 0, made: [], tools: [] };
    const f = await first(seen, VAULTS_AND_CREATE, () => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "<html>" }] } }));
    await expect(f.make("practice")).rejects.toThrow(SignInEnded);
    expect(seen.revoked).toBe(1);
    await expect(f.make("practice")).rejects.toThrow(SignInEnded);
    expect(seen.made).toEqual(["practice"]);
  });

  it("Not now ends the token, and nothing is made", async () => {
    const seen: Seen = { revoked: 0, made: [], tools: [] };
    const f = await first(seen);
    await f.end();
    await f.end();
    expect(seen.revoked).toBe(1);
    await expect(f.make("practice")).rejects.toThrow(SignInEnded);
    expect(seen.made).toEqual([]);
  });

  it("without the hub's leave to make vaults, or on someone else's Parachute: the token is ended at once and nothing is offered", async () => {
    for (const [scope, whose] of [["account:u1:vaults:*:write", "mine"], [VAULTS_AND_CREATE, "theirs"]] as const) {
      const seen: Seen = { revoked: 0, made: [], tools: [] };
      vi.stubGlobal("fetch", hub(scope, made, seen));
      listingStep(whose);
      await expect(finishStep("code", "s1")).rejects.toThrow(/no vault/);
      expect(seen.revoked).toBe(1);
      expect(seen.tools).not.toContain("create-vault");
    }
  });
});
