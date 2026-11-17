import { describe as group, expect, it } from "vitest";
import { describe, grantedVaults, parseHub, scopeForVaults, vaultAt, vaultNamesFrom } from "./parachute";
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
  it("reads where the hub keeps its account and its vaults (Cloud's live on another host)", async () => {
    const p = await describe("https://cloud.example", answering(200, { issuer: "https://cloud.example", account_mcp_endpoint: "https://my.example/account/mcp", vault_url_template: "https://my.example/vault/{name}" }));
    expect(p).toEqual({ hub: "https://cloud.example", issuer: "https://cloud.example", accountMcp: "https://my.example/account/mcp", vaultTemplate: "https://my.example/vault/{name}" });
    expect(vaultAt(p.vaultTemplate, "notes")).toBe("https://my.example/vault/notes");
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

group("the vaults a hub lists and grants", () => {
  const listed = (vaults: unknown) => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ covered: "listed", vaults }) }] } });
  it("reads only names a vault can have, once each, sorted", () => {
    expect(vaultNamesFrom(listed([{ name: "work" }, { name: "kim" }, { name: "Bad Name" }, { name: "../x" }, { name: "kim" }, {}]))).toEqual(["kim", "work"]);
    expect(() => vaultNamesFrom({ error: { code: 1 } })).toThrow();
  });
  it("asks read and write of each, and keeps what the hub's scope names among those asked", () => {
    expect(scopeForVaults(["a", "b"])).toBe("vault:a:read vault:a:write vault:b:read vault:b:write");
    expect(grantedVaults("vault:b:read vault:a:read vault:a:write vault:z:read", ["a", "b", "c"])).toEqual(["a", "b"]);
  });
});
