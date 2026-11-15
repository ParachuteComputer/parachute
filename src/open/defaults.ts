// "Always": which applet opens a type in a vault, kept on this device, on the person's side: never in a note, never in
// the applet, never in the vault. Per vault (this device's key for it) and type: an applet's note id, or "vault" for the
// plain vault view.
export const DEFAULTS_KEY = "parachute.openwith.v1";
export type Choice = string; // an applet's note id, or VAULT
export const VAULT = "vault";
type Store = Record<string, Record<string, Choice>>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const listeners = new Set<() => void>();
const storage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);
let raw: string | null | undefined;
let cache: Store = {};

function read(): Store {
  let r: string | null = null;
  try { r = storage()?.getItem(DEFAULTS_KEY) ?? null; } catch { r = null; }
  if (r === raw) return cache;
  raw = r;
  cache = {};
  try {
    const v: unknown = JSON.parse(r ?? "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) for (const [vault, m] of Object.entries(v as Record<string, unknown>)) {
      if (!m || typeof m !== "object") continue;
      const types: Record<string, Choice> = {};
      for (const [t, c] of Object.entries(m as Record<string, unknown>)) if (typeof c === "string" && c) types[t] = c;
      cache[vault] = types;
    }
  } catch { cache = {}; }
  return cache;
}
function write(next: Store) {
  try { storage()?.setItem(DEFAULTS_KEY, JSON.stringify(next)); } catch { /* this session only */ }
  raw = undefined;
  listeners.forEach((f) => f());
}

export const defaultsFor = (vault: string): Record<string, Choice> => read()[vault] ?? {};
export function setDefault(vault: string, type: string, choice: Choice) { const s = read(); write({ ...s, [vault]: { ...(s[vault] ?? {}), [type]: choice } }); }
export function clearDefault(vault: string, type: string) { const s = read(); const m = { ...(s[vault] ?? {}) }; delete m[type]; write({ ...s, [vault]: m }); }
export const allDefaults = (): Store => read();
/** Signing out of a vault forgets its choices on this device too. */
export function clearDefaults(vault: string) { const s = { ...read() }; delete s[vault]; write(s); }
export function subscribeDefaults(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); }
