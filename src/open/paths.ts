// The app's addresses for open-with.
import type { Candidate } from "./resolve";
import type { FrameViewer } from "../bridge/protocol";

export const appletPath = (vault: string, appletNoteId: string) => `/v/${encodeURIComponent(vault)}/a/${encodeURIComponent(appletNoteId)}`;
/** An applet's screen for a note, with the screen its `opens` entry names. */
export function appletHref(vault: string, c: Candidate, noteId: string): string {
  const q = new URLSearchParams({ note: noteId });
  if (c.claim.screen) q.set("screen", c.claim.screen);
  return `${appletPath(vault, c.entry.noteId)}?${q}`;
}
/** Vault's address, at a vault and, given one, a record in it (it hears them as its launch: `?vault=…[&record=…]`). */
export function viewerHref(v: Pick<FrameViewer, "vault" | "noteId">, vault: string, record?: string): string {
  return `${appletPath(v.vault, v.noteId)}?${new URLSearchParams({ vault, ...(record ? { record } : {}) })}`;
}
