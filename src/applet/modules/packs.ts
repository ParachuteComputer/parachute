// The `vaults` word's pack calls (T-476, docs/PACKS.md): Parachute's own starter packs, applied with one tap and no AI,
// and the packs a vault has (its receipts). Kept apart from vaults.ts so the rest of the word stays as it was:
//
//     packs({vault})       {starters: [{id, name, summary, version, types: {name: [field]}, records: [path]}],
//                           installed: [{id, name, version, source, appliedAt, appliedBy, made, skipped, newer}]}
//     addPack({vault, id}) apply one of Parachute's starter packs (src/kit/packs.ts): {added, kept, notes, changed}
//     importNotion({vault}) during a tap: the shell's own picker for a Notion export (.zip), read here and applied as a
//                          pack (src/kit/notion.ts): {picked: false} when none, else {name, found, made, types, notes,
//                          left, changed}. The file comes from the person through the shell's sheet, never from the
//                          applet, so this too applies only what Parachute itself made of it.
//
// A pack here is only one the app ships (src/kit/packs/*.json, the same block as its page on parachute.computer): an
// applet can't hand the app a pack of its own to apply. What the pack writes is checked again here (checkPack): its
// types and fields, records only at free paths in the person's folders, Templates/ and Parachute/Views/, nothing that
// publishes, and the receipt last, at Parachute/Receipts/<id>. A vault whose server can't make types this way (core 0.8,
// or a 0.9 before write could define a type over REST) says so, and nothing is written.
import { ContractError, ERROR_CODES, hasOnly, plain } from "../contract.ts";
import { applyPack, checkPack, receiptOf, receiptRecord, refusalWords, RECEIPTS, RECEIPT_TAG, type HeldType, type Pack, type PackTarget, type Receipt } from "../../kit/packs.ts";
import coreTypes from "../../kit/packs/core-types.json";
import { notionImport, NOTION_WANT } from "../../kit/notion.ts";
import { readZip, ZipError } from "../../kit/zip.ts";
import { PUBLISH_FIELD, type VaultsDeps } from "./vaults.ts";

/** Parachute's own starter packs, checked once. */
export const STARTERS: Pack[] = [checkPack(coreTypes)];

export type Installed = { id: string; name: string; version: number; source: string; appliedAt: string | null; appliedBy: string | null;
  made: Receipt["made"]; skipped: string[]; newer: number | null };

const status = (e: unknown) => (e as { status?: number })?.status;
const enc = encodeURIComponent;

const messageOf = (e: unknown) => `${(e as Error)?.message ?? ""} ${(e as { body?: unknown })?.body ?? ""}`;

