// The bridge's HTTP answers when the hub misbehaves or holds odd records: cases a real hub can't be made to produce on
// demand (a storage error, a failed upload, two records with one uid, a photo path that leaves storage). The hub is
// faked at its REST door (an outside system); the bridge, its vault client and its card code are the real ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createBridge } from "../src/server.ts";
import { addDevice } from "../src/devices.ts";
import { vaultClient } from "../src/vault.ts";

type Rec = { id: string; path: string; updatedAt: string; fields: Record<string, unknown>; body: string };

/** A hub's record door in memory. `storage` answers a storage read; `upload` an upload. Every URL asked is kept. */
function fakeHub(records: Rec[], opts: { storage?: (path: string) => Response; upload?: () => Response } = {}) {
  const asked: string[] = [];
  let n = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 23, 12, 0, 0, ++n)).toISOString();
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const row = (r: Rec) => ({ id: r.id, path: r.path, extension: "md", updatedAt: r.updatedAt, fields: r.fields, preview: r.body.slice(0, 20) });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(url.pathname);
    const method = init?.method ?? "GET";
    const p = url.pathname.replace(/^\/vault\/v\/api/, "");
    if (method === "GET" && p === "/records") {
      const off = Number(url.searchParams.get("offset") ?? 0), lim = Number(url.searchParams.get("limit") ?? 50);
      return json(records.filter((r) => r.path.startsWith(url.searchParams.get("path_prefix") ?? "")).slice(off, off + lim).map(row));
    }
    const one = /^\/records\/([^/]+)$/.exec(p);
    if (one && method === "GET") { const r = records.find((x) => x.id === decodeURIComponent(one[1])); return r ? json({ ...row(r), body: r.body }) : json({}, 404); }
    if (one && method === "PATCH") {
      const r = records.find((x) => x.id === decodeURIComponent(one[1]))!;
      const b = JSON.parse(String(init!.body)) as { if_updated_at: string; fields: Record<string, unknown> };
      if (b.if_updated_at !== r.updatedAt) return json({ error_type: "conflict" }, 409);
      for (const [k, v] of Object.entries(b.fields)) { if (v === null) delete r.fields[k]; else r.fields[k] = v; }
      r.updatedAt = stamp();
      return json({ ...row(r), body: r.body });
    }
    if (method === "POST" && p === "/records") {
      const b = JSON.parse(String(init!.body)) as { path: string; body: string; fields: Record<string, unknown> };
      if (records.some((r) => r.path === b.path)) return json({ error_type: "path_conflict" }, 409);
      const r: Rec = { id: `R${records.length + 1}`, path: b.path, updatedAt: stamp(), fields: b.fields, body: b.body };
      records.push(r);
      return json({ ...row(r), body: r.body }, 201);
    }
    if (method === "POST" && p === "/storage/upload") return opts.upload?.() ?? json({ path: "2026-11-23/up.jpg" }, 201);
    if (method === "POST" && /^\/records\/[^/]+\/attachments$/.test(p)) return json({}, 201);
    if (method === "GET" && p.startsWith("/storage/")) return opts.storage?.(p.slice(9)) ?? new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
    return json({ error: "not here" }, 404);
  }) as typeof globalThis.fetch;
  return { fetch, asked, records };
}

