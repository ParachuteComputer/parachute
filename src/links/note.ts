// Note links: the one parser and the one builder, shared by the shell (which resolves and opens them) and the kit's
// parts (which find and draw them in an applet's frame). Pure.
//
// The one form written and stored: a note's own address on its hub, which the hub serves (core 0.8 and 0.9,
// `/vault/<name>/view/<idOrPath>`: the note as a page, for anyone when it is published, else with a key):
//   https://<hub>/vault/<vault>/view/<id>
// Read, never written by applets:
//   <vault>:<ULID>             a vault of the person's by its name, and a note's id (`uni:01K…` as Uni writes in chat)
//   [[Path or Title]]          inside a note: a note in the same vault (resolved by the shell)
//   https://<hub>[/surface/<name> | /app]/v/<vault>/n/<id>    the address Parachute's web app shows for a note
// What a link names is only a candidate: the shell opens it only when it holds that vault (links/resolve.ts).
import { isLoopback, VAULT_NAME } from "../vault/address";

/** A note's id as core makes it now: a ULID (26 Crockford base-32 characters). Older ids parse in an address, but the app
 *  doesn't look them up (links/resolve.ts): such a link goes to its screen. */
export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const NOTE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_LINK = 2000;
export const MAX_WIKI = 512;

export type NoteRef =
  /** a note's address on a hub: `issuer` is the address's origin */
  | { kind: "address"; issuer: string; vault: string; note: string }
  | { kind: "short"; vault: string; note: string }
  | { kind: "wiki"; target: string };

/** The one form a link to a note is written in: its address on the hub that holds its vault. `vaultUrl` is the vault's
 *  own root (`<hub>/vault/<name>`, or where a hosted vault lives). */
export function noteAddress(vaultUrl: string, note: string): string {
  return `${vaultUrl.replace(/\/+$/, "")}/view/${encodeURIComponent(note)}`;
}

export type Address = { ok: true; issuer: string; vault: string; note: string } | { ok: false; reason: string };

/** A note's web address: the canonical form, or the address Parachute's web app shows. */
export function parseNoteAddress(address: string): Address {
  let u: URL;
  try { u = new URL(address); } catch { return { ok: false, reason: "The address inside the link can't be read." }; }
  if (u.username || u.password) return { ok: false, reason: "The address inside the link carries a name and password." };
  if (!(u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname)))) return { ok: false, reason: "The address inside the link isn't a secure web address." };
  const m = u.pathname.match(/^\/vault\/([^/]+)\/view\/([^/]+)\/?$/) ?? u.pathname.match(/^(?:\/surface\/[a-z0-9][a-z0-9_-]*|\/app)?\/v\/([^/]+)\/n\/([^/]+)\/?$/);
  if (!m) return { ok: false, reason: "The address inside the link isn't a note's address." };
  let vault: string, note: string;
  try { vault = decodeURIComponent(m[1]); note = decodeURIComponent(m[2]); } catch { return { ok: false, reason: "The address inside the link can't be read." }; }
  if (!VAULT_NAME.test(vault) || !NOTE.test(note)) return { ok: false, reason: "The address inside the link isn't a note's address." };
  return { ok: true, issuer: u.origin, vault, note };
}

/** What a link names, read from it as written: an address, `<vault>:<ULID>` or `[[target]]`; null for anything else. */
export function parseNoteRef(raw: string): NoteRef | null {
  if (typeof raw !== "string" || !raw || raw.length > MAX_LINK) return null;
  const s = raw.trim();
  const wiki = /^\[\[([^\]\n]+)\]\]$/.exec(s);
  if (wiki) {
    // [[Path#Heading|Shown as]]: the note is the path
    const target = wiki[1].split("|")[0].split("#")[0].trim();
    return target && target.length <= MAX_WIKI ? { kind: "wiki", target } : null;
  }
  const short = /^([a-z0-9][a-z0-9_-]{0,63}):([0-9A-HJKMNP-TV-Z]{26})$/.exec(s);
  if (short) return { kind: "short", vault: short[1], note: short[2] };
  if (!/^https?:\/\//i.test(s)) return null;
  const a = parseNoteAddress(s);
  return a.ok ? { kind: "address", issuer: a.issuer, vault: a.vault, note: a.note } : null;
}

export type Found = { start: number; end: number; raw: string; ref: NoteRef | null };

// a web address in running text (its trailing punctuation is the sentence's), and the short form, standing alone (not
// inside an address, a mail address or a link's label)
const IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+|(?<![\w:/.@\[-])[a-z0-9][a-z0-9_-]{0,63}:[0-9A-HJKMNP-TV-Z]{26}(?![\w])/g;

/** The links in plain text, in order: each web address (`ref` set when it is a note's) and each `<vault>:<ULID>`.
 *  Wikilinks are a note's, not text's. */
export function findLinks(text: string): Found[] {
  if (typeof text !== "string" || !text) return [];
  const out: Found[] = [];
  for (const m of text.matchAll(IN_TEXT)) {
    let raw = m[0];
    if (/^https?:/i.test(raw)) {
      // a closing bracket stays only when the address opened one
      while (/[.,;:!?*_~'"]$/.test(raw) || (/[)\]]$/.test(raw) && count(raw, raw.endsWith(")") ? "(" : "[") < count(raw, raw.slice(-1)))) raw = raw.slice(0, -1);
    }
    out.push({ start: m.index!, end: m.index! + raw.length, raw, ref: parseNoteRef(raw) });
  }
  return out;
}
const count = (s: string, c: string) => s.split(c).length - 1;

/** Only the note links in plain text. */
export const findNoteRefs = (text: string): (Found & { ref: NoteRef })[] => findLinks(text).filter((f): f is Found & { ref: NoteRef } => f.ref !== null);

/** Most links one `app.links` call takes. Each costs the applet two vault reads, whatever it names (shell/appDeps.ts),
 *  and a frame has 60 reads in ten seconds (applet/contract.ts): 20 fit with room for the applet's own reads. */
export const LINKS_PER_CALL = 20;
