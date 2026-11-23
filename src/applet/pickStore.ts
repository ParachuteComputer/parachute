// A pick kept on this device (docs/ACCESS.md proposal 5): on a device without the person's key (a browser tab), which
// can't sign one, the vaults an applet may reach are kept here, beside its Allow, for this device alone. A device that
// checks approvals never reads this: it reads the pick from the approval it checks. Keyed as approvals are (`dOf`).
import { parsePick, sortPick, type VaultRef } from "./vaultPick";

const PICKS_KEY = "parachute.picks.v1";
const store = () => (typeof localStorage === "undefined" ? null : localStorage);
const readAll = (): Record<string, unknown> => { try { const v = JSON.parse(store()?.getItem(PICKS_KEY) ?? "{}") as unknown; return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; } };
const listeners = new Set<() => void>();

/** The pick kept here for an applet, or null (none: the default). */
export const devicePick = (d: string): VaultRef[] | null => { const v = readAll()[d]; return v === undefined ? null : parsePick(v); };
/** Keep a pick here (null: forget it, back to the default). */
export function setDevicePick(d: string, pick: readonly VaultRef[] | null): void {
  const all = { ...readAll() };
  if (pick) all[d] = sortPick(pick); else delete all[d];
  try { store()?.setItem(PICKS_KEY, JSON.stringify(all)); } catch { /* this session */ }
  listeners.forEach((f) => f());
}
export const onDevicePick = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
