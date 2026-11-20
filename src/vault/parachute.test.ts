import { describe as group, expect, it } from "vitest";
import { canList, CLOUD, describe, HOME_RECORDS_BODY, homeFrom, listFrom, parseHub, reachesEvery, rpcAnswer, covers, levelIn, scopeFor, vaultUrlFrom } from "./parachute";
import { MAX_VAULTS } from "./address";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hubOf, settingsFrom } from "../shell/homeSettings";

group("parseHub", () => {
  it("reads a hub from what a person types, a vault's address included", () => {
    expect(parseHub("uni.example")).toEqual({ ok: true, hub: "https://uni.example" });
    expect(parseHub(" https://uni.example/vault/notes/mcp ")).toEqual({ ok: true, hub: "https://uni.example" });
    expect(parseHub("http://127.0.0.1:4100")).toEqual({ ok: true, hub: "http://127.0.0.1:4100" });
  });
  it("refuses plain http off this machine, credentials, and things that aren't addresses", () => {
    for (const bad of ["http://uni.example", "https://me:pw@uni.example", "ftp://uni.example", "", "javascript:alert(1)", "https://"]) expect(parseHub(bad).ok, bad).toBe(false);
  });
});

group("the list of Parachutes in the settings note is read as untrusted", () => {
  it("keeps entries that parse as Parachutes, once each, and drops the rest", () => {
    const s = settingsFrom({ parachute: { hubs: [{ hub: "https://techne.example/vault/x", name: "Techne" }, { hub: "http://evil.example" }, { hub: "javascript:alert(1)" }, "nope", { hub: "https://techne.example" }, { hub: "https://cloud.example", name: "x".repeat(200) }] } });
    expect(s.hubs).toEqual([{ hub: "https://techne.example", name: "Techne" }, { hub: "https://cloud.example" }]);
    expect(hubOf({ hub: "https://a.example", name: "A\nB" })).toEqual({ hub: "https://a.example" });
  });
});

const answering = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
group("describe", () => {
  it("reads where Cloud keeps its account and its vaults (another host of its own domain)", async () => {
    const p = await describe(CLOUD, answering(200, { issuer: CLOUD, door: "cloud", account_mcp_endpoint: "https://my.parachute.computer/account/mcp", vault_url_template: "https://my.parachute.computer/vault/{name}" }));
    expect(p).toEqual({ hub: CLOUD, issuer: CLOUD, accountMcp: "https://my.parachute.computer/account/mcp", vaultTemplate: "https://my.parachute.computer/vault/{name}", door: "cloud" });
    expect(vaultUrlFrom(p.vaultTemplate, "notes")).toBe("https://my.parachute.computer/vault/notes");
  });
  it("reads the id the hub reserves for the app (app_client_id), and nothing that isn't an id", async () => {
    const d = { issuer: CLOUD, door: "cloud", account_mcp_endpoint: "https://my.parachute.computer/account/mcp", vault_url_template: "https://my.parachute.computer/vault/{name}" };
    expect((await describe(CLOUD, answering(200, { ...d, app_client_id: "parachute-app" }))).appClientId).toBe("parachute-app");
    for (const bad of ["", "a b", "x".repeat(101), 7, "parachute-app&redirect_uri=https://evil"]) expect((await describe(CLOUD, answering(200, { ...d, app_client_id: bad }))).appClientId).toBeUndefined();
  });
  it("never sends a hub's tokens to another host: an address off the hub is read as the hub's own", async () => {
    const p = await describe("https://hub.example", answering(200, { issuer: "https://hub.example", account_mcp_endpoint: "https://evil.example/account/mcp", vault_url_template: "https://evil.example/{name}" }));
    expect(p.accountMcp).toBe("https://hub.example/account/mcp");
    expect(p.vaultTemplate).toBe("https://hub.example/vault/{name}");
    // only Cloud may use its own domain
    const q = await describe("https://hub.example", answering(200, { issuer: "https://hub.example", vault_url_template: "https://my.parachute.computer/vault/{name}" }));
    expect(q.vaultTemplate).toBe("https://hub.example/vault/{name}");
  });
  it("refuses a hub that names another issuer, and keeps an address that isn't https on the hub itself", async () => {
    await expect(describe("https://a.example", answering(200, { issuer: "https://b.example" }))).rejects.toThrow(/calls itself/);
    const p = await describe("https://a.example", answering(200, { issuer: "https://a.example", account_mcp_endpoint: "http://evil.example/mcp", vault_url_template: "https://a.example/vault/" }));
    expect(p.accountMcp).toBe("https://a.example/account/mcp");
    expect(p.vaultTemplate).toBe("https://a.example/vault/{name}");
  });
  it("reads a hub with no description (older) as keeping everything on its origin", async () => {
    expect((await describe("https://old.example", answering(404, "no"))).vaultTemplate).toBe("https://old.example/vault/{name}");
  });
});

group("the listing token", () => {
  it("lists the person's vaults with the account-vaults scope however the hub granted it", () => {
    for (const s of ["account:vaults", "account:self:vaults", "account:u-123:vaults", "account:self:vaults:garden:read account:self:vaults:kitchen:read"]) expect(canList(s), s).toBe(true);
    for (const s of ["vault:garden:read", "account:self:read", "", undefined]) expect(canList(s), String(s)).toBe(false);
  });
});