async function withBridge(hub: ReturnType<typeof fakeHub>, run: (call: (method: string, path: string, init?: { body?: string; headers?: Record<string, string> }) => Promise<Response>, logs: string[]) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "carddav-server-"));
  const devices = join(dir, "devices");
  const pw = addDevice(devices, "pixel");
  const logs: string[] = [];
  const server = createBridge({ vault: vaultClient("http://hub.test/vault/v", "t", hub.fetch), devices, log: (l) => logs.push(l) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = `Basic ${Buffer.from(`pixel:${pw}`).toString("base64")}`;
  try {
    await run((method, path, init = {}) => fetch(base + path, { method, body: init.body, headers: { authorization: auth, ...init.headers } }), logs);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}

const rec = (id: string, name: string, fields: Record<string, unknown> = {}): Rec => ({ id, path: `People/${name}`, updatedAt: "2026-11-23T10:00:00.000Z", fields, body: "PRIVATE body" });
const BOOK = "/dav/addressbooks/people/";
const LIST = `<?xml version='1.0' encoding='UTF-8' ?><propfind xmlns="DAV:"><prop><resourcetype /><getetag /></prop></propfind>`;

test("a photo the hub can't give now fails the request, instead of a card without it under the same ETag", async () => {
  const hub = fakeHub([rec("A", "Maya Lin", { photo: "2026-11-23/a.jpg" })], { storage: () => new Response("busy", { status: 503 }) });
  await withBridge(hub, async (call) => {
    assert.equal((await call("GET", `${BOOK}A.vcf`)).status, 502);
  });
  // gone for good: served without it
  const gone = fakeHub([rec("A", "Maya Lin", { photo: "2026-11-23/a.jpg" })], { storage: () => new Response("", { status: 404 }) });
  await withBridge(gone, async (call) => {
    const r = await call("GET", `${BOOK}A.vcf`);
    assert.equal(r.status, 200);
    assert.doesNotMatch(await r.text(), /PHOTO/);
  });
});

test("a photo path that leaves storage is never fetched", async () => {
  const hub = fakeHub([rec("A", "Maya Lin", { photo: "../records/B" }), rec("B", "Theo Park")]);
  await withBridge(hub, async (call) => {
    const r = await call("GET", `${BOOK}A.vcf`);
    assert.equal(r.status, 200);
    assert.doesNotMatch(await r.text(), /PHOTO|PRIVATE/);
    assert.ok(!hub.asked.some((u) => u.includes("storage")), hub.asked.join(" "));
  });
});

test("a picture that won't attach doesn't undo the new person: 201, no ETag", async () => {
  const hub = fakeHub([], { upload: () => new Response("full", { status: 507 }) });
  await withBridge(hub, async (call, logs) => {
    const card = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:u-1\r\nFN:Jonas Weber\r\nTEL;TYPE=cell:+49 30 901820\r\nPHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQ\r\nEND:VCARD\r\n";
    const r = await call("PUT", `${BOOK}u-1.vcf`, { body: card, headers: { "if-none-match": "*", "content-type": "text/vcard" } });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get("etag"), null);
    assert.deepEqual(hub.records.map((x) => [x.path, x.fields.uid, x.fields.phones]), [["People/Jonas Weber", "u-1", ["mobile: +49 30 901820"]]]);
    assert.ok(logs.some((l) => /photo not attached/.test(l)));
  });
});

test("two records with one uid are one card: listed once, the same one read", async () => {
  const hub = fakeHub([rec("A", "Maya Lin", { uid: "same", summary: "first" }), rec("B", "Maya Lin 2", { uid: "same", summary: "second" }), rec("C", "Theo Park")]);
  await withBridge(hub, async (call) => {
    const xml = await (await call("PROPFIND", BOOK, { body: LIST, headers: { depth: "1" } })).text();
    const hrefs = [...xml.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, [BOOK, `${BOOK}same.vcf`, `${BOOK}C.vcf`]);
    assert.match(await (await call("GET", `${BOOK}same.vcf`)).text(), /NOTE:first/);
  });
});

test("a card with something the vault won't keep gets no ETag on its PUT, so the phone reads back what was kept", async () => {
  const hub = fakeHub([]);
  await withBridge(hub, async (call) => {
    // each its own name, so nothing but the line under test differs from what is kept
    const card = (uid: string, more: string) => `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:Ines ${uid}\r\n${more}END:VCARD\r\n`;
    let r = await call("PUT", `${BOOK}u-2.vcf`, { body: card("u-2", ""), headers: { "if-none-match": "*", "content-type": "text/vcard" } });
    assert.equal(r.status, 201);
    assert.ok(r.headers.get("etag"), "kept as sent: an ETag");
    r = await call("PUT", `${BOOK}u-3.vcf`, { body: card("u-3", `X-LONG:${"x".repeat(9000)}\r\n`), headers: { "if-none-match": "*", "content-type": "text/vcard" } });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get("etag"), null);
    r = await call("PUT", `${BOOK}u-4.vcf`, { body: card("u-4", "PHOTO;VALUE=uri:https://pictures.example/ines.jpg\r\n"), headers: { "if-none-match": "*", "content-type": "text/vcard" } });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get("etag"), null);
  });
});
