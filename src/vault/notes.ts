// A note as the vault view shows it. Pure.
import { POINTER_TAG } from "../applet/pointer";
import type { Note } from "@openparachute/surface-client";
import { isCodeExtension } from "../applet/code";

/** A journal entry's path, as Journal (and the Uni app) files it: Journal/2026/11-21/07-15 Walked to the bakery (or
 *  under Notes/, as the Uni app once did); the seconds when the minute was taken (07-15-42), and a number when that
 *  second was too (07-15-42-2). */
const JOURNAL_ENTRY = /^(?:Journal|Notes)\/\d{4}\/\d{2}-\d{2}\/(\d{2})-(\d{2})(?:-\d{2}(?:-\d+)?)? ([^/]+)$/;
/** A path's last segment that is an id, not a name: a ULID, a UUID, a long run of hex. */
export const ID_LIKE = /^(?:[0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i;
/** What a title can be made of, past the path: the record's words, its types, when it was made. */
export type Titled = Pick<Note, "id" | "path"> & { content?: string | null; body?: string | null;
  /** what a list read carries in place of the words: the hub's first line (`displayTitle`), its one-line preview */
  displayTitle?: string | null; preview?: string | null; types?: readonly string[] | null; tags?: readonly string[] | null; createdAt?: string | null; updatedAt?: string | null };

/** The last segment of the note's path, without an extension (a journal entry's without its time: the folder and the
 *  list say when). A record with no name of its own (no path, or a path that ends in an id, as an AI or the app may
 *  write one) is called by its type and first words, else by its kind and date: never by its id. */
export function titleOf(n: Titled): string {
  const p = n.path?.replace(/\.(md|html?|tsx|jsx)$/i, "") ?? "";
  const entry = JOURNAL_ENTRY.exec(p)?.[3]?.trim();
  if (entry) return entry;
  const last = p.split("/").filter(Boolean).pop();
  return last && last !== n.id && !ID_LIKE.test(last) ? last : unnamedTitle(n, p);
}

/** A title from the record's name and dates alone, never its words: for what may see titles but not text (`app.recent`,
 *  whose card says "the titles of the newest notes"). A record named by its id is "A note from Nov 21, 2026". */
export const titleOnly = (n: Titled): string => titleOf({ id: n.id, path: n.path, createdAt: n.createdAt ?? null, updatedAt: n.updatedAt ?? null });

/** The first line of a record's words that says something, without its markdown, cut on a word: "" when none does
 *  (an empty record, or data such as JSON). */
export function firstWords(text: string | null | undefined, max = 60): string {
  const body = (text ?? "").replace(/^---\n[\s\S]*?\n---\n/, "");
  for (const raw of body.split("\n")) {
    const line = raw.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a).replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();
    if (!/\p{L}/u.test(line) || /^[\[{]/.test(line)) continue;
    if (line.length <= max) return line.replace(/(?<!\.)\.$/, "");
    const cut = line.slice(0, max);
    return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : max).replace(/[\s,;:.]+$/, "")}…`;
  }
  return "";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A day as a person says it ("Nov 21, 2026"); "" for no date. */
export const dayOf = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };

function unnamedTitle(n: Titled, path: string): string {
  // the app's own folders (Parachute/Approvals/…): the kind of thing it keeps, one of them
  const own = /^\.?parachute\/(?!from\/)([^/]+)\//i.exec(path)?.[1];
  if (own) return cap(own.replace(/ies$/i, "y").replace(/s$/i, "").replace(/[-_]/g, " "));
  const type = n.types?.find((t) => t.trim());
  const kind = type ? cap(type.replace(/[-_]/g, " ")) : null;
  // the first of these that says something: an empty body leaves the hub's first line and preview to try
  const words = [n.content, n.body, n.displayTitle, n.preview].map((t) => firstWords(t)).find(Boolean) ?? "";
  if (words) return kind ? `${kind}: ${words}` : words;
  const day = dayOf(n.createdAt ?? n.updatedAt);
  return day ? `${kind ?? "A note"} from ${day}` : kind ? `A ${kind.toLowerCase()} with no name` : "A note with no name";
}
/** When a journal entry was written, from its path ("07:15"); null for any other note. A list beside titleOf says it,
 *  so two entries of a day with the same words stay apart. */
export function entryTime(n: Pick<Note, "path">): string | null {
  const m = JOURNAL_ENTRY.exec(n.path?.replace(/\.md$/i, "") ?? "");
  return m ? `${m[1]}:${m[2]}` : null;
}
/** The folder a note sits in, "" at the top. */
export function folderOf(n: Pick<Note, "path">): string {
  const p = n.path ?? "";
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "";
}
/** An applet's own note, or any code note (HTML, TSX, JSX): shown as text, never run, in the vault view. */
export const isCodeNote = (n: { path?: string | null; tags?: readonly string[] | null; extension?: string | null }) =>
  isCodeExtension(n) || (n.tags ?? []).includes("applet");

/** The tags of the records the app keeps for itself (homeSettings.ts, bundles.ts and its older tag, frameSource.ts,
 *  theme/store.ts, applet/pointer.ts, approvals.ts, the keyring's, receipts, saved views): exactly these, so a person's
 *  own `parachute-jumps` stays theirs. */
const APP_TAGS = new Set(["parachute-settings", "parachute-bundle", "parachute-app", "parachute-frame", "parachute-theme", POINTER_TAG,
  "parachute-approval", "parachute-keys", "parachute-receipt", "parachute-view"]);
/** The records the app keeps for itself: anything carrying one of its own tags, and what sits in its folders
 *  (`Parachute/…`, the vault's system space `.parachute/`). A person's own note under `Parachute/From/` (where the
 *  pointers to another Parachute's things live) is theirs, and shows. */
export const isHousekeeping = (n: { path?: string | null; tags?: readonly string[] | null }) =>
  (n.tags ?? []).some((t) => APP_TAGS.has(t))
  || /^\.parachute\//i.test(n.path ?? "") || (/^parachute\//i.test(n.path ?? "") && !/^parachute\/from\//i.test(n.path ?? ""));

/** Notes that are the app's own: its housekeeping, and an applet's or a component's code. Never among what the person
 *  wrote lately (the launcher, `app.recent`, Vault's Lately and search). */
export const isAppOwn = (n: { path?: string | null; tags?: readonly string[] | null; extension?: string | null }) =>
  isCodeExtension(n) || (n.tags ?? []).some((t) => t === "applet" || t.startsWith("applet/") || t === "component" || t.startsWith("component/")) || isHousekeeping(n);

/** The app's own address for a note in a vault. */
export const noteHref = (vaultKey: string, idOrPath: string) => `/v/${encodeURIComponent(vaultKey)}/n/${encodeURIComponent(idOrPath)}`;

/** Only a path on this app (one slash, then not a second slash or backslash) stays in the app; anything else opens outside it. */
export const isAppPath = (href: string) => /^\/(?![\/\\])/.test(href);
