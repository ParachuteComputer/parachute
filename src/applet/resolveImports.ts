// What a TSX/JSX applet imports (imports.ts), found and checked (docs/design/EMBED.md, "How an import runs"):
// `component:<id>` is a component in the applet's own vault, or a pointer in the home vault to one (by its id). From the
// person's own vaults, the applet's own, or someone else's they trust; one level only (a component that imports is
// refused); two pointers with one id refuse it. Each comes back with its code and hash, for the applet's composite hash.
import type { Note } from "@openparachute/surface-client";
import { codeHash } from "./code";
import { COMPONENT_TAG, componentNewer, parseComponent } from "./component";
import { importsOf, MAX_IMPORTS, plainImportId } from "./imports";
import { readPointers } from "./pointers";
import { fullComponent, refreshComponents } from "./useComponents";
import { keptClientFor } from "../vault/client";
import { MAX_CODE_CHARS } from "../vault/limited";
import { originOf, listVaults, type VaultRecord } from "../vault/store";
import { whoseOf } from "../vault/whose";

export type Imported = { id: string; name: string; vault: string; host: string; own: boolean; whose: "mine" | "theirs" | "trusted"; kind: "tsx" | "jsx"; source: string; hash: string };
/** `newer`: what it imports was made for a newer app (level.ts): the applet says "Update Parachute to open …". */
export type ImportsRead = { ok: true; imports: Imported[] } | { ok: false; error: string; newer?: true };
const hostOf = (issuer: string) => { try { return new URL(issuer).host; } catch { return issuer; } };

export async function readImports(rec: VaultRecord, source: string): Promise<ImportsRead> {
  const ids = importsOf(source);
  if (!ids.length) return { ok: true, imports: [] };
  if (ids.length > MAX_IMPORTS) return { ok: false, error: `it imports more than ${MAX_IMPORTS} components` };
  const bad = ids.find((id) => !plainImportId(id));
  if (bad !== undefined) return { ok: false, error: `it imports «${bad.slice(0, 40)}», which isn't a component's id` };
  const read = await refreshComponents(rec).catch(() => null);
  const own = read?.state === "ok" ? read : null;
  let pointers: Awaited<ReturnType<typeof readPointers>> | null = null;
  const out: Imported[] = [];
  for (const id of ids) {
    const listed = own?.entries.find((c) => c.component.id === id);
    // from a listing without code (the applet's vault is someone else's): read that one in full
    const here = listed && !listed.hash ? await fullComponent(rec, listed.noteId).catch(() => null) : listed;
    if (listed && !here) return { ok: false, error: `«${id}» couldn't be read` };
    if (here) {
      if (here.newer) return { ok: false, error: `«${here.component.name}», which it imports, was made for a newer Parachute: ${here.newer}`, newer: true };
      if (importsOf(here.source).length) return { ok: false, error: `«${id}» imports components itself, and an import is one level only` };
      out.push({ id, name: here.component.name, vault: rec.vault, host: hostOf(rec.issuer), own: true, whose: whoseOf(rec), kind: here.kind, source: here.source, hash: here.hash });
      continue;
    }
    pointers ??= await readPointers().catch(() => []);
    const named = pointers.filter((p) => p.pointer.kind === "component" && p.pointer.id === id);
    if (!named.length) return { ok: false, error: `it imports «${id}», and there is no component by that id here or brought in` };
    if (named.length > 1) return { ok: false, error: `two pointers name «${id}»; keep one` };
    const p = named[0].pointer;
    const from = listVaults().find((v) => originOf(v.issuer) === p.hub && v.vault === p.vault);
    if (!from) return { ok: false, error: `it imports «${id}» from ${p.vault}, and this device doesn't read that vault yet (open it in Settings)` };
    const whose = whoseOf(from);
    if (whose === "theirs" && from.key !== rec.key) return { ok: false, error: `it imports «${id}» from ${p.vault}, which this device doesn't trust. Embed it instead, or trust ${p.vault} in Settings` };
    let n: Note | null;
    try { n = await keptClientFor(from).getNote(p.record); } catch { return { ok: false, error: `${p.vault} can't be reached right now, so «${id}» can't be checked` }; }
    if (!n) return { ok: false, error: `«${id}» is gone from ${p.vault}` };
    const ext = String((n as { extension?: string }).extension ?? "md").replace(/^\./, "").toLowerCase();
    const body = n.content ?? "";
    if (!(n.tags ?? []).includes(COMPONENT_TAG) || (ext !== "tsx" && ext !== "jsx")) return { ok: false, error: `«${id}» in ${p.vault} isn't a TSX or JSX component` };
    if (whose !== "mine" && body.length > MAX_CODE_CHARS) return { ok: false, error: `«${id}» is bigger than a component from someone else's vault may be` };
    const later = componentNewer(n.metadata);
    if (later) return { ok: false, error: `«${id}», which it imports, was made for a newer Parachute: ${later}`, newer: true };
    const c = parseComponent(((n.metadata ?? {}) as Record<string, unknown>).component);
    if (!c.ok) return { ok: false, error: `«${id}»'s fields are invalid: ${c.error}` };
    if (importsOf(body).length) return { ok: false, error: `«${id}» imports components itself, and an import is one level only` };
    out.push({ id, name: c.component.name, vault: from.vault, host: hostOf(from.issuer), own: false, whose, kind: ext, source: body, hash: await codeHash(ext, body) });
  }
  return { ok: true, imports: out };
}

/** The card's lines for what an applet imports: each one, and stressed when it comes from another vault. */
export const importLines = (imports: readonly Imported[]) => imports.map((i) => i.own
  ? { text: `Includes «${i.name}», a component from this vault: its code runs inside this applet`, stress: false }
  : { text: `Includes «${i.name}» from ${i.vault}${i.whose === "trusted" ? " (trusted)" : ""}: its code runs inside this applet and sees what it sees`, stress: true });
