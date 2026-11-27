// Files an applet keeps on this device until they are sent (T-476): a voice note recorded, a picture chosen, kept while
// the relay is out of reach so nothing a person sent is lost. Beside its saved state (shell/saved.ts), one store per
// applet (its grant's subject): in the app on a device, files of its own in the app's data folder (src-tauri/src/saved.rs:
// synced, then renamed); in a browser, IndexedDB (localStorage holds a few MB at most). 25 MB a file, 100 MB in all.
// Never synced, never in a vault; gone with the applet's saved state (Revoke, signing out of its vault: forgetSaved).
import { inShell } from "../vault/oauth";
import { toB64, fromB64 } from "../services/broker";

/** One file it keeps, and all of them. */
export const KEPT_FILE_MAX = 25 * 1024 * 1024;
export const KEPT_FILES_MAX = 100 * 1024 * 1024;
export const KEPT_FILES_FULL = "its files on this device are full (100 MB)";

export type FilesBackend = {
  /** "full": past 100 MB in all with it (nothing written). */
  put(subject: string, key: string, bytes: Uint8Array): Promise<"ok" | "full">;
  get(subject: string, key: string): Promise<Uint8Array | null>;
  /** One file gone; with no key, all of this subject's. */
  drop(subject: string, key?: string): Promise<void>;
  keys(subject: string): Promise<string[]>;
};

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** The app on a device: Rust keeps them, and checks the sizes again. */
export const nativeFiles = (call: typeof invoke = invoke): FilesBackend => ({
  async put(subject, key, bytes) {
    try { await call("saved_file_put", { subject, key, body: toB64(bytes) }); return "ok"; } catch (e) {
      if (e && typeof e === "object" && (e as { code?: unknown }).code === "too_large") return "full";
      throw e;
    }
  },
  async get(subject, key) { const b = await call<string | null>("saved_file_get", { subject, key }); return b === null ? null : fromB64(b); },
  drop: (subject, key) => call("saved_file_drop", { subject, key: key ?? null }),
  keys: (subject) => call<string[]>("saved_file_keys", { subject }),
});

const DB = "parachute.applet-files.v1", STORE = "files";
type Row = { subject: string; key: string; bytes: ArrayBuffer; size: number };

/** A browser: one IndexedDB store, a row a file, keyed [subject, key]. */
export const browserFiles = (idb: IDBFactory | null = typeof indexedDB === "undefined" ? null : indexedDB): FilesBackend => {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => (db ??= new Promise<IDBDatabase>((res, rej) => {
    if (!idb) { rej(new Error("this browser keeps no files")); return; }
    const r = idb.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: ["subject", "key"] }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { db = null; rej(r.error ?? new Error("its files can't be opened")); };
  }));
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const tx = (await open()).transaction(STORE, mode);
    const req = f(tx.objectStore(STORE));
    return new Promise<T | undefined>((res, rej) => {
      tx.oncomplete = () => res(req ? req.result : undefined);
      tx.onerror = () => rej(tx.error ?? new Error("its files can't be written"));
      tx.onabort = () => rej(tx.error ?? new Error("its files can't be written"));
    });
  };
  const range = (subject: string) => IDBKeyRange.bound([subject, ""], [subject, "￿"]);
  return {
    async put(subject, key, bytes) {
      const copy = bytes.slice().buffer;
      // the others' sizes and the write in one transaction, so two at once can't both pass the total
      const tx = (await open()).transaction(STORE, "readwrite"), s = tx.objectStore(STORE);
      let total = 0, full = false;
      const c = s.openCursor(range(subject));
      c.onsuccess = () => {
        const cur = c.result;
        if (cur) { const r = cur.value as Row; if (r.key !== key) total += r.size ?? r.bytes.byteLength; cur.continue(); return; }
        if (total + copy.byteLength > KEPT_FILES_MAX) { full = true; return; }
        s.put({ subject, key, bytes: copy, size: copy.byteLength } satisfies Row);
      };
      await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error ?? new Error("its files can't be written")); tx.onabort = () => rej(tx.error ?? new Error("its files can't be written")); });
      return full ? "full" : "ok";
    },
    async get(subject, key) {
      const row = (await run<Row | undefined>("readonly", (s) => s.get([subject, key]))) as Row | undefined;
      return row ? new Uint8Array(row.bytes) : null;
    },
    async drop(subject, key) { await run("readwrite", (s) => { s.delete(key === undefined ? range(subject) : [subject, key]); }); },
    async keys(subject) { return ((await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys(range(subject)))) ?? []).map((k) => (k as string[])[1]).sort(); },
  };
};

/** A file past 25 MB is refused here; the total is the backend's to check (Rust's, or one IndexedDB transaction). */
export function createKeptFiles(backend: FilesBackend) {
  return {
    /** "full" when it is over 25 MB, or would pass 100 MB in all (nothing written). */
    put: async (subject: string, key: string, bytes: Uint8Array): Promise<"ok" | "full"> => (bytes.byteLength > KEPT_FILE_MAX ? "full" : backend.put(subject, key, bytes)),
    get: (subject: string, key: string) => backend.get(subject, key),
    drop: (subject: string, key: string) => backend.drop(subject, key),
    keys: (subject: string) => backend.keys(subject),
    clear: (subject: string) => backend.drop(subject),
  };
}
export type KeptFiles = ReturnType<typeof createKeptFiles>;

let device: KeptFiles | null = null;
/** This device's files: one store for the whole app. */
export const deviceFiles = (): KeptFiles => (device ??= createKeptFiles(inShell() ? nativeFiles() : browserFiles()));