group("whether the person runs the hub", () => {
  const pub = (names: string[]) => answering(200, { vaults: names.map((name) => ({ name, url: "x" })) });
  it("they reach every vault its public list names", async () => {
    expect(await reachesEvery("https://hub.example", ["a", "b", "c"], pub(["a", "b", "c"]))).toBe(true);
    expect(await reachesEvery("https://hub.example", ["a", "b"], pub(["a", "b", "c"]))).toBe(false);
    // one vault on the hub: nothing to pick between; no public list (Cloud): no
    expect(await reachesEvery("https://hub.example", ["a"], pub(["a"]))).toBe(false);
    expect(await reachesEvery("https://hub.example", ["a", "b"], answering(404, "no"))).toBe(false);
    // a list cut at the cap is asked about, never taken as the person's own; names a vault can't have don't count
    expect(await reachesEvery("https://hub.example", Array.from({ length: MAX_VAULTS }, (_, i) => `v${i}`), pub(Array.from({ length: 70 }, (_, i) => `v${i}`)))).toBe(true);
    expect(await reachesEvery("https://hub.example", ["a", "b"], pub(["a", "b", "Bad Name"]))).toBe(true);
  });
});

group("the vaults a hub lists and grants", () => {
  const listed = (vaults: unknown, covered = "listed") => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ covered, vaults }) }] } });
  it("reads only names a vault can have, once each, sorted, and whether they are every vault on the hub", () => {
    expect(listFrom(listed([{ name: "work" }, { name: "kim" }, { name: "Bad Name" }, { name: "../x" }, { name: "kim" }, {}]))).toEqual({ vaults: ["kim", "work"], all: false });
    expect(listFrom(listed([{ name: "a" }], "all")).all).toBe(true);
    expect(listFrom(listed(Array.from({ length: 500 }, (_, i) => ({ name: `v${i}` })))).vaults).toHaveLength(MAX_VAULTS);
    expect(() => listFrom({ error: { code: 1 } })).toThrow();
    // an MCP door may answer as one server-sent event
    expect(listFrom(rpcAnswer(`event: message\ndata: ${JSON.stringify(listed([{ name: "kim" }]))}\n\n`)).vaults).toEqual(["kim"]);
  });
  it("asks for one vault at one level, and reads what a token holds of a vault", () => {
    expect(scopeFor("a", "read")).toBe("vault:a:read");
    expect(scopeFor("a", "write")).toBe("vault:a:read vault:a:write");
    expect(levelIn("vault:b:read vault:a:read vault:a:write vault:z:read", "a")).toBe("write");
    expect(levelIn("vault:b:read vault:a:write", "b")).toBe("read");
    expect(levelIn("vault:b:read", "a")).toBeNull();
    expect(levelIn("account:vaults vault:ab:read", "a")).toBeNull();
    expect([covers("write", "read"), covers("read", "read"), covers("read", "write"), covers(null, "read")]).toEqual([true, true, false, false]);
  });
});

group("homeFrom", () => {
  // the account MCP's query-notes across vaults: each vault's rows, or its error
  const answer = (results: unknown[]) => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ vaults_queried: [], results }) }] } });
  const row = (tag: string) => ({ id: "n", path: "Parachute/x", tags: [tag] });
  it("takes the vault holding the settings over one holding an app record, and the first by name never by itself", () => {
    const a = answer([{ vault: "aaa", notes: { notes: [row("parachute-app")] } }, { vault: "home", notes: { notes: [row("parachute-settings")] } }, { vault: "zed", notes: { notes: [] } }]);
    expect(homeFrom(a, ["aaa", "home", "zed"])).toBe("home");
    expect(homeFrom(answer([{ vault: "aaa", notes: { notes: [] } }, { vault: "work", notes: [row("parachute-bundle")] }]), ["aaa", "work"])).toBe("work");
  });
  it("says nothing when two vaults hold settings (one may be someone else's on a hub the person runs), and looks only at the person's own", () => {
    const a = answer([{ vault: "mine", notes: { notes: [row("parachute-settings")] } }, { vault: "kim", notes: { notes: [row("parachute-settings")] } }]);
    expect(homeFrom(a, ["mine", "kim"])).toBeNull();
    expect(homeFrom(a, ["mine"])).toBe("mine");
    expect(homeFrom(answer([{ vault: "a", notes: [row("parachute-app")] }, { vault: "b", notes: [row("parachute-app")] }]), ["a", "b"])).toBeNull();
  });
  it("passes over a vault the hub couldn't read, and says nothing for an answer it can't read", () => {
    expect(homeFrom(answer([{ vault: "home", error: "vault down" }, { vault: "b", notes: { notes: [row("parachute-app")] } }]), ["home", "b"])).toBe("b");
    expect(homeFrom(answer([{ vault: "home", error: "vault down" }]), ["home"])).toBeNull();
    for (const bad of [null, {}, { error: { code: 1 } }, { result: { isError: true, content: [] } }, { result: { content: [{ type: "text", text: "not json" }] } }]) expect(homeFrom(bad, ["home"])).toBeNull();
  });
  it("asks in the same words the key signs (src-tauri/src/door.rs)", () => {
    const rust = readFileSync(join(process.cwd(), "src-tauri", "src", "door.rs"), "utf8");
    expect(rust).toContain(`pub const HOME_RECORDS_BODY: &str = r#"${HOME_RECORDS_BODY}"#;`);
  });
});
