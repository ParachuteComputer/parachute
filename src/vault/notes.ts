// A note as the vault view shows it. Pure.
import { POINTER_TAG } from "../applet/pointer";
import type { Note } from "@openparachute/surface-client";
import { isCodeExtension } from "../applet/code";

/** A journal entry's path, as Journal (and the Uni app) files it: Journal/2026/11-21/07-15 Walked to the bakery (or
 *  under Notes/, as the Uni app once did); the seconds when the minute was taken (07-15-42), and a number when that
 *  second was too (07-15-42-2). */
const JOURNAL_ENTRY = /^(?:Journal|Notes)\/\d{4}\/\d{2}-\d{2}\/(\d{2})-(\d{2})(?:-\d{2}(?:-\d+)?)? ([^/]+)$/;
/** The last segment of the note's path, without an extension (a journal entry's without its time: the folder and the
 *  list say when); else its id. */
export function titleOf(n: Pick<Note, "id" | "path">): string {
  const p = n.path?.replace(/\.(md|html?|tsx|jsx)$/i, "") ?? "";
  const entry = JOURNAL_ENTRY.exec(p)?.[3]?.trim();
  if (entry) return entry;
  const last = p.split("/").filter(Boolean).pop();
  return last || n.id;
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

/** The tags of the app's own records (homeSettings.ts, bundles.ts and its older tag, frameSource.ts, theme/store.ts,
 *  applet/pointer.ts). */
const APP_TAGS = ["parachute-settings", "parachute-bundle", "parachute-app", "parachute-frame", "parachute-theme", POINTER_TAG];
/** Notes that are the app's own (its settings, bundle, frame, theme and pointer records, by their tags; the vault's system space,
 *  .parachute/) or an applet's code: never among what the person wrote lately (the launcher, `app.recent`). A person's
 *  own folder named Parachute/ is theirs, and shows. */
export const isAppOwn = (n: { path?: string | null; tags?: readonly string[] | null; extension?: string | null }) =>
  isCodeExtension(n) || (n.tags ?? []).some((t) => t === "applet" || t.startsWith("applet/") || APP_TAGS.includes(t))
  || /^\.parachute\//i.test(n.path ?? "");

/** The app's own address for a note in a vault. */
export const noteHref = (vaultKey: string, idOrPath: string) => `/v/${encodeURIComponent(vaultKey)}/n/${encodeURIComponent(idOrPath)}`;

/** Only a path on this app (one slash, then not a second slash or backslash) stays in the app; anything else opens outside it. */
export const isAppPath = (href: string) => /^\/(?![\/\\])/.test(href);
