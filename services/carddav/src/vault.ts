// The vault, through its hub's REST record door (core 0.9+: `/vault/<name>/api/records`). The bridge reads only what a
// record list gives (id, path, fields, updatedAt) and keeps no body: a row's `preview` and `displayTitle`, which hold
// the body's first words, are dropped as each row is read.
import type { Person } from "./card.ts";

export class VaultError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** The record's `if_updated_at` no longer holds: someone changed it since it was read. */
export class Conflict extends VaultError {}

const PAGE = 200;

export type Vault = ReturnType<typeof vaultClient>;

/** A client for one vault. `base` is the vault's address, `https://hub.example/vault/<name>`; `token` its bearer token. */
export function vaultClient(base: string, token: string, f: typeof fetch = fetch) {
  const api = `${base.replace(/\/+$/, "")}/api`;
  const auth = { authorization: `Bearer ${token}` };
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await f(`${api}${path}`, { method, headers: { ...auth, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    if (r.status === 409) {
      let kind = "";
      try { kind = (JSON.parse(text) as { error_type?: string }).error_type ?? ""; } catch { /* not JSON */ }
      if (kind === "conflict") throw new Conflict(409, "the record changed since it was read");
      throw new VaultError(409, kind || "conflict");
    }
    // the hub's message, never the request (it holds no secret, but keep logs to what the hub said)
    if (!r.ok) throw new VaultError(r.status, `${method} ${path.split("?")[0]}: ${r.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  const person = (r: Record<string, unknown>): Person => ({
    id: String(r.id),
    path: String(r.path),
    updatedAt: String(r.updatedAt ?? r.updated_at ?? ""),
    fields: (r.fields && typeof r.fields === "object" ? r.fields : {}) as Record<string, unknown>,
  });
  return {
    /** Every record under a folder, oldest made first, read in pages until one comes back empty. Notes only (`.md`). */
    async list(folder: string): Promise<Person[]> {
      const out: Person[] = [];
      for (let offset = 0; ; ) {
        const rows = await call<Record<string, unknown>[]>("GET", `/records?path_prefix=${encodeURIComponent(folder)}&include_fields=true&order_by=created_at&sort=asc&limit=${PAGE}&offset=${offset}`);
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const r of rows) if ((r.extension ?? "md") === "md") out.push(person(r));
        offset += rows.length;
      }
      return out;
    },
    async get(id: string): Promise<Person | null> {
      try { return person(await call<Record<string, unknown>>("GET", `/records/${encodeURIComponent(id)}`)); }
      catch (e) { if (e instanceof VaultError && e.status === 404) return null; throw e; }
    },
    /** A new record. Throws VaultError 409 (`path_conflict`) when the path is taken. */
    async create(rec: { path: string; body: string; fields: Record<string, unknown>; types: string[] }): Promise<Person> {
      return person(await call<Record<string, unknown>>("POST", "/records", rec));
    },
    /** Merge fields into a record (`null` removes one), only if it is as it was read. Throws Conflict when it isn't. */
    async patch(id: string, ifUpdatedAt: string, fields: Record<string, unknown>): Promise<Person> {
      return person(await call<Record<string, unknown>>("PATCH", `/records/${encodeURIComponent(id)}`, { if_updated_at: ifUpdatedAt, fields }));
    },
    /** Upload a picture and attach it to a record; its storage path. */
    async attach(id: string, bytes: Uint8Array, mime: string): Promise<string> {
      const fd = new FormData();
      const ext = mime === "image/png" ? "png" : mime === "image/gif" ? "gif" : mime === "image/webp" ? "webp" : "jpg";
      fd.append("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }), `photo.${ext}`);
      const r = await f(`${api}/storage/upload`, { method: "POST", headers: auth, body: fd });
      if (!r.ok) throw new VaultError(r.status, `upload: ${r.status}`);
      const { path } = await r.json() as { path: string };
      await call("POST", `/records/${encodeURIComponent(id)}/attachments`, { path, mimeType: mime });
      return path;
    },
    /** A stored file's bytes; null when the path isn't a storage path (`<day>/<file>`: no `.` or `..` part, which would
     *  reach past storage with this token), when it is gone, or when it is bigger than `max`. Throws when the hub
     *  doesn't answer as it should. */
    async file(path: string, max: number): Promise<{ mime: string; bytes: Uint8Array } | null> {
      const parts = path.split("/");
      if (parts.some((x) => x === "" || x === "." || x === ".." || /[\\\u0000-\u001f]/.test(x))) return null;
      const r = await f(`${api}/storage/${parts.map(encodeURIComponent).join("/")}`, { headers: auth });
      if (r.status === 404) { await r.body?.cancel(); return null; }
      if (!r.ok) { await r.body?.cancel(); throw new VaultError(r.status, `storage: ${r.status}`); }
      const len = Number(r.headers.get("content-length") ?? "0");
      if (len > max) { await r.body?.cancel(); return null; }
      const bytes = new Uint8Array(await r.arrayBuffer());
      return bytes.length > max ? null : { mime: (r.headers.get("content-type") ?? "image/jpeg").split(";")[0], bytes };
    },
  };
}
