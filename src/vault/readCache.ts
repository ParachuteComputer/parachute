// Reads at once (T-476, "it keeps taking very long to load things"). A vault read the app made before is answered from
// the copy kept of it, at once, and the hub is asked behind it: when the hub's answer differs, the copy is replaced and
// whoever reads that vault is told (`onFresh`), so a screen drawn from the copy is drawn again from the hub's answer.
// Stale-while-revalidate, for the reads that go through a kept client (client.ts `keptClientFor`); every other call is
// as before.
//
// - The copies are kept on this device (IndexedDB), so the app opened again shows what it showed before at once. Each is
//   the copy of one hub's vault (`who`, its issuer): a vault of the same name on another hub never reads it. They go with
//   the vault's sign-out and with a sign-in the hub refuses (`dropKept`), and are never in a backup (Android: nothing of
//   the app is, #77).
// - A write to a vault through the app: what is read after it this session comes from the hub (the copies are kept for
//   the next start, and asked behind as always); a read already on its way isn't kept.
// - Only a GET's 200 or 404 is kept (a 404 is an answer too: "there is no settings note").
// - The hub is asked behind a copy at most once per REVALIDATE_MS for one read, counted from the ask and from the
//   answer (a screen drawn three times asks once; the readers told of a new answer don't ask for it again). A screen
//   shown again asks again at once (`askAgain`). Before this, every read went to the hub; the copies change what shows
//   first, and the hub is never asked more than it was.

type Entry = { vault: string; who: string; body: string; status: number; type: string; at: number };

/** How long after asking the hub behind a copy (or its answer) the same read is answered from the copy alone: a burst
 *  of the same read asks once, and the readers told of an answer don't ask for it again; any open after that asks. */
export const REVALIDATE_MS = 300;
/** How many reads are kept on this device and in memory, the oldest dropped first; and the largest one kept. */
export const KEEP_MAX = 600, MEM_MAX = 400, ENTRY_MAX = 1_000_000;

const mem = new Map<string, Entry>();
const asked = new Map<string, number>();
/** When the hub last answered each read, this session (a copy's age on disk says nothing of what was asked now). */
const answered = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();
/** Reads to ask the hub behind at once, whenever they were last asked (a screen shown again). */
const forced = new Set<string>();
/** Each vault's writes and sign-outs: a read that set off before one isn't kept. */
const writes = new Map<string, number>();
/** When this session last wrote to each vault: a copy from before it isn't answered from. */
const writtenAt = new Map<string, number>();
const listeners = new Set<(vault: string, read: string) => void>();

/** Told when the hub's answer to a read that was answered from its copy differs from the copy: (vault, the read's path
 *  and query). */
export function onFresh(cb: (vault: string, read: string) => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
/** Tell the readers: the vault, and the read (its path and query). */
const tell = (vault: string, key: string) => { const read = key.slice(vault.length + 1); listeners.forEach((f) => { try { f(vault, read); } catch { /* one listener's trouble is its own */ } }); };

function remember(key: string, e: Entry) {
  mem.delete(key);
  mem.set(key, e);
  while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value as string);
}

// ── the copies on this device: IndexedDB where there is one (the app; a browser), else this session only (tests) ──

const DB = "parachute-reads", STORE = "reads";
let dbP: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbP) return dbP;
  dbP = new Promise((res) => {
    try {
      if (typeof indexedDB === "undefined") { res(null); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE); s.createIndex("vault", "vault"); s.createIndex("at", "at"); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbP;
}
// opened as the app loads, beside its first screen's work: the start's first reads then find it open
void db();
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function diskGet(key: string): Promise<Entry | null> {
  const d = await db();
  if (!d) return null;
  try { return ((await req(d.transaction(STORE).objectStore(STORE).get(key))) as Entry | undefined) ?? null; } catch { return null; }
}
let puts = 0;
async function diskPut(key: string, e: Entry): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    const s = d.transaction(STORE, "readwrite").objectStore(STORE);
    await req(s.put(e, key));
    // now and then, the oldest go past KEEP_MAX
    if (++puts % 50 === 0) {
      const n = await req(s.count());
      if (n > KEEP_MAX) {
        const t = d.transaction(STORE, "readwrite").objectStore(STORE);
        let left = n - KEEP_MAX;
        const cur = t.index("at").openCursor();
        cur.onsuccess = () => { const c = cur.result; if (!c || left <= 0) return; c.delete(); left--; c.continue(); };
      }
    }
  } catch { /* kept this session only */ }
}
async function diskDropVault(vault: string): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction(STORE, "readwrite");
    const cur = tx.objectStore(STORE).index("vault").openCursor(IDBKeyRange.only(vault));
    cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); c.continue(); } };
    await new Promise<void>((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res(); });
  } catch { /* nothing kept */ }
}

/** Forget every copy of a vault's reads (sign-out, its sign-in refused); a read on its way now isn't kept. */
export async function dropKept(vault: string): Promise<void> {
  writes.set(vault, (writes.get(vault) ?? 0) + 1);
  for (const [k, e] of mem) if (e.vault === vault) mem.delete(k);
  for (const k of [...asked.keys()]) if (k.startsWith(`${vault} `)) asked.delete(k);
  for (const k of [...answered.keys()]) if (k.startsWith(`${vault} `)) answered.delete(k);
  for (const k of [...forced]) if (k.startsWith(`${vault} `)) forced.delete(k);
  await diskDropVault(vault);
}
/** Forget every copy (tests). */
export function dropAllKept(): void { mem.clear(); asked.clear(); answered.clear(); inflight.clear(); writes.clear(); writtenAt.clear(); forced.clear(); }

