// A note as the vault view shows it. Pure.
import type { Note } from "@openparachute/surface-client";

/** The last segment of the note's path, without an extension; else its id. */
export function titleOf(n: Pick<Note, "id" | "path">): string {
  const p = n.path?.replace(/\.(md|html?)$/i, "") ?? "";
  const last = p.split("/").filter(Boolean).pop();
  return last || n.id;
}
/** The folder a note sits in, "" at the top. */
export function folderOf(n: Pick<Note, "path">): string {
  const p = n.path ?? "";
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "";
}
/** An applet's own note, or any HTML note: shown as text, never run, in the vault view. */
export const isCodeNote = (n: Pick<Note, "path" | "tags"> & { extension?: string | null }) =>
  /\.html?$/i.test(n.path ?? "") || String(n.extension ?? "").replace(/^\./, "").toLowerCase() === "html" || (n.tags ?? []).includes("applet");

/** The app's own address for a note in a vault. */
export const noteHref = (vaultKey: string, idOrPath: string) => `/v/${encodeURIComponent(vaultKey)}/n/${encodeURIComponent(idOrPath)}`;
