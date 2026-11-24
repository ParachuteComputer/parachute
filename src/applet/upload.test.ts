// @vitest-environment node
// The upload's own logic (upload.ts): pieces, what a second try keeps, retries and what stops it. The hub here is a
// small stand-in with the real hub's merge-on-a-version rule; the end-to-end run is e2e/libraryadd.spec.ts.
import { describe, expect, it } from "vitest";
import { asManifest, chosenFiles, PART, sha256Hex, uploadInParts, UploadError, type Manifest, type UploadIo } from "./upload";

function bytes(n: number, seed = 1): Uint8Array {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
  return b;
}

/** A hub holding one record: stored pieces, attachments, the `upload` field and its version. `fail(step, n)` makes the
 *  nth call of a step throw `err`. */
function hub() {
  const stored = new Map<string, Uint8Array>();
  const attached: string[] = [];
  let upload: unknown = null, version = 0, online = true;
  const fails: { step: string; at: number; err: unknown }[] = [];
  const calls: Record<string, number> = { put: 0, attach: 0, write: 0, read: 0 };
  const maybe = (step: string) => { calls[step]++; const f = fails.find((x) => x.step === step && x.at === calls[step]); if (f) throw f.err; };
  const slept: number[] = [];
  let closed = false;
  const io: UploadIo = {
    read: async () => { maybe("read"); return { upload, updatedAt: String(version) }; },
    put: async (piece, name, _type, onSent) => {
      maybe("put");
      const b = new Uint8Array(await piece.arrayBuffer());
      onSent(b.length);
      const path = `2026-11-24/${stored.size}-${name}`;
      stored.set(path, b);
      return { path };
    },
    attach: async (path) => { maybe("attach"); attached.push(path); return { id: `a${attached.length}` }; },
    attached: async (path) => attached.includes(path),
    write: async (m, at) => { maybe("write"); if (at !== String(version)) throw Object.assign(new Error("conflict"), { status: 409 }); upload = JSON.parse(JSON.stringify(m)); version++; },
    hash: sha256Hex,
    online: () => online,
    whenOnline: async () => { online = true; },
    sleep: async (ms) => { slept.push(ms); },
    closed: () => closed,
  };
  return {
    io, stored, attached, calls, slept,
    get upload() { return upload; },
    fail: (step: string, at: number, err: unknown) => fails.push({ step, at, err }),
    offline: () => { online = false; },
    close: () => { closed = true; },
    bump: () => { version++; },
    joined: (m: Manifest) => { const out = new Uint8Array(m.size); let o = 0; for (const p of m.parts) { const b = stored.get(p.path)!; out.set(b, o); o += b.length; } return out; },
  };
}

const blob = (b: Uint8Array) => new Blob([b as BlobPart]);
/** Two byte runs the same (by hash: vitest's deep equality on 16 MB of bytes runs out of memory). */
const same = async (a: Uint8Array, b: Uint8Array) => a.length === b.length && (await sha256Hex(a.buffer as ArrayBuffer)) === (await sha256Hex(b.buffer as ArrayBuffer));

