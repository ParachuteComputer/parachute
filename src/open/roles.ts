// A vault's role tags: the tags Parachute's apps give a role to (pinned, archived, capture, view), as the vault's
// settings note names them, else the defaults. No applet may open a note by one of these types. Read only.
import type { VaultClient } from "@openparachute/surface-client";

export const SETTINGS_NOTE_PATH = ".parachute/notes/settings";
export const DEFAULT_ROLE_TAGS = ["pinned", "archived", "capture", "view"];

export function roleTagsFrom(metadata: unknown): string[] {
  const roles = (metadata as { notes?: { tagRoles?: Record<string, unknown> } } | null)?.notes?.tagRoles;
  const named = roles && typeof roles === "object" ? Object.values(roles).filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim().replace(/^#/, "")) : [];
  return [...new Set([...DEFAULT_ROLE_TAGS, ...named])];
}

/** The defaults only when the vault has no settings note; any other failure is thrown (the caller opens nothing). */
export async function readRoleTags(c: Pick<VaultClient, "getNote">): Promise<string[]> {
  let note;
  try { note = await c.getNote(SETTINGS_NOTE_PATH); } catch (e) { if ((e as { status?: number } | null)?.status === 404) return [...DEFAULT_ROLE_TAGS]; throw e; }
  return roleTagsFrom(note?.metadata ?? null);
}