/** A vault as the applier sees it, over the vault's own record door. */
export function packTarget(deps: VaultsDeps, vault: string): PackTarget {
  const receiptAt = (id: string) => `${RECEIPTS}${id}`;
  /** Types whose schema gives `published` a default: a record given one would be published with no sheet (vaults.ts). */
  let publishing = new Set<string>();
  return {
    async types() {
      const raw = await deps.request(vault, "GET", "/types?include_schema=true");
      const rows = Array.isArray(raw) ? raw : [];
      const out = rows.flatMap((r: unknown): HeldType[] => {
        if (!plain(r) || typeof r.name !== "string") return [];
        const fields = plain(r.fields) ? r.fields as HeldType["fields"] : {};
        return [{ name: r.name, kind: r.kind === "type" ? "type" : "tag", count: typeof r.count === "number" ? r.count : 0, description: typeof r.description === "string" ? r.description : null, fields }];
      });
      publishing = new Set(out.filter((t) => Object.prototype.hasOwnProperty.call(t.fields, PUBLISH_FIELD) && (t.fields[PUBLISH_FIELD] as { default?: unknown })?.default !== undefined).map((t) => t.name));
      return out;
    },
    async defineType(name, def) {
      try {
        await deps.request(vault, "PUT", `/types/${enc(name)}`, { kind: "type", ...def });
        return "ok";
      } catch (e) {
        const m = messageOf(e);
        // core's rule for write (#139) says what write may do; any other 403 is the route itself: admin only
        if (status(e) === 403) return /With write access you can/.test(m) ? { refused: refusalWords(m) } : "unsupported";
        // a field another type declares otherwise, or a name core won't take: said, and the rest goes on
        if ([400, 409, 422].includes(status(e) ?? 0) || (e as { name?: string })?.name === "VaultConflictError" || /failed \((400|409|422)\)/.test(m)) return { refused: "the server refused it, because a field of it is set up differently in another type" };
        throw e;
      }
    },
    async create(r) {
      if ([...(r.types ?? []), ...(r.tags ?? [])].some((t) => publishing.has(t))) return { refused: "a type of yours would publish it" };
      const raw = await deps.request(vault, "POST", "/records", { path: r.path, body: r.body, types: r.types ?? [], tags: r.tags ?? [], ...(r.fields ? { fields: r.fields } : {}), if_exists: "ignore" });
      if (!plain(raw) || typeof raw.id !== "string") throw new Error(`${r.path} wasn't written`);
      return { id: raw.id, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null, existed: raw.existed === true };
    },
    async receipt(id) {
      try {
        const raw = await deps.request(vault, "GET", `/records/${enc(receiptAt(id))}?include_body=false`);
        if (!plain(raw) || typeof raw.id !== "string" || !plain(raw.fields)) return null;
        const tags = Array.isArray(raw.tags) ? raw.tags : [];
        const at = { id: raw.id, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null };
        // a record of the person's at the receipt's path: theirs, and nothing is written over it
        if (!tags.includes(RECEIPT_TAG)) throw new Error(`${receiptAt(id)} is a record of yours, so the pack wasn't added. Nothing was changed.`);
        const r = receiptOf(raw.fields);
        // a receipt this app can't read (an AI wrote its own shape): read as one that made nothing, at version 0, so
        // applying writes it again in the shape this contract says, and treats what is there as the person's
        return { receipt: r && r.id === id ? r : { contract: 1, id, name: id, version: 0, source: "", made: { types: {}, records: [] }, skipped: [] }, ...at };
      } catch (e) {
        if (status(e) === 404 || /not.?found|404/i.test(String((e as Error)?.message))) return null;
        throw e;
      }
    },
    async writeReceipt(r, was) {
      const rec = receiptRecord(r);
      if (was) await deps.request(vault, "PATCH", `/records/${enc(was.id)}`, { fields: rec.fields, body: rec.body, if_updated_at: was.updatedAt });
      else await deps.request(vault, "POST", "/records", rec);
    },
  };
}

/** The packs a vault has: its receipts, newest version first per pack, and whether Parachute ships a newer one. */
export async function installed(deps: VaultsDeps, vault: string): Promise<Installed[]> {
  const u = new URLSearchParams({ tag: RECEIPT_TAG, path_prefix: RECEIPTS, include_fields: "true", include_body: "false", limit: "50" });
  const raw = await deps.request(vault, "GET", `/records?${u}`);
  const rows = Array.isArray(raw) ? raw : plain(raw) && Array.isArray(raw.records) ? raw.records : [];
  return rows.flatMap((x: unknown): Installed[] => {
    if (!plain(x) || typeof x.path !== "string" || !x.path.startsWith(RECEIPTS) || !plain(x.fields)) return [];
    const r = receiptOf(x.fields);
    if (!r) return [];
    const starter = STARTERS.find((s) => s.id === r.id);
    return [{ id: r.id, name: r.name, version: r.version, source: r.source, appliedAt: typeof x.createdAt === "string" ? x.createdAt : null,
      appliedBy: typeof x.createdVia === "string" ? x.createdVia : null, made: r.made, skipped: r.skipped,
      newer: starter && starter.version > r.version ? starter.version : null }];
  });
}

export const starterInfo = (p: Pack) => ({
  id: p.id, name: p.name, summary: p.summary ?? "", version: p.version, source: p.source,
  types: Object.fromEntries(Object.entries(p.types).map(([t, d]) => [t, Object.keys(d.fields)])),
  records: p.records.map((r) => r.path),
});

