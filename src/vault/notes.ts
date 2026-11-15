// A note as the vault view shows it. Pure.
import type { Note } from "@openparachute/surface-client";
import { isCodeExtension } from "../applet/code";

/** The last segment of the note's path, without an extension; else its id. */
export function titleOf(n: Pick<Note, "id" | "path">): string {
  const p = n.path?.replace(/\.(md|html?|tsx|jsx)$/i, "") ?? "";
  const last = p.split("/").filter(Boolean).pop();
  return last || n.id;
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

/** The app's own address for a note in a vault. */
export const noteHref = (vaultKey: string, idOrPath: string) => `/v/${encodeURIComponent(vaultKey)}/n/${encodeURIComponent(idOrPath)}`;

/** Only a path on this app (one slash, then not a second slash or backslash) stays in the app; anything else opens outside it. */
export const isAppPath = (href: string) => /^\/(?![\/\\])/.test(href);
