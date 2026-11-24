// A file the person picked, carried by the shell onto a record (docs/design/UPLOADS.md): `app.pick({bytes: false})`
// gives the applet a handle, never the bytes, and `vault.upload(id, handle)` sends the file here.
//
// Today's transport needs nothing new of the hub: a file up to PART goes up whole (its own name and extension, one
// attachment); a larger one in PART-sized pieces, each its own stored file (`.part`, kept as octet-stream) attached to
// the record in order, each with its SHA-256. After each piece the record's `upload` field says what has landed, so
// the record is the manifest: picked again and sent onto the same record, the pieces already there (same size, same
// hash) are not sent again. A piece is read alone (`Blob.slice`), so a file of any size holds PART in memory; a piece
// that fails on the network is tried again, waiting longer each time and for the device to be back online.
// When the hub has a resumable route (UPLOADS.md §6.1) it goes there instead, and the answer keeps this shape.

import type { ChosenFile } from "./modules/app.ts";

/** A piece: 8 MiB, far under every hub's limit (core's 100 MiB, Cloudflare's 100 MB a request). */
export const PART = 8 * 1024 * 1024;
/** The largest file an applet may have uploaded: 256 pieces. */
export const UPLOAD_MAX = 2 * 1024 * 1024 * 1024;

export type Part = { path: string; size: number; sha256: string; id: string | null };
/** The record's `upload` field: the file, and its pieces in order (one piece: the whole file). */
export type Manifest = { name: string; type: string; size: number; parts: Part[] };
export type Progress = { sent: number; size: number };

/** What it needs of the hub and the device (vaultDeps.ts gives the real ones). */
export type UploadIo = {
  /** The record's `upload` field as the hub has it now, and the version it read. */
  read(): Promise<{ upload: unknown; updatedAt: string | null }>;
  /** One piece into the vault's storage; `onSent(loaded)` as its bytes go. */
  put(piece: Blob, name: string, type: string, onSent: (loaded: number) => void): Promise<{ path: string }>;
  /** A stored piece onto the record. */
  attach(path: string, type: string): Promise<{ id: string | null }>;
  /** The record's `upload` field set (the hub merges fields: nothing else changes), on version `updatedAt`. */
  write(upload: Manifest, updatedAt: string | null): Promise<void>;
  hash(bytes: ArrayBuffer): Promise<string>;
  online(): boolean;
  /** Resolves when the device says it is online again. */
  whenOnline(): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** The applet's screen is gone: stop between steps. */
  closed(): boolean;
};

/** Waits between tries of one step, about two minutes in all; time offline doesn't count. */
export const WAITS = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000];

/** The hub's answer's status on an error, or 0 for none (the network). */
const statusOf = (e: unknown): number => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : 0;
};
/** Worth trying again: no answer, a timeout, too many, a hub restarting; a sign-in being renewed. */
const again = (e: unknown) => { const s = statusOf(e); return s === 0 || s === 401 || s === 408 || s === 429 || s >= 500; };
const conflict = (e: unknown) => statusOf(e) === 409 || /conflict/i.test(String((e as Error)?.message ?? e));

export class UploadError extends Error {}

/** A manifest as the hub kept it, or null for anything else. */
export function asManifest(raw: unknown): Manifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.name !== "string" || typeof m.type !== "string" || typeof m.size !== "number" || !Array.isArray(m.parts)) return null;
  const parts: Part[] = [];
  for (const p of m.parts as unknown[]) {
    const q = p as Record<string, unknown> | null;
    if (!q || typeof q.path !== "string" || typeof q.size !== "number" || typeof q.sha256 !== "string") return null;
    parts.push({ path: q.path, size: q.size, sha256: q.sha256, id: typeof q.id === "string" ? q.id : null });
  }
  return { name: m.name, type: m.type, size: m.size, parts };
}

/** How many pieces a file of `size` goes up in. */
export const pieces = (size: number) => (size <= PART ? 1 : Math.ceil(size / PART));

