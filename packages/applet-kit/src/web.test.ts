// The website kit against what the frame gives an applet: every part, the calls a folder applet makes, the vault in
// record words both ways (a real VaultClient; only the network is faked), and the hub asked for the named vault only.
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VaultClient } from "@openparachute/surface-client";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { PART_NAMES } from "../../../src/applet/kits/modules";
import { hubOf, surfaceOptions } from "./LinkParachute";
import * as parachute from "./parachute";
import { linkClient, theme, vault } from "./web";

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

  it("has every name an applet may import, as the editor's types say them: one the website can't give reads as undefined", () => {
    const dts = readFileSync(join(process.cwd(), "applets", "parachute.d.ts"), "utf8");
    const names = [...dts.matchAll(/^\s*export (?:function|const) (\w+)/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(30);
    for (const n of names) expect(n in parachute, n).toBe(true);
  });

  it("gives the theme as one object until the scheme changes (useTheme reads it as a store)", () => {
    expect(theme.now()).toBe(theme.now());
    expect(theme.now()).toHaveProperty("accent");
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

  it("draws a picture attached to the record, as the frame does: none that isn't, none from elsewhere", async () => {
    const OWL = "2026-11-23/1763-owl.png";
    const asked: string[] = [];
    // jsdom's Blob has no arrayBuffer(); a browser's does
    const JsdomBlob = globalThis.Blob;
    globalThis.Blob = NodeBlob as unknown as typeof Blob;
    onTestFinished(() => { globalThis.Blob = JsdomBlob; });
    linkClient(new VaultClient({ vaultUrl: "https://hub.test/vault/home", accessToken: "t", fetchImpl: (async (url: string) => {
      const u = new URL(url);
      asked.push(u.pathname);
      if (u.pathname.endsWith("/attachments")) return new Response(JSON.stringify([{ id: "a1", path: OWL, mimeType: "image/png" }]), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch }));
    const blob = await vault.file("n1", `/api/storage/${OWL}`);
    expect([blob.type, blob.size]).toEqual(["image/png", 4]);
    expect(asked).toEqual(["/vault/home/api/notes/n1/attachments", `/vault/home/api/storage/${OWL}`]);
    await expect(vault.file("n1", "/api/storage/2026-11-23/other.png")).rejects.toThrow(/attached/);
    await expect(vault.file("n1", `https://elsewhere.example/api/storage/${OWL}`)).rejects.toThrow(/attached/);
    expect(asked.filter((p) => p.includes("/storage/"))).toHaveLength(1);
  });

  it("says plainly when no Parachute is linked", async () => {
    await expect(vault.queryRecords({})).rejects.toThrow(/No Parachute is linked/);
  });
});
