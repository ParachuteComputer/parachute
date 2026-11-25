// The hash of what an applet asks for, as the device that approved it computed it (the app's approvals.ts `asksOf`):
// its fields as written (manifest, opens, app, services, embeds, …), its path and the approval's subject, and its pick.
// The view compares it with the approval's `scope`, so an applet whose fields changed since (wider folders, say) asks
// again in the app, as it would there. Read as the person's own vault, the hub the approval names being theirs.
import { readApplet } from "../../../src/applet/discovery";
import { asksOf, type Subject } from "../../../src/applet/approvals";
import type { VaultRef } from "../../../src/applet/vaultPick";

export type AsksInput = { vault: string; record: { id: string; path: string; tags: string[]; fields: Record<string, unknown> }; approval: { subject: Subject; vaults?: unknown } };

export async function asksFor(p: AsksInput): Promise<{ ok: true; scope: string } | { ok: false; why: string }> {
  let hub: string;
  try { hub = new URL(p.approval.subject.hub).origin; } catch { return { ok: false, why: "its approval names no hub" }; }
  const a = readApplet({ id: p.record.id, path: p.record.path, tags: p.record.tags, metadata: p.record.fields }, p.vault, false, (o) => o === hub);
  if (!a.ok) return { ok: false, why: a.error };
  // what its page embeds is part of its asks, resolved from other records on the device: not here
  if (a.entry.embeds.length) return { ok: false, why: "its page embeds other records, which open only in Parachute" };
  const vaults = Array.isArray(p.approval.vaults) ? (p.approval.vaults as VaultRef[]) : null;
  return { ok: true, scope: await asksOf(p.approval.subject, a.entry, p.record.fields, [], vaults) };
}
