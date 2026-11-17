// Whose a vault is (docs/design/EMBED.md): mine, someone else's, or someone else's that the person trusts. One value per
// vault (its hub's origin and its name), chosen by the person on the app's own screens (Add a vault asks; Settings
// changes it) and kept on this device apart from the sign-in, so signing in again keeps it. No record or agent sets it.
//
//   mine      its applets may ask the app for things (recent, pins, open) and host embeds; it can be the home
//   trusted   someone else's, whose components may be imported into the person's applets
//   theirs    someone else's: embed only; the default for any vault the person hasn't said is theirs
//
// Vaults this device held before this existed: the one that was its home (the person's choice, else the first added)
// is mine; the others are someone else's until the person answers Settings' "Are these yours?".
import { useSyncExternalStore } from "react";
import { listVaults, subscribeVaults, touchVaults, type VaultRecord } from "./store";

export type Whose = "mine" | "theirs" | "trusted";
export const WHOSE_KEY = "parachute.whose.v1";
/** The person's choice of home vault (Settings), by this device's key for it. */
export const HOME_KEY = "parachute.home.v1";
type Stored = { whose: Record<string, Whose>; ask: string[] };
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const originOf = (issuer: string) => { try { return new URL(issuer).origin; } catch { return issuer; } };
/** What a vault's value is kept under: its hub's origin and its name. */
export const whoseKey = (r: Pick<VaultRecord, "issuer" | "vault">) => `${originOf(r.issuer)} ${r.vault}`;
const WORDS: readonly Whose[] = ["mine", "theirs", "trusted"];

const storage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);
let cache: { raw: string | null; stored: Stored } | null = null;
const listeners = new Set<() => void>();

/** The vaults held before this existed: the old home is mine, the others are asked about. */
function migrate(list: readonly VaultRecord[], s: StorageLike | null): Stored {
  if (!list.length) return { whose: {}, ask: [] };
  let chosen: string | null = null;
  try { chosen = s?.getItem(HOME_KEY) ?? null; } catch { chosen = null; }
  const home = list.find((v) => v.key === chosen) ?? [...list].sort((a, b) => a.addedAt.localeCompare(b.addedAt))[0];
  const whose: Record<string, Whose> = {};
  const ask: string[] = [];
  for (const v of list) { const k = whoseKey(v); if (v.key === home.key) whose[k] = "mine"; else { whose[k] = "theirs"; ask.push(k); } }
  return { whose, ask };
}

function read(s: StorageLike | null = storage()): Stored {
  let raw: string | null = null;
  try { raw = s?.getItem(WHOSE_KEY) ?? null; } catch { raw = null; }
  if (cache && cache.raw === raw) return cache.stored;
  let stored: Stored;
  if (raw === null) {
    stored = migrate(listVaults(), s);
    const out = JSON.stringify(stored);
    try { s?.setItem(WHOSE_KEY, out); } catch { /* this session only */ }
    cache = { raw: out, stored };
    return stored;
  }
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    const whose: Record<string, Whose> = {};
    if (v && typeof v.whose === "object" && v.whose) for (const [k, w] of Object.entries(v.whose)) if (WORDS.includes(w as Whose)) whose[k] = w as Whose;
    stored = { whose, ask: Array.isArray(v?.ask) ? v.ask.filter((k): k is string => typeof k === "string") : [] };
  } catch { stored = { whose: {}, ask: [] }; }
  cache = { raw, stored };
  return stored;
}
function write(stored: Stored, s: StorageLike | null = storage()) {
  const raw = JSON.stringify(stored);
  try { s?.setItem(WHOSE_KEY, raw); } catch { /* this session only */ }
  cache = { raw, stored };
  listeners.forEach((f) => f());
  // the home vault and what each vault may do follow from this: everything that follows the vaults looks again
  touchVaults();
}

/** Whose this vault is. A vault no one said anything about is someone else's. */
export const whoseOf = (r: Pick<VaultRecord, "issuer" | "vault">): Whose => read().whose[whoseKey(r)] ?? "theirs";
export const isMine = (r: Pick<VaultRecord, "issuer" | "vault">) => whoseOf(r) === "mine";
/** May an applet import a component from this vault (its own vault always may)? */
export const importable = (r: Pick<VaultRecord, "issuer" | "vault">) => whoseOf(r) !== "theirs";
/** The person said whose it is (a tap on Add a vault or in Settings). */
export function setWhose(r: Pick<VaultRecord, "issuer" | "vault">, w: Whose) {
  const s = read(), k = whoseKey(r);
  write({ whose: { ...s.whose, [k]: w }, ask: s.ask.filter((x) => x !== k) });
}
/** The vaults Settings asks about: held before this existed, and not answered yet. */
export const askedAbout = (list: readonly VaultRecord[] = listVaults()) => { const ask = read().ask; return list.filter((v) => ask.includes(whoseKey(v))); };

export function subscribeWhose(f: () => void): () => void {
  listeners.add(f);
  const onStorage = (e: StorageEvent) => { if (!e.key || e.key === WHOSE_KEY) { cache = null; f(); } };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => { listeners.delete(f); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
}
/** Re-render on any change of whose a vault is (and of the vaults held). */
export function useWhose(): (r: Pick<VaultRecord, "issuer" | "vault">) => Whose {
  useSyncExternalStore((f) => { const a = subscribeWhose(f), b = subscribeVaults(f); return () => { a(); b(); }; }, () => cache?.raw ?? "");
  return whoseOf;
}
/** For tests: forget what was read. */
export const forgetWhoseCache = () => { cache = null; };