type Run = (p: Record<string, unknown>, s: unknown, ctx: { charge(n: number): void }) => Promise<unknown>;
/** The two calls, as vaults.ts's methods: `need` and `held` are its checks (the word, a vault this device holds). */
export function packMethods(deps: VaultsDeps, word: (p: unknown) => void, held: (vault: string) => { level: "read" | "write" | null; mine: boolean }) {
  const vaultOk = (p: unknown, keys: string[]) => plain(p) && hasOnly(p, ["vault", ...keys]) && typeof p.vault === "string" && p.vault.length > 0 && p.vault.length <= 200;
  const fail = (e: unknown) => e instanceof ContractError ? e : new ContractError(ERROR_CODES.failed, String((e as Error)?.message ?? e).slice(0, 300));
  const writes = (vault: string) => { const h = held(vault); if (!h.mine && h.level !== "write") throw new ContractError(ERROR_CODES.notGranted, "Parachute only reads this vault, so it can't bring anything in here"); };
  return {
    importNotion: {
      cap: null,
      validate: (p: unknown) => { word(p); return vaultOk(p, []) ? { ok: true as const, value: p } : { ok: false as const }; },
      run: (async ({ vault }, _s, ctx) => {
        writes(vault as string);
        if (!deps.pick) throw new ContractError(ERROR_CODES.failed, "this screen can't open a file");
        if ((await deps.door(vault as string)) !== "records") throw new ContractError(ERROR_CODES.failed, "This vault's server is older (0.8): an import needs types, which come with 0.9. Nothing was changed.");
        // one call's worth, before the picker: the person's own tap and pick gate it, and a workspace can be hundreds of
        // records (a frame's reads are 60 in 10 s: charged per record, any real export would be refused after the pick)
        ctx.charge(5);
        const [file] = await deps.pick([".zip", "application/zip"], false);
        if (!file) return { picked: false };
        let pack: ReturnType<typeof notionImport>;
        try { pack = notionImport(await readZip(file.bytes, { want: NOTION_WANT }), file.name); } catch (e) {
          throw new ContractError(ERROR_CODES.failed, e instanceof ZipError || e instanceof Error ? e.message.slice(0, 300) : "That file couldn't be read.");
        }
        try {
          const r = await applyPack(pack.pack, packTarget(deps, vault as string));
          return { picked: true, name: pack.pack.name, found: pack.found, made: r.receipt.made.records.length, types: Object.keys(pack.pack.types), notes: r.notes, left: pack.left, changed: r.changed };
        } catch (e) {
          if ((e as { name?: string })?.name === "NeedsWriteError") throw new ContractError(ERROR_CODES.notGranted, String((e as Error).message).slice(0, 300));
          throw fail(e);
        }
      }) as Run,
    },
    packs: {
      cap: null,
      validate: (p: unknown) => { word(p); return vaultOk(p, []) ? { ok: true as const, value: p } : { ok: false as const }; },
      run: (async ({ vault }, _s, ctx) => {
        held(vault as string); ctx.charge(1);
        if ((await deps.door(vault as string)) !== "records") return { starters: STARTERS.map(starterInfo), installed: [], older: true };
        try { return { starters: STARTERS.map(starterInfo), installed: await installed(deps, vault as string) }; } catch (e) { throw fail(e); }
      }) as Run,
    },
    addPack: {
      cap: null,
      validate: (p: unknown) => { word(p); return vaultOk(p, ["id"]) && typeof (p as { id?: unknown }).id === "string" ? { ok: true as const, value: p } : { ok: false as const }; },
      run: (async ({ vault, id }, _s, ctx) => {
        held(vault as string);
        const pack = STARTERS.find((s) => s.id === id);
        if (!pack) throw new ContractError(ERROR_CODES.outOfScope, "Parachute has no pack by that name");
        // a request for each type and record, the two reads and the receipt
        ctx.charge(3 + Object.keys(pack.types).length + pack.records.length);
        if ((await deps.door(vault as string)) !== "records") throw new ContractError(ERROR_CODES.failed, "This vault's server is older (0.8): packs need types, which come with 0.9. Nothing was changed.");
        try {
          const { added, kept, notes, changed } = await applyPack(pack, packTarget(deps, vault as string));
          return { added, kept, notes, changed };
        } catch (e) {
          if ((e as { name?: string })?.name === "NeedsWriteError") throw new ContractError(ERROR_CODES.notGranted, String((e as Error).message).slice(0, 300));
          throw fail(e);
        }
      }) as Run,
    },
  };
}
