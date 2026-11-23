// The website kit against what the frame gives an applet: every part, the calls a folder applet makes, the vault in
// record words both ways (a real VaultClient; only the network is faked), and the hub asked for the named vault only.
import { VaultClient } from "@openparachute/surface-client";
import { afterEach, describe, expect, it } from "vitest";
import { PART_NAMES } from "../../../src/applet/kits/modules";
import { hubOf, surfaceOptions } from "./LinkParachute";
import * as parachute from "./parachute";
import { linkClient, vault } from "./web";

type Seen = { url: URL; method: string; body: unknown };
function hub(answer: (s: Seen) => unknown) {
  const seen: Seen[] = [];
  linkClient(new VaultClient({ vaultUrl: "https://hub.test/vault/home", accessToken: "t", fetchImpl: (async (url: string, init?: RequestInit) => {
    const s = { url: new URL(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    seen.push(s);
    return new Response(JSON.stringify(answer(s)), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch }));
  return seen;
}
afterEach(() => linkClient(null));

describe("the website's parachute", () => {
  it("gives every part the frame's kit gives, and a folder applet's calls", () => {
    for (const p of PART_NAMES) expect(parachute, p).toHaveProperty(p);
    for (const c of ["vault", "ready", "onOpen", "onBack", "onFresh", "onShown", "shown", "onLaunch", "launch"]) expect(parachute, c).toHaveProperty(c);
  });

  it("asks the hub for the named vault's read and write, and comes back to this site", () => {
    const o = surfaceOptions({ id: "reading", name: "Reading" }, { hub: "https://hub.example", vault: "home" }, "https://reading.example");
    expect(o.scope).toBe("vault:home:read vault:home:write");
    expect(o.redirectUri).toBe("https://reading.example/oauth/callback");
    expect(o.vaultName).toBe("home");
    expect(hubOf(" hub.example/ ")).toBe("https://hub.example");
    expect(hubOf("http://127.0.0.1:1940")).toBe("http://127.0.0.1:1940");
  });

  it("speaks record words to the applet and note words to the hub, link ends too", async () => {
    const note = { id: "n1", path: "Reading/Dune", createdAt: "x", content: "spice", metadata: { rating: 5 }, links: [{ sourceId: "n1", targetId: "n2", relationship: "mentions", metadata: { w: 1 }, targetNote: { id: "n2", path: "Reading/Arrakis", metadata: { kind: "place" } } }] };
    const seen = hub((s) => (s.method === "GET" ? [note] : note));
    const rows = await vault.queryRecords({ pathPrefix: "Reading/", includeBody: true, includeFields: true, fields: { rating: { gte: 4 } } });
    const q = seen[0].url.searchParams;
    expect([q.get("path_prefix"), q.get("include_content"), q.get("include_metadata"), q.get("meta[rating][gte]")]).toEqual(["Reading/", "true", "true", "4"]);
    expect(rows[0]).toMatchObject({ body: "spice", fields: { rating: 5 } });
    expect(rows[0]).not.toHaveProperty("content");
    expect((rows[0].links as { fields: unknown; targetNote: unknown }[])[0]).toMatchObject({ fields: { w: 1 }, targetNote: { path: "Reading/Arrakis", fields: { kind: "place" } } });
    await vault.createRecord({ path: "Reading/Dune", body: "spice", fields: { rating: 5 } });
    expect(seen[1]).toMatchObject({ method: "POST", body: { path: "Reading/Dune", content: "spice", metadata: { rating: 5 } } });
    await vault.updateRecord("n1", { if_updated_at: "x", body: "more spice" });
    expect(seen[2]).toMatchObject({ method: "PATCH", body: { if_updated_at: "x", content: "more spice" } });
  });

  it("says plainly when no Parachute is linked", async () => {
    await expect(vault.queryRecords({})).rejects.toThrow(/No Parachute is linked/);
  });
});
