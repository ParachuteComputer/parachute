// What a note link in an applet leads to, decided by the shell, which alone knows the person's vaults. The frame hands
// over the link as written (links/note.ts) and hears back only one word:
//   "note"  a note that is there, in a vault this device holds: a tap opens it in the app (open-with decides how)
//   "away"  a note's address on a hub or vault this device doesn't hold (or a note it can't find there): a tap shows
//           the link's screen, which says so and offers to add that Parachute (/open-link)
//   null    nothing to open: a vault name this device doesn't hold, a note that isn't there, or not a note link. Drawn
//           as plain text: no guess.
// A short form or a wikilink is "note" only for a note that is there, so an applet can't learn which vaults the person
// holds by asking about names: it learns a vault is held only when it already knows a note's id in it. A wikilink names
// a path, which can be guessed, so it is looked up only in the folders the applet may read.
import { noteHref } from "../vault/notes";
import { originOf, vaultUrlOf, type VaultRecord } from "../vault/store";
import { noteAddress, parseNoteRef } from "./note";
import { linkFor } from "./parse";

export type Answer = "note" | "away" | null;
export type Resolved = { answer: "note"; href: string } | { answer: "away"; href: string } | { answer: null };

export type ResolveDeps = {
  vaults(): readonly VaultRecord[];
  /** The applet's own vault: where a wikilink's note is. */
  here(): VaultRecord | null;
  /** Whether the applet may read notes at this path: a wikilink names a path, which anyone can guess, so it is looked
   *  up only where the applet could read it anyway. */
  mayRead(path: string): boolean;
  /** The note's id when `idOrPath` names a note in `rec`, else null. */
  find(rec: VaultRecord, idOrPath: string): Promise<string | null>;
};

const bare = (u: string) => u.replace(/\/+$/, "");
/** Does `rec` hold the vault an address names: its hub's (`<origin>/vault/<name>`), or where a hosted vault lives. */
const holds = (rec: VaultRecord, origin: string, vault: string) =>
  rec.vault === vault && (originOf(rec.issuer) === origin || bare(vaultUrlOf(rec)) === `${origin}/vault/${encodeURIComponent(vault)}`);

/** The folders a wikilink's target may be in: as written (a path), then beside the note it is in. */
export function wikiPaths(target: string, from?: string): string[] {
  const t = target.replace(/^\/+/, "");
  const folder = from && from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  return [...new Set([t, ...(folder && !t.startsWith(folder) ? [folder + t] : [])])].filter(Boolean);
}

export async function resolveLink(raw: string, from: string | undefined, d: ResolveDeps): Promise<Resolved> {
  const ref = parseNoteRef(raw);
  if (!ref) return { answer: null };
  const first = async (recs: readonly VaultRecord[], idsOrPaths: string[]): Promise<Resolved | null> => {
    for (const rec of recs) for (const p of idsOrPaths) {
      const id = await d.find(rec, p).catch(() => null);
      if (id) return { answer: "note", href: noteHref(rec.key, id) };
    }
    return null;
  };
  if (ref.kind === "wiki") {
    const here = d.here();
    return (here && (await first([here], wikiPaths(ref.target, from).filter((p) => d.mayRead(p))))) || { answer: null };
  }
  if (ref.kind === "short") return (await first(d.vaults().filter((r) => r.vault === ref.vault), [ref.note])) || { answer: null };
  const held = d.vaults().filter((r) => holds(r, ref.issuer, ref.vault));
  return (await first(held, [ref.note])) || { answer: "away", href: `/open-link?url=${encodeURIComponent(linkFor(`${ref.issuer}/vault/${encodeURIComponent(ref.vault)}`, ref.note))}` };
}

/** A note's address in a vault, for an applet writing a link to one of its notes. */
export const addressIn = (rec: VaultRecord, note: string) => noteAddress(vaultUrlOf(rec), note);
