// The hash of what an applet asks for, as the device that approved it computed it (the app's approvals.ts `asksOf`):
// its fields as written (manifest, opens, app, services, embeds, …), its path and the approval's subject, and its pick.
// The view compares it with the approval's `scope`, so an applet whose fields changed since (wider folders, say) asks
// again in the app, as it would there. Read as the person's own vault, the hub the approval names being theirs, and
// with the vault's role tags taken out of what it opens, as AppletScreen does before it hashes.
import { readApplet, type AppletEntry } from "../../../src/applet/discovery";
import { asksOf, type Subject } from "../../../src/applet/approvals";
import { withoutRoles } from "../../../src/applet/opens";
import { DEFAULT_ROLE_TAGS, SETTINGS_NOTE_PATH, roleTagsFrom } from "../../../src/open/roles";
import type { VaultRef } from "../../../src/applet/vaultPick";
import { Refusal, type CallTool } from "./mcpVault";

/** The vault's role tags (roles.ts readRoleTags), read through the host: the defaults when the vault has no settings
 *  record; any other failure is thrown (the view then runs nothing). */
export async function roleTagsVia(call: CallTool): Promise<string[]> {
  try { return roleTagsFrom(((await call("query-records", { id: SETTINGS_NOTE_PATH })) as { fields?: unknown })?.fields ?? null); } catch (e) {
    if (e instanceof Refusal && e.error_type === "not_found") return [...DEFAULT_ROLE_TAGS];
    throw e;
  }
}

export type AsksInput = { vault: string; record: { id: string; path: string; tags: string[]; fields: Record<string, unknown> }; approval: { subject: Subject; vaults?: unknown } };

export async function asksFor(p: AsksInput, roleTags: readonly string[]): Promise<{ ok: true; scope: string; entry: AppletEntry } | { ok: false; why: string }> {
  let hub: string;
  try { hub = new URL(p.approval.subject.hub).origin; } catch { return { ok: false, why: "its approval names no hub" }; }
  const a = readApplet({ id: p.record.id, path: p.record.path, tags: p.record.tags, metadata: p.record.fields }, p.vault, false, (o) => o === hub);
  if (!a.ok) return { ok: false, why: a.error };
  // the vault's role tags are no applet's to open or to tag with (AppletScreen: dropped before the card and the key)
  a.entry.opens = withoutRoles(a.entry.opens, roleTags);
  // what its page embeds is part of its asks, resolved from other records on the device: not here
  if (a.entry.embeds.length) return { ok: false, why: "its page embeds other records, which open only in Parachute" };
  const vaults = Array.isArray(p.approval.vaults) ? (p.approval.vaults as VaultRef[]) : null;
  return { ok: true, scope: await asksOf(p.approval.subject, a.entry, p.record.fields, [], vaults), entry: a.entry };
}