describe("uploadInParts", () => {
  it("sends a small file whole, with its own name, as one attachment", async () => {
    const h = hub();
    const b = bytes(1000);
    const m = await uploadInParts(blob(b), "Walden.epub", "application/epub+zip", h.io);
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].path).toMatch(/Walden\.epub$/);
    expect(m.parts[0].sha256).toBe(await sha256Hex(b.buffer as ArrayBuffer));
    expect(h.attached).toEqual([m.parts[0].path]);
    expect(asManifest(h.upload)).toEqual(m);
  });

  it("sends a large file in 8 MiB pieces, in order, and they join to the file", async () => {
    const h = hub();
    const b = bytes(2 * PART + 5);
    const seen: number[] = [];
    const m = await uploadInParts(blob(b), "Big.pdf", "application/pdf", h.io, (p) => seen.push(p.sent));
    expect(m.parts.map((p) => p.size)).toEqual([PART, PART, 5]);
    expect(m.parts.every((p) => p.path.endsWith(".part"))).toBe(true);
    expect(await same(h.joined(m), b)).toBe(true);
    expect(seen.at(-1)).toBe(b.length);
    expect(asManifest(h.upload)!.parts).toHaveLength(3);
  });

  it("picked again onto the same record, sends only the pieces that aren't there", async () => {
    const h = hub();
    const b = bytes(3 * PART);
    h.fail("put", 3, Object.assign(new Error("bad request"), { status: 400 }));
    await expect(uploadInParts(blob(b), "Big.pdf", "application/pdf", h.io)).rejects.toThrow(UploadError);
    expect(asManifest(h.upload)!.parts).toHaveLength(2);
    const puts = h.calls.put;
    const m = await uploadInParts(blob(b), "Big.pdf", "application/pdf", h.io);
    expect(h.calls.put - puts).toBe(1);
    expect(await same(h.joined(m), b)).toBe(true);
  });

  it("sends a piece again when the file changed under it (another hash), and keeps the ones before", async () => {
    const h = hub();
    const b = bytes(3 * PART);
    await uploadInParts(blob(b), "Big.pdf", "application/pdf", h.io);
    const c = b.slice();
    c[PART + 7] ^= 0xff;  // the second piece differs: it and every piece after go again
    const puts = h.calls.put;
    const m = await uploadInParts(blob(c), "Big.pdf", "application/pdf", h.io);
    expect(h.calls.put - puts).toBe(2);
    expect(await same(h.joined(m), c)).toBe(true);
  });

  it("doesn't try a refusal again: a 400 said only in surface-client's message stops at once", async () => {
    const h = hub();
    h.fail("write", 1, new Error("PATCH /api/notes/x failed (400): bad field"));
    await expect(uploadInParts(blob(bytes(10)), "a.epub", "application/epub+zip", h.io)).rejects.toThrow(/saving what landed: .*\(400\)/);
    expect(h.slept).toEqual([]);
  });

  it("attaches a piece once when the first answer was lost after it landed", async () => {
    const h = hub();
    const real = h.io.attach;
    let n = 0;
    h.io.attach = async (path, type) => { const r = await real(path, type); if (++n === 1) throw Object.assign(new Error("Network error"), { status: 0 }); return r; };
    const m = await uploadInParts(blob(bytes(PART + 3)), "Big.pdf", "application/pdf", h.io);
    expect(h.attached).toEqual(m.parts.map((p) => p.path));
  });

  it("goes on with a file whose type another picker named otherwise, keeping the record's", async () => {
    const h = hub();
    const b = bytes(2 * PART);
    h.fail("put", 2, Object.assign(new Error("bad request"), { status: 400 }));
    await expect(uploadInParts(blob(b), "Book.epub", "application/epub+zip", h.io)).rejects.toThrow(UploadError);
    const m = await uploadInParts(blob(b), "Book.epub", "application/octet-stream", h.io);
    expect(m.type).toBe("application/epub+zip");
    expect(m.parts).toHaveLength(2);
  });

  it("never shortens a list another upload of the same file has taken further", async () => {
    const h = hub();
    const b = bytes(3 * PART);
    await uploadInParts(blob(b), "Big.pdf", "application/pdf", h.io);
    const full = asManifest(h.upload)!;
    // a second upload that saw only the first piece writes nothing shorter over the full list
    const realRead = h.io.read;
    let first = true;
    h.io.read = async () => { const r = await realRead(); if (first) { first = false; return { ...r, upload: { ...full, parts: full.parts.slice(0, 1) } }; } return r; };
    h.fail("put", 5, Object.assign(new Error("bad request"), { status: 400 }));  // and stops before its last piece
    await expect(uploadInParts(blob(b), "Big.pdf", "application/pdf", h.io)).rejects.toThrow(UploadError);
    expect(asManifest(h.upload)!.parts).toHaveLength(3);
  });

  it("a different file of the same name and size replaces the list as it goes, never hiding behind the old one", async () => {
    const h = hub();
    await uploadInParts(blob(bytes(3 * PART, 1)), "Big.pdf", "application/pdf", h.io);
    const other = bytes(3 * PART, 2);
    h.fail("put", 5, Object.assign(new Error("bad request"), { status: 400 }));  // its second piece is refused
    await expect(uploadInParts(blob(other), "Big.pdf", "application/pdf", h.io)).rejects.toThrow(UploadError);
    const now = asManifest(h.upload)!;
    expect(now.parts).toHaveLength(1);
    expect(now.parts[0].sha256).toBe(await sha256Hex(other.slice(0, PART).buffer as ArrayBuffer));
  });

  it("doesn't wait for ever on a device that says it is offline while it isn't", async () => {
    const h = hub();
    let looks = 0;
    h.io.online = () => false;
    h.io.whenOnline = async () => { looks++; };
    const m = await uploadInParts(blob(bytes(10)), "a.epub", "application/epub+zip", h.io);
    expect(m.parts).toHaveLength(1);
    expect(looks).toBe(120);
  });

  it("refuses a record that holds another file's upload", async () => {
    const h = hub();
    await uploadInParts(blob(bytes(10)), "One.epub", "application/epub+zip", h.io);
    await expect(uploadInParts(blob(bytes(11)), "Two.epub", "application/epub+zip", h.io)).rejects.toThrow(/another file's upload \(One\.epub\)/);
  });

  it("tries a piece again after the network drops, and waits for the device to be online", async () => {
    const h = hub();
    h.fail("put", 2, Object.assign(new Error("Network error during upload"), { status: 0 }));
    h.fail("put", 3, Object.assign(new Error("Bad gateway"), { status: 502 }));
    h.offline();
    const b = bytes(2 * PART);
    const m = await uploadInParts(blob(b), "Big.pdf", "application/pdf", h.io);
    expect(h.slept).toEqual([1000, 2000]);
    expect(await same(h.joined(m), b)).toBe(true);
    expect(h.attached).toHaveLength(2);
  });

  it("writes what landed again on a version that moved (the applet wrote the record meanwhile)", async () => {
    const h = hub();
    const b = bytes(PART + 1);
    const realRead = h.io.read;
    let n = 0;
    h.io.read = async () => { const r = await realRead(); if (++n === 2) h.bump(); return r; };  // a write lands between the read and ours
    const m = await uploadInParts(blob(b), "Big.pdf", "application/pdf", h.io);
    expect(asManifest(h.upload)).toEqual(m);
  });

  it("stops on a refusal it can't get past, and when the screen closes", async () => {
    const h = hub();
    h.fail("attach", 1, Object.assign(new Error("not allowed"), { status: 403 }));
    await expect(uploadInParts(blob(bytes(10)), "a.epub", "application/epub+zip", h.io)).rejects.toThrow(/attaching piece 1: not allowed/);
    const g = hub();
    g.close();
    await expect(uploadInParts(blob(bytes(10)), "a.epub", "application/epub+zip", g.io)).rejects.toThrow(/closed/);
  });

  it("gives up on a piece after about two minutes of failures", async () => {
    const h = hub();
    for (let k = 1; k <= 20; k++) h.fail("put", k, Object.assign(new Error("down"), { status: 503 }));
    await expect(uploadInParts(blob(bytes(10)), "a.epub", "application/epub+zip", h.io)).rejects.toThrow(/piece 1 of 1: down/);
    expect(h.slept.reduce((s, x) => s + x, 0)).toBe(120_000);
  });

  it("refuses an empty file and one over 2 GB", async () => {
    await expect(uploadInParts(blob(new Uint8Array(0)), "a", "x/y", hub().io)).rejects.toThrow(/empty/);
    const huge = { size: 2 * 1024 * 1024 * 1024 + 1, slice: () => new Blob() } as unknown as Blob;
    await expect(uploadInParts(huge, "a", "x/y", hub().io)).rejects.toThrow(/over 2 GB/);
  });
});

describe("asManifest and chosenFiles", () => {
  it("reads only a well-formed manifest", () => {
    expect(asManifest({ name: "a", type: "t", size: 1, parts: [{ path: "p", size: 1, sha256: "s" }] })).toEqual({ name: "a", type: "t", size: 1, parts: [{ path: "p", size: 1, sha256: "s", id: null }] });
    expect(asManifest({ name: "a", type: "t", size: 1, parts: [{ path: 3 }] })).toBeNull();
    expect(asManifest("x")).toBeNull();
  });
  it("hands out handles for picked files, and only the shell resolves them", () => {
    const c = chosenFiles();
    const f = { name: "x.txt", type: "text/plain", size: 1, file: new File(["x"], "x.txt") };
    const h = c.add(f);
    expect(h).toBe("f1");
    expect(c.get(h)).toBe(f);
    expect(c.get("f2")).toBeUndefined();
  });
});
