// The Parachute that serves this page (vault/hosted.ts): read from the page's own origin, believed only about itself.
import { afterEach, describe as group, expect, it } from "vitest";
import { forgetHosted, hostedFrom, hostedNow, readHosted, servedBy } from "./hosted";
import { describe } from "./parachute";
import { vaultNamed } from "./signInFlow";

const json = (body: unknown, type = "application/json") => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": type } })) as unknown as typeof fetch;
const answering = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
afterEach(forgetHosted);

group("hostedFrom", () => {
  it("takes the hub a descriptor names, and whether it is Parachute Cloud", () => {
    expect(hostedFrom({ issuer: "https://cloud.parachute.computer", door: "cloud" })).toEqual({ hub: "https://cloud.parachute.computer", cloud: true });
    expect(hostedFrom({ issuer: "https://hub.example/" })).toEqual({ hub: "https://hub.example", cloud: false });
    expect(hostedFrom({ issuer: "http://127.0.0.1:1939" })).toEqual({ hub: "http://127.0.0.1:1939", cloud: false });
  });
  it("is nothing for anything that isn't a hub's plain address", () => {
    for (const bad of [null, "x", [], {}, { issuer: 7 }, { issuer: "http://hub.example" }, { issuer: "https://u:p@hub.example" }, { issuer: "javascript:alert(1)" }, { issuer: "x".repeat(400) }]) expect(hostedFrom(bad)).toBeNull();
  });
});

group("readHosted", () => {
  it("asks the page's own origin once, and keeps the answer for the tab", async () => {
    let asked = 0;
    const f = (async (input: RequestInfo | URL) => { asked++; expect(String(input)).toBe(`${location.origin}/.well-known/parachute-account`); return new Response(JSON.stringify({ issuer: "https://stage.example", door: "cloud" }), { headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
    expect(hostedNow()).toBeNull();
    expect(await readHosted(f)).toEqual({ hub: "https://stage.example", cloud: true });
    expect(await readHosted(f)).toEqual({ hub: "https://stage.example", cloud: true });
    expect(asked).toBe(1);
    expect(servedBy("https://stage.example")).toBe(true);
    expect(servedBy("https://other.example")).toBe(false);
  });
  it("a plain file host answers its own page to any address: that is no Parachute", async () => {
    expect(await readHosted(json("<!doctype html><div id=root></div>", "text/html"))).toBeNull();
    expect(hostedNow()).toBeNull();
  });
  it("a host that doesn't answer is none, and nothing throws", async () => {
    expect(await readHosted((async () => { throw new TypeError("no network"); }) as unknown as typeof fetch)).toBeNull();
  });
});

group("what a hub says of itself, on the page it serves", () => {
  const stage = "https://identity.stage.example";
  const d = { issuer: stage, door: "cloud", account_mcp_endpoint: `${stage}/account/mcp`, vault_url_template: "https://vaults.stage.example/vault/{name}" };
  it("the Parachute serving this page may keep its vaults on another host; no other hub may", async () => {
    // not served by it (the app on a phone, or any other page): its vaults are read as on the hub itself
    expect((await describe(stage, answering(d))).vaultTemplate).toBe(`${stage}/vault/{name}`);
    await readHosted(json({ issuer: stage, door: "cloud" }));
    expect((await describe(stage, answering(d))).vaultTemplate).toBe("https://vaults.stage.example/vault/{name}");
    // another hub naming the same host still keeps its tokens at home
    const other = "https://hub.example";
    expect((await describe(other, answering({ ...d, issuer: other }))).vaultTemplate).toBe(`${other}/vault/{name}`);
    // and never in the clear
    expect((await describe(stage, answering({ ...d, vault_url_template: "http://vaults.stage.example/vault/{name}" }))).vaultTemplate).toBe(`${stage}/vault/{name}`);
  });
});

group("vaultNamed", () => {
  it("reads a vault's name from the address its Parachute writes for it, and nothing from any other address", () => {
    const t = "https://my.parachute.computer/vault/{name}";
    expect(vaultNamed(t, "https://my.parachute.computer/vault/home")).toBe("home");
    expect(vaultNamed(t, "https://my.parachute.computer/vault/home/")).toBe("home");
    expect(vaultNamed("https://{name}.vaults.example", "https://garden.vaults.example")).toBe("garden");
    for (const bad of ["https://evil.example/vault/home", "https://my.parachute.computer/vault/", "https://my.parachute.computer/vault/a/b", "https://my.parachute.computer/vault/..", "https://my.parachute.computer/vault/%ZZ", "https://my.parachute.computer/vault/Home Vault"]) expect(vaultNamed(t, bad), bad).toBeNull();
    expect(vaultNamed("https://my.parachute.computer/vault", "https://my.parachute.computer/vault")).toBeNull();
  });
});