/** The next read of these (in this vault, `which` of them) asks the hub behind its copy at once: a screen shown again. */
export function askAgain(vault: string, which: (read: string) => boolean = () => true): void {
  for (const k of mem.keys()) if (k.startsWith(`${vault} `) && which(k.slice(vault.length + 1))) forced.add(k);
}

const answer = (e: Entry) => new Response(e.body, { status: e.status, headers: { "content-type": e.type, "x-parachute-kept": String(e.at) } });
/** The read a request is, in this vault: its path and query (the host and the token aren't part of it). */
function keyOf(vault: string, input: RequestInfo | URL): string {
  const u = new URL(input instanceof Request ? input.url : String(input), "http://x");
  return `${vault} ${u.pathname}${u.search}`;
}
const methodOf = (input: RequestInfo | URL, init?: RequestInit) => (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

/** The hub's answer to a read, kept when it is one; whether it differs from what was kept. */
async function fromHub(vault: string, who: string, key: string, f: typeof fetch, input: RequestInfo | URL, init: RequestInit | undefined): Promise<{ res: Response; changed: boolean }> {
  const set = writes.get(vault) ?? 0;
  const res = await f(input, init);
  if (res.status !== 200 && res.status !== 404) return { res, changed: false };
  const body = await res.clone().text();
  // a write or a sign-out since this read set off: its answer may be from before it, so it isn't kept
  if ((writes.get(vault) ?? 0) !== set || body.length > ENTRY_MAX) return { res, changed: false };
  const was = mem.get(key) ?? null;
  const e: Entry = { vault, who, body, status: res.status, type: res.headers.get("content-type") ?? "application/json", at: Date.now() };
  remember(key, e);
  answered.set(key, e.at);
  void diskPut(key, e);
  return { res, changed: !!was && was.who === who && (was.body !== body || was.status !== res.status) };
}

/** Ask the hub behind a copy (at most once per REVALIDATE_MS for one read, unless asked again), and tell when its
 *  answer differs. A refused token is refreshed once (`signIn`, as the client does for its own calls): a sign-in the
 *  hub refuses drops the vault's copies, and the readers are told; no answer leaves the copy as it is. */
function revalidate(vault: string, who: string, key: string, f: typeof fetch, input: RequestInfo | URL, init: RequestInit | undefined, signIn: () => Promise<"alive" | "refused" | "unreachable">) {
  if (inflight.has(key)) return;
  const now = Date.now();
  if (!forced.delete(key) && (now - (asked.get(key) ?? 0) < REVALIDATE_MS || now - (answered.get(key) ?? 0) < REVALIDATE_MS)) return;
  asked.set(key, now);
  const refused = () => { void dropKept(vault); tell(vault, key); };
  const p = (async () => {
    let r = await fromHub(vault, who, key, f, input, init);
    if (r.res.status === 401 || r.res.status === 403) {
      void r.res.body?.cancel().catch(() => {});
      const state = await signIn();
      if (state === "refused") { refused(); return; }
      if (state !== "alive") return;
      // the chain sends it again with the token the refresh stored (client.ts withCurrentToken)
      r = await fromHub(vault, who, key, f, input, init);
      if (r.res.status === 401 || r.res.status === 403) { refused(); return; }
    }
    void r.res.body?.cancel().catch(() => {});
    if (r.changed) tell(vault, key);
  })().catch(() => { /* no answer: the copy stands */ }).finally(() => inflight.delete(key));
  inflight.set(key, p);
}

/**
 * A fetch for one vault (`vault`, the app's key for it; `who`, its hub) that answers a read it has a copy of at once,
 * from the copy, and asks the hub behind it. A read with no copy (or none since this session wrote to the vault) goes to
 * the hub, and is kept. Anything but a read goes as it is, and marks the vault written.
 */
export function keptFetch(vault: string, who: string, f: typeof fetch, signIn: () => Promise<"alive" | "refused" | "unreachable">): typeof fetch {
  return async (input, init) => {
    if (methodOf(input, init) !== "GET") { markWritten(vault); try { return await f(input, init); } finally { markWritten(vault); } }
    // a request the caller can stop: it waits for the hub, as before
    if (init?.signal) return f(input, init);
    const key = keyOf(vault, input);
    const e = mem.get(key) ?? await diskGet(key);
    if (e && e.vault === vault && e.who === who && e.at >= (writtenAt.get(vault) ?? 0)) {
      if (!mem.has(key)) remember(key, e);
      revalidate(vault, who, key, f, input, init, signIn);
      return answer(e);
    }
    asked.set(key, Date.now());
    return (await fromHub(vault, who, key, f, input, init)).res;
  };
}

/** A write to a vault (through any of the app's clients for it): what is read after it comes from the hub (this
 *  session), and a read on its way isn't kept. */
export function markWritten(vault: string): void {
  writes.set(vault, (writes.get(vault) ?? 0) + 1);
  writtenAt.set(vault, Date.now() + 1);
}
