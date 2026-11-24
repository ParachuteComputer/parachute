// What a note link in an applet leads to, decided by the shell, which alone knows the person's vaults. The frame hands
// over the link as written (links/note.ts) and hears back only one word:
//   "note"  a note that is there, in a vault this device holds: a tap opens it in the app (open-with decides how)
//   "away"  a note's address on a hub or vault this device doesn't hold (or a note it can't find there): a tap shows
//           the link's screen, which says so and offers to add that Parachute (/open-link)
//   null    nothing to open: a vault name this device doesn't hold, a note that isn't there, or not a note link. Drawn
//           as plain text: no guess.
// A note named by its id in the applet's own vault, whose hub can't be asked now (off the tailnet, a phone just back on
// the network, a hub that doesn't answer in time), is "note" too: it may well be there, and its screen says so when it
// can't be read (T-476: Aaron's relay is public and his hub is on his tailnet, so his rooms came in before his hub could
// answer, and every `uni:` link in them stayed text). The applet knows its own vault already (`address`), so the answer
// tells it nothing new; any other vault that can't be asked stays nothing until asked again. A tap goes further: to a
// note in any vault held that can't be asked now (the shell goes there, in sight; the applet hears only true or false).
// Only a hub's own answer that the note isn't there is null.
// A short form or a wikilink is "note" only for a note that is there (or, in the applet's own vault, may be: above): the
// answer itself says a vault is held only to an applet that already knows a note's id in it, or its own. (How long an answer takes can still hint that a name is held: that is
// what `open`'s card line says it may learn.) Each link costs the same, whatever it names (shell/appDeps.ts). A wikilink
// names a path, which can be guessed, so it is looked up only in the folders the applet may read, and the note found
// must be in one of them and not an applet's code (the hub also matches a path's other case, or a title). A short form
// or an address counts only a note found by its own id, for the same reason, and an address whose note isn't a ULID (an
// older id, or a guessed path) is not looked up: it goes to the link's screen, as a vault not held does.
import { noteHref } from "../vault/notes";
import { originOf, vaultUrlOf, type VaultRecord } from "../vault/store";
import { ULID, noteAddress, parseNoteRef } from "./note";
import { linkFor } from "./parse";

export type Answer = "note" | "away" | null;
export type Found = { id: string; path: string; code: boolean };
export type Resolved = { answer: "note"; href: string } | { answer: "away"; href: string } | { answer: null };

export type ResolveDeps = {
  vaults(): readonly VaultRecord[];
  /** The applet's own vault: where a wikilink's note is. */
  here(): VaultRecord | null;
  /** Whether the applet may read notes at this path: a wikilink names a path, which anyone can guess, so it is looked
   *  up only where the applet could read it anyway. */
  mayRead(path: string): boolean;
  /** The note `idOrPath` names in `rec` (its id, its path, whether it is an applet's code) when `ok` takes it, else null.
   *  A note `ok` refuses is kept no longer than a miss, so how fast a later answer comes can't say it is there. Rejects
   *  when the vault couldn't be asked (the network, a hub that doesn't answer in time): not a miss. */
  find(rec: VaultRecord, idOrPath: string, ok: (f: Found) => boolean): Promise<Found | null>;
  /** Whether a note named by its id in `rec`, which couldn't be asked, still counts as there (its screen reads it
   *  again): the applet's own vault for what a link is drawn as, any vault held at a tap. None, if not said. */
  unreached?(rec: VaultRecord): boolean;
};

const bare = (u: string) => u.replace(/\/+$/, "");
/** Does `rec` hold the vault an address names: its hub's (`<origin>/vault/<name>`), or where a hosted vault lives. */
const holds = (rec: VaultRecord, origin: string, vault: string) =>
  rec.vault === vault && (originOf(rec.issuer) === origin || bare(vaultUrlOf(rec)) === `${origin}/vault/${encodeURIComponent(vault)}`);

/** The folders a wikilink's target may be in: as written (a path), then beside the note it is in. A target that could
 *  climb out of a folder (a `.` or `..` part, `//`, a backslash) is none: the folder check reads the path as written. */
export function wikiPaths(target: string, from?: string): string[] {
  const t = target.replace(/^\/+/, "");
  if (t.includes("\\") || t.includes("//") || t.split("/").some((part) => part === "." || part === "..")) return [];
  const folder = from && from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  return [...new Set([t, ...(folder && !t.startsWith(folder) ? [folder + t] : [])])].filter(Boolean);
}

export async function resolveLink(raw: string, from: string | undefined, d: ResolveDeps): Promise<Resolved> {
  const ref = parseNoteRef(raw);
  if (!ref) return { answer: null };
  // the vault that couldn't be asked, first: where a note named by its id may still be
  let unasked: VaultRecord | null = null;
  const first = async (recs: readonly VaultRecord[], idsOrPaths: string[], ok: (f: Found) => boolean = () => true): Promise<Resolved | null> => {
    for (const rec of recs) for (const p of idsOrPaths) {
      const f = await d.find(rec, p, ok).catch(() => { if (!unasked && d.unreached?.(rec)) unasked = rec; return null; });
      if (f && ok(f)) return { answer: "note", href: noteHref(rec.key, f.id) };
    }
    return null;
  };
  // a note named by its id in a held vault that couldn't be asked: its screen, which reads it again (a wikilink names a
  // path, which a guess could probe, so it stays nothing)
  const maybe = (note: string): Resolved | null => (unasked ? { answer: "note", href: noteHref((unasked as VaultRecord).key, note) } : null);
  if (ref.kind === "wiki") {
    const here = d.here();
    return (here && (await first([here], wikiPaths(ref.target, from).filter((p) => d.mayRead(p)), (f) => d.mayRead(f.path) && !f.code))) || { answer: null };
  }
  // a short form or an address names a note by its id: the hub also answers a path or a title there, which can be
  // guessed in any vault, so only a note whose id it is counts (else an address would map notes outside the grant)
  const byId = (f: Found) => f.id === ref.note;
  // and only an id as core makes them is asked for at all: any other word is a path or a title to the hub
  if (!ULID.test(ref.note)) return ref.kind === "short" ? { answer: null } : away(ref.issuer, ref.vault, ref.note);
  if (ref.kind === "short") return (await first(d.vaults().filter((r) => r.vault === ref.vault), [ref.note], byId)) || maybe(ref.note) || { answer: null };
  const held = d.vaults().filter((r) => holds(r, ref.issuer, ref.vault));
  return (await first(held, [ref.note], byId)) || maybe(ref.note) || away(ref.issuer, ref.vault, ref.note);
}
const away = (issuer: string, vault: string, note: string): Resolved =>
  ({ answer: "away", href: `/open-link?url=${encodeURIComponent(linkFor(`${issuer}/vault/${encodeURIComponent(vault)}`, note))}` });

/** A note's address in a vault, for an applet writing a link to one of its notes. */
export const addressIn = (rec: VaultRecord, note: string) => noteAddress(vaultUrlOf(rec), note);
