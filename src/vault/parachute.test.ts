import { describe as group, expect, it } from "vitest";
import { CLOUD, describe, grantedVaults, listFrom, MAX_VAULTS, parseHub, reachesEvery, rpcAnswer, scopeForVaults, vaultUrlFrom } from "./parachute";
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
    const p = await describe(CLOUD, answering(200, { issuer: CLOUD, account_mcp_endpoint: "https://my.parachute.computer/account/mcp", vault_url_template: "https://my.parachute.computer/vault/{name}" }));
    expect(p).toEqual({ hub: CLOUD, issuer: CLOUD, accountMcp: "https://my.parachute.computer/account/mcp", vaultTemplate: "https://my.parachute.computer/vault/{name}" });
    expect(vaultUrlFrom(p.vaultTemplate, "notes")).toBe("https://my.parachute.computer/vault/notes");
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
  it("asks read and write of each, and keeps what the hub's scope names among those asked", () => {
    expect(scopeForVaults(["a", "b"])).toBe("vault:a:read vault:a:write vault:b:read vault:b:write");
    expect(grantedVaults("vault:b:read vault:a:read vault:a:write vault:z:read", ["a", "b", "c"])).toEqual(["a", "b"]);
  });
});
