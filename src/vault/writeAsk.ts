// A change the app can't make yet (docs/design/SCOPES.md): this device holds only read of the vault. Refused before it
// is sent, and whoever shows the ask (shell/WriteAsk.tsx) is told. A leaf: the vault client imports it.
import { covers, levelIn } from "./parachute";
import { findVault, originOf, type VaultRecord } from "./store";

/** A change refused before it was sent: this device holds only read of the vault. */
export class NeedsWriteError extends Error {
  constructor(public vault: string, public key: string) { super(`Parachute can only read ${vault}. Changing notes there needs your OK on your hub.`); this.name = "NeedsWriteError"; }
}
/** Is this failure the refusal of a change in `vault` (as thrown, or as the vault client wraps it: "POST … failed: …")? */
export function isWriteRefusal(e: unknown, vault: string): boolean {
  if (e instanceof NeedsWriteError) return e.vault === vault;
  const said = new NeedsWriteError(vault, "").message;
  return e instanceof Error && (e.message === said || e.message.endsWith(`failed: ${said}`));
}
const asks = new Set<(key: string) => void>();
let lastAsk: string | null = null;
/** A screen that shows the ask (shell/WriteAsk.tsx) listens here. */
export function onWriteAsk(f: (key: string) => void): () => void { asks.add(f); return () => { asks.delete(f); }; }
export const pendingWriteAsk = () => lastAsk;
export const clearWriteAsk = () => { lastAsk = null; };
/** A change to `key`'s vault needs write: say so to whoever shows the ask, and refuse the change. */
export function needWrite(key: string): never {
  const rec = findVault(key);
  lastAsk = key;
  asks.forEach((f) => { try { f(key); } catch { /* one listener's failure is its own */ } });
  throw new NeedsWriteError(rec?.vault ?? key, key);
}
/** Does this device hold write of the vault? */
export const canWrite = (key: string) => { const r = findVault(key); return !!r && covers(levelIn(r.scope, r.vault), "write"); };


// the vaults where the person themselves let Parachute change notes (a note, their settings): kept, so a revoked
// applet doesn't take that write away from them (vault/reach.ts)
const OWN_KEY = "parachute.reach.own-writes.v1";
const ownKey = (r: Pick<VaultRecord, "issuer" | "vault">) => `${originOf(r.issuer)} ${r.vault}`;
const ownWrites = (): string[] => { try { const v = JSON.parse(localStorage.getItem(OWN_KEY) ?? "[]") as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-500) : []; } catch { return []; } };
const setOwn = (l: string[]) => { try { localStorage.setItem(OWN_KEY, JSON.stringify(l)); } catch { /* this session */ } };
/** The person let Parachute change notes in this vault themselves (a note, their settings). */
export function noteOwnWrite(r: Pick<VaultRecord, "issuer" | "vault">) { const k = ownKey(r); if (!ownWrites().includes(k)) setOwn([...ownWrites(), k]); }
/** They took that back (Settings: read only). */
export function forgetOwnWrite(r: Pick<VaultRecord, "issuer" | "vault">) { setOwn(ownWrites().filter((k) => k !== ownKey(r))); }
export const ownWrite = (r: Pick<VaultRecord, "issuer" | "vault">) => ownWrites().includes(ownKey(r));


/** The editor's words while the app is away at the hub's write ask (views/NoteEdit.tsx): the editor's draft key
 *  (`DRAFT_LATEST`, kept as the person types) and the one to bring back (`DRAFT_RETURN`, set when the ask leaves). */
export const DRAFT_LATEST = "parachute.draft.latest.v1";
export const DRAFT_RETURN = "parachute.draft.return.v1";
/** Leaving for the hub from an editor: its words come back on the return. */
export function markDraftReturn(onEditor: boolean) {
  try { const k = sessionStorage.getItem(DRAFT_LATEST); if (onEditor && k) sessionStorage.setItem(DRAFT_RETURN, k); else sessionStorage.removeItem(DRAFT_RETURN); } catch { /* the words are typed again */ }
}