/** Send `file` (named `name`, of `type`) onto the record `io` writes to; the manifest when every piece is there. */
export async function uploadInParts(file: Blob, name: string, type: string, io: UploadIo, progress: (p: Progress) => void = () => {}): Promise<Manifest> {
  const size = file.size;
  if (!size) throw new UploadError("the file is empty");
  if (size > UPLOAD_MAX) throw new UploadError("the file is over 2 GB");
  const n = pieces(size);
  const piece = (i: number) => file.slice(i * PART, Math.min(size, (i + 1) * PART));
  const step = async <T,>(what: string, run: () => Promise<T>): Promise<T> => {
    for (let tries = 0; ; ) {
      if (io.closed()) throw new UploadError("the applet's screen closed");
      if (!io.online()) { await io.whenOnline(); continue; }
      try { return await run(); } catch (e) {
        if (e instanceof UploadError || !again(e) || tries >= WAITS.length) throw new UploadError(`${what}: ${e instanceof Error ? e.message.slice(0, 200) : "it failed"}`);
        await io.sleep(WAITS[tries++]);
        // a sign-in renewed meanwhile: a read takes the new one, which the next piece then goes with
        if (statusOf(e) === 401) await io.read().catch(() => {});
      }
    }
  };

  // what landed before: kept only while it is this file's, piece by piece (same size, same hash)
  const was = asManifest((await step("reading the record", () => io.read())).upload);
  const m: Manifest = { name, type, size, parts: [] };
  if (was && was.parts.length && (was.name !== name || was.size !== size || was.type !== type)) throw new UploadError(`this record holds another file's upload (${was.name.slice(0, 100)})`);
  for (const p of was?.parts.slice(0, n) ?? []) {
    const b = piece(m.parts.length);
    if (p.size !== b.size || p.sha256 !== await io.hash(await b.arrayBuffer())) break;
    m.parts.push(p);
  }
  let done = m.parts.reduce((s, p) => s + p.size, 0), last = 0;
  const say = (sent: number, force = false) => { const t = Date.now(); if (force || t - last >= 250) { last = t; progress({ sent, size }); } };
  say(done, true);

  for (let i = m.parts.length; i < n; i++) {
    const b = piece(i);
    const sha = await io.hash(await b.arrayBuffer());
    const one = n === 1;
    const stored = await step(`piece ${i + 1} of ${n}`, () => io.put(b, one ? name : `${String(i + 1).padStart(4, "0")}.part`, one ? type : "application/octet-stream", (loaded) => say(done + Math.min(loaded, b.size))));
    const att = await step(`attaching piece ${i + 1}`, () => io.attach(stored.path, one ? type : "application/octet-stream"));
    m.parts.push({ path: stored.path, size: b.size, sha256: sha, id: att.id });
    done += b.size;
    // the record says what landed: read fresh each time (the applet may write it too), once more on a conflict
    await step("saving what landed", async () => {
      for (let k = 0; ; k++) {
        try { await io.write({ ...m, parts: [...m.parts] }, (await io.read()).updatedAt); return; } catch (e) { if (!conflict(e) || k >= 3) throw e; }
      }
    });
    say(done, true);
  }
  // nothing new landed (all there before): the record already says so
  return m;
}

/** A file's SHA-256 as hex (WebCrypto). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The files picked on one applet's screen, by the handle the applet holds (`f1`, `f2`…): only the shell holds them. */
export function chosenFiles() {
  const files = new Map<string, ChosenFile>();
  let next = 0;
  return {
    add(f: ChosenFile): string { const h = `f${++next}`; files.set(h, f); while (files.size > 50) files.delete(files.keys().next().value as string); return h; },
    get: (h: string): ChosenFile | undefined => files.get(h),
    clear: () => files.clear(),
  };
}
export type ChosenFiles = ReturnType<typeof chosenFiles>;
