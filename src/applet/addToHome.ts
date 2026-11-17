// Add to home (docs/design/EMBED.md): a component goes onto the person's home applet's page. The shell writes a pointer
// in the home vault when the component lives in another vault than the home applet, then adds `{name, record}` to the
// home applet's `fields.embeds`, only if the note is as it was read (one more try on a conflict). Nothing runs until
// the person allows it on its own sheet.
import { VaultConflictError } from "@openparachute/surface-client";
import { stripExt } from "./contract";
import { bringIn, names, readPointers } from "./pointers";
import { fullComponent } from "./useComponents";
import { barNow } from "../shell/homeSettings";
import { clientFor } from "../vault/client";
import { listVaults } from "../vault/store";
import { isMine } from "../vault/whose";
import { MAX_EMBEDS } from "./embeds";

export async function addToHome(vault: string, noteId: string): Promise<"added" | "already"> {
  const start = barNow().start;
  if (!start) throw new Error("You have no home applet yet: choose one of your applets to open on start first.");
  const host = listVaults().find((v) => v.key === start.vault);
  if (!host || !isMine(host)) throw new Error("Your home applet isn't in a vault of yours.");
  const from = listVaults().find((v) => v.key === vault);
  if (!from) throw new Error("This device doesn't hold that vault.");
  const c = await fullComponent(from, noteId);
  const client = clientFor(host);
  // nothing is written when the page is full
  const before = await client.getNote(start.noteId);
  if (!before) throw new Error("Your home applet is gone.");
  const had = ((before.metadata ?? {}) as Record<string, unknown>).embeds;
  if (Array.isArray(had) && had.length >= MAX_EMBEDS) throw new Error(`Your home shows ${MAX_EMBEDS} things already: take one off first.`);
  // a pointer already there is used as it is: its pin moves only when the person allows new code on its card
  const there = from.key === host.key ? null : (await readPointers()).find((p) => names(p.pointer, from, noteId)) ?? null;
  const record = from.key === host.key ? stripExt(c.path)
    : stripExt(there?.path ?? (await bringIn(from, noteId, { kind: "component", id: c.component.id, name: c.component.name, code: c.hash })).path);
  for (let attempt = 0; ; attempt++) {
    const n = await client.getNote(start.noteId);
    if (!n) throw new Error("Your home applet is gone.");
    const meta = (n.metadata ?? {}) as Record<string, unknown>;
    const embeds = Array.isArray(meta.embeds) ? meta.embeds as { name?: unknown; record?: unknown }[] : [];
    if (embeds.some((e) => typeof e?.record === "string" && stripExt(e.record) === record)) return "already";
    if (embeds.length >= MAX_EMBEDS) throw new Error(`Your home shows ${MAX_EMBEDS} things already: take one off first.`);
    let name = c.component.id;
    for (let i = 2; embeds.some((e) => e?.name === name); i++) name = `${c.component.id}-${i}`;
    const updatedAt = (n as { updatedAt?: string }).updatedAt;
    try {
      await client.updateNote(n.id, { metadata: { ...meta, embeds: [...embeds, { name, record }] }, ...(updatedAt ? { if_updated_at: updatedAt } : {}) } as Parameters<typeof client.updateNote>[1]);
      return "added";
    } catch (e) {
      if (e instanceof VaultConflictError && attempt === 0) continue;
      throw e;
    }
  }
}
