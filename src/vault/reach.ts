// What the app holds of each vault at its hub, and why (docs/design/SCOPES.md). The app never holds more of a vault than
// the most that something the person allowed needs:
//   read    the home, read at sign-in; a vault the person opened (the launcher's Open); every vault held at all
//   write   an applet allowed there whose manifest adds or changes notes (manifest `allow` verbs create, update); or a
//           change the person made there themselves and approved on the hub (a note edited, their settings saved)
// The hub narrows no further than a vault and a verb: the folders an applet's card names are the app's own rule.
// Asking for more is one consent for one vault on the hub (signInFlow.ts askVault). When an applet is revoked and nothing
// left needs write, the app asks again for read alone (the hub answers at once: its grant covers it) and ends the
// token that could write, so the hub holds no live token that can.
import type { Manifest } from "../applet/manifest";
import { deviceGrants, subjectOf } from "../applet/grants";
import { appletsNow } from "../applet/useApplets";
import { askVault } from "./signInFlow";
import { levelIn, type Level } from "./parachute";
import { findVault, listVaults, type VaultRecord } from "./store";
export { canWrite, clearWriteAsk, forgetOwnWrite, needWrite, NeedsWriteError, noteOwnWrite, onWriteAsk, ownWrite, pendingWriteAsk } from "./writeAsk";
import { ownWrite } from "./writeAsk";

/** What an applet needs of its vault at the hub: write when its manifest adds or changes notes, else read. */
export const appletLevel = (m: Pick<Manifest, "allow">): Level => (m.allow.some((r) => r.verbs.some((v) => v !== "read")) ? "write" : "read");

/** What this device holds of a vault now (the hub's word, its token's scope). */
export const heldLevel = (rec: Pick<VaultRecord, "scope" | "vault">): Level | null => levelIn(rec.scope, rec.vault);

/** The applets allowed on this device in a vault that need write there. Unknown when the vault's applets haven't been
 *  read this session (null): then nothing is narrowed. */
export function appletsNeedingWrite(rec: VaultRecord): string[] | null {
  const read = appletsNow(rec.key);
  const allowed = deviceGrants().subjects().filter((s) => s.startsWith(subjectOf(rec.key, "")));
  if (!allowed.length) return [];
  if (read?.state !== "ok") return null;
  const out: string[] = [];
  for (const s of allowed) {
    const e = read.found.entries.find((x) => subjectOf(rec.key, x.noteId) === s);
    // one made for a newer app (level.ts): what it needs isn't read here, so nothing is narrowed
    if (e?.newer) return null;
    // an allowed applet the list no longer shows (deleted, or renamed past its id): not counted
    if (e && appletLevel(e.manifest) === "write" && deviceGrants().status(s, e.keys.scope, e.keys.html) !== "none") out.push(e.manifest.name);
  }
  return out;
}

/** The most anything allowed needs of a vault now: write, read, or unknown (null: don't narrow). */
export function neededLevel(rec: VaultRecord): Level | null {
  if (ownWrite(rec)) return "write";
  const applets = appletsNeedingWrite(rec);
  if (applets === null) return null;
  return applets.length ? "write" : "read";
}

/** After a revoke (an applet, or the person's own write): when the vault is held wider than anything allowed needs,
 *  the address that asks the hub for read alone (no page: its grant covers it), coming back to `back`. Null when
 *  nothing is to be given back. */
export async function narrowIfWider(key: string, back: string): Promise<string | null> {
  const rec = findVault(key);
  if (!rec) return null;
  const need = neededLevel(rec);
  if (need !== "read" || heldLevel(rec) !== "write") return null;
  return askVault(rec, "read", "narrow", back);
}

/** Give back what nothing allowed needs any more: when the vault is held wider, go to the hub to hold less (it answers
 *  at once), and come back to `back`. */
export async function giveBack(key: string, back: string): Promise<void> {
  const url = await narrowIfWider(key, back).catch(() => null);
  if (url) window.location.assign(url);
}

// ── asking for write, for a change the person makes ──

/** Ask the hub for write in a vault, for the person's own change, coming back to `back`. */
export async function askOwnWrite(key: string, back: string): Promise<string> {
  const rec = findVault(key);
  if (!rec) throw new Error("That vault isn't on this device.");
  return askVault(rec, "write", "write", back);
}

/** Every vault held, with what it holds, for Settings. */
export const heldNow = () => listVaults().map((v) => ({ v, level: heldLevel(v) }));
