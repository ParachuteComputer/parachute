// What each applet saved on this device: its drafts, where it was, what it keeps with `storage` (docs/WRITE-AN-APPLET.md
// "Saved state"). One store per applet, keyed by its subject (its vault on this device and its note: grants.ts
// `subjectOf`), kept in memory for the session and written through at once: in the app on a device to a file of its
// own (src-tauri/src/saved.rs: synced, then renamed, so a force-stop or a reboot keeps the last whole copy); in a
// browser to localStorage. Never synced, never in a vault. The applet's `saved` and `storage` calls are one store.
import { inShell } from "../vault/oauth";

/** The most one applet keeps, as JSON. */
export const SAVED_MAX = 256 * 1024;
/** Where a browser keeps one applet's store, and where the app kept `storage` before (copied into the file once). */
export const SAVED_PREFIX = "parachute.applet-storage.v1:";

type Values = Record<string, unknown>;
export type SavedBackend = { read(subject: string): Promise<Values>; write(subject: string, all: Values): Promise<void> };

const objectOf = (text: string | null): Values => {
  try {
    const v = JSON.parse(text ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Values)) : {};
  } catch { return {}; }
};

export const browserBackend = (storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = typeof localStorage === "undefined" ? null : localStorage): SavedBackend => ({
  async read(subject) { return objectOf(storage?.getItem(SAVED_PREFIX + encodeURIComponent(subject)) ?? null); },
  async write(subject, all) {
    const key = SAVED_PREFIX + encodeURIComponent(subject);
    if (Object.keys(all).length) storage?.setItem(key, JSON.stringify(all));
    else storage?.removeItem(key);
  },
});

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** The app on a device: a file per applet, written by Rust. What the browser store held for it before (the old
 *  `storage`) is copied in the first time, then dropped from localStorage. */
export const nativeBackend = (): SavedBackend => {
  const old = browserBackend();
  return {
    async read(subject) {
      const kept = objectOf(await invoke<string>("saved_get", { subject }));
      if (Object.keys(kept).length) return kept;
      const before = await old.read(subject);
      if (Object.keys(before).length) {
        await invoke("saved_put", { subject, json: JSON.stringify(before) });
        await old.write(subject, {});
      }
      return before;
    },
    async write(subject, all) { await invoke("saved_put", { subject, json: JSON.stringify(all) }); },
  };
};

export const savedSize = (all: Values): number => new TextEncoder().encode(JSON.stringify(all)).length;

export function createSavedStore(backend: SavedBackend) {
  const memory = new Map<string, Values>();
  const loading = new Map<string, Promise<Values>>();
  // writes for one subject go out one after another, so an older copy never lands after a newer one
  const writing = new Map<string, Promise<void>>();
  const persist = (subject: string, all: Values) => {
    // a failed write is the caller's to hear (the kit puts the change back in line); the next write goes after it either way
    const next = (writing.get(subject) ?? Promise.resolve()).catch(() => {}).then(() => backend.write(subject, all));
    writing.set(subject, next.catch(() => {}));
    return next;
  };
  return {
    /** What the applet saved, read once per session (and handed to it before it starts). */
    load(subject: string): Promise<Values> {
      const have = memory.get(subject);
      if (have) return Promise.resolve({ ...have });
      let p = loading.get(subject);
      if (!p) {
        p = backend.read(subject).catch(() => ({} as Values)).then((v) => { if (!memory.has(subject)) memory.set(subject, v); loading.delete(subject); return memory.get(subject)!; });
        loading.set(subject, p);
      }
      return p.then((v) => ({ ...v }));
    },
    /** What it holds now (after `load`). */
    now(subject: string): Values { return { ...(memory.get(subject) ?? {}) }; },
    /** Set some keys (null removes one) and write the store through. Refused, and nothing changed, past SAVED_MAX. */
    async put(subject: string, entries: Values): Promise<"ok" | "full"> {
      const base = memory.get(subject) ?? await this.load(subject);
      const next: Values = Object.fromEntries(Object.entries(base).filter(([k]) => !Object.hasOwn(entries, k)));
      for (const [k, v] of Object.entries(entries)) if (v !== null && v !== undefined) next[k] = v;
      if (savedSize(next) > SAVED_MAX) return "full";
      memory.set(subject, next);
      await persist(subject, next);
      return "ok";
    },
    /** Everything it saved, gone. */
    async clear(subject: string): Promise<void> { memory.set(subject, {}); await persist(subject, {}); },
    /** Wait for every write already started (tests, and before the app leaves). */
    async settled(): Promise<void> { await Promise.all([...writing.values()]).catch(() => {}); },
  };
}
export type SavedStore = ReturnType<typeof createSavedStore>;

let device: SavedStore | null = null;
/** This device's store: one for the whole app. */
export const deviceSaved = (): SavedStore => (device ??= createSavedStore(inShell() ? nativeBackend() : browserBackend()));
