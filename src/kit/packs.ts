// Packs (T-476, docs/PACKS.md): one block that adds a set of types, templates and saved views to a vault, applied the
// same way by the app (a tap on Add a pack) and by an AI following parachute.computer/docs/build/templates. Pure: it
// talks to a vault only through a PackTarget, so the shell (modules/packs.ts) and the tests give it one.
//
// The rule, in order (the docs page says the same to an AI):
//   1. Types. A type nobody has defined yet is made with the pack's fields. A type the vault already has keeps every
//      field it has; only the pack's fields it lacks are added, and where the server says that needs admin (a type
//      made by someone else), nothing is added and the person is told. A plain tag of the same name stays a tag. A
//      field whose name another type already uses with another kind is left out, and said.
//   2. Records, each only at a path that is free (if_exists: ignore). A taken path is the person's and is left as it is.
//   3. The receipt, last (Parachute/Receipts/<id>): what this pack made, nothing else. Written only when something was
//      made, or the pack's version is newer than the one recorded.
// Applying twice changes nothing. Nothing is renamed, retyped, replaced or deleted.

export const PACK_CONTRACT = 1;
export const RECEIPTS = "Parachute/Receipts/";
export const RECEIPT_TAG = "parachute-receipt";

export type FieldSpec = { type: string; enum?: string[]; default?: unknown; cardinality?: "one" | "many"; description?: string; indexed?: boolean };
export type PackType = { description?: string; fields: Record<string, FieldSpec> };
export type PackRecord = { path: string; body: string; types?: string[]; tags?: string[]; fields?: Record<string, unknown> };
export type Pack = {
  parachute_pack: 1; id: string; name: string; version: number; source: string; summary?: string;
  types: Record<string, PackType>; records: PackRecord[];
};
export type Receipt = {
  contract: 1; id: string; name: string; version: number; source: string;
  made: { types: Record<string, string[]>; records: { path: string; id: string; updated_at: string | null }[] };
  skipped: string[];
};
export type HeldType = { name: string; kind: "type" | "tag"; count: number; description?: string | null; fields: Record<string, { type?: string; enum?: unknown[]; indexed?: boolean }> };

/** A vault, as the applier sees it. */
export interface PackTarget {
  /** Every type and tag, with declared fields. */
  types(): Promise<HeldType[]>;
  /** PUT the type: a new one, or only fields it lacks. "unsupported": the server lets this connection make no type at
   *  all (before core #139, or 0.8); `refused`: this type or these fields, in the server's words (needs admin, a field
   *  another type declares otherwise). */
  defineType(name: string, def: { description?: string; fields: Record<string, FieldSpec> }): Promise<"ok" | "unsupported" | { refused: string }>;
  /** Create at a free path only (if_exists: ignore): existed = the path was taken, and nothing was written. `refused`:
   *  not written, and why (it would publish). */
  create(r: PackRecord): Promise<{ id: string; updatedAt: string | null; existed: boolean } | { refused: string }>;
  /** This pack's receipt in the vault, if any. */
  receipt(id: string): Promise<{ receipt: Receipt; id: string; updatedAt: string | null } | null>;
  /** Write the receipt: a new record, or a change to the one read (`was`). */
  writeReceipt(r: Receipt, was: { id: string; updatedAt: string | null } | null): Promise<void>;
}

export type Applied = {
  /** What landed this time, in a person's words: "the types person and task", "due on task", "4 templates". */
  added: string[];
  /** What was already there and left as it is, in words. */
  kept: string[];
  /** Why something of the pack's wasn't added (a collision, a refusal), in plain words. */
  notes: string[];
  /** Did anything in the vault change (the receipt included)? */
  changed: boolean;
  receipt: Receipt;
};

const NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const FIELD = /^[a-z][a-z0-9_]{0,39}$/;
const KINDS = ["string", "number", "integer", "boolean", "array", "reference", "date"];
const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const only = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
/** Paths a pack may write: templates, saved views, and the person's own folders; never the app's or code. */
export const packPath = (p: string) => p.length <= 200 && !/(^|\/)\.|^\/|\/\/|\/$|\\|%|[\u0000-\u001f]/.test(p) &&
  (p.startsWith("Templates/") || p.startsWith("Parachute/Views/") || !/^(applets|parachute|\.parachute)(\/|$)/i.test(p)) && !/\.(html?|tsx|jsx|js)$/i.test(p);

/** The pack in a page: its one fenced block that carries `"parachute_pack"`. The prose around it is for people. */
export function packFromPage(text: string): Pack {
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]).filter((b) => b.includes("\"parachute_pack\""));
  if (blocks.length !== 1) throw new Error(blocks.length ? "the page has more than one pack block" : "the page has no pack block");
  return checkPack(JSON.parse(blocks[0]));
}

/** A pack as this contract writes it, or an error that says what is wrong. Anything outside the shape is refused. */
export function checkPack(x: unknown): Pack {
  const bad = (why: string): never => { throw new Error(`not a pack: ${why}`); };
  if (!plain(x)) return bad("not an object");
  if (x.parachute_pack !== PACK_CONTRACT) return bad(`parachute_pack must be ${PACK_CONTRACT}`);
  if (!only(x, ["parachute_pack", "id", "name", "version", "source", "summary", "types", "records"])) return bad("a key it doesn't know");
  if (typeof x.id !== "string" || !NAME.test(x.id)) return bad("id");
  if (typeof x.name !== "string" || !x.name || x.name.length > 80) return bad("name");
  if (!Number.isInteger(x.version) || (x.version as number) < 1) return bad("version is a whole number from 1");
  if (typeof x.source !== "string" || !/^https:\/\//.test(x.source)) return bad("source is an https address");
  if (x.summary !== undefined && (typeof x.summary !== "string" || x.summary.length > 300)) return bad("summary");
  if (!plain(x.types)) return bad("types");
  for (const [t, def] of Object.entries(x.types)) {
    if (!NAME.test(t) || /^(publish|published|applet|component|parachute)/.test(t) || !plain(def) || !only(def, ["description", "fields"]) || !plain(def.fields)) return bad(`type ${t}`);
    if (def.description !== undefined && typeof def.description !== "string") return bad(`type ${t}'s description`);
    for (const [f, spec] of Object.entries(def.fields)) {
      if (!FIELD.test(f) || f === "published" || !plain(spec) || !only(spec, ["type", "enum", "default", "cardinality", "description"])) return bad(`field ${t}.${f}`);
      if (!KINDS.includes(spec.type as string)) return bad(`field ${t}.${f}'s type`);
      if (spec.enum !== undefined && !(Array.isArray(spec.enum) && spec.enum.every((e) => typeof e === "string"))) return bad(`field ${t}.${f}'s enum`);
    }
  }
  if (!Array.isArray(x.records)) return bad("records");
  for (const r of x.records) {
    if (!plain(r) || !only(r, ["path", "body", "types", "tags", "fields"]) || typeof r.path !== "string" || !packPath(r.path) || typeof r.body !== "string") return bad("a record");
    if ((r.types !== undefined && !Array.isArray(r.types)) || (r.tags !== undefined && !Array.isArray(r.tags))) return bad(`${r.path}'s types and tags are lists`);
    const names = [...(Array.isArray(r.types) ? r.types : []), ...(Array.isArray(r.tags) ? r.tags : [])];
    if (names.some((n) => typeof n !== "string" || /^(publish|published|applet|component)$/i.test(n) || (/^parachute/i.test(n) && n !== "parachute-view"))) return bad(`${r.path}'s names`);
    if ((Array.isArray(r.tags) && r.tags.includes("parachute-view")) !== r.path.startsWith("Parachute/Views/")) return bad(`${r.path}: saved views live in Parachute/Views/, tagged parachute-view`);
    if (r.fields !== undefined && (!plain(r.fields) || "published" in r.fields)) return bad(`${r.path}'s fields`);
  }
  return x as Pack;
}

/** Why core refused a type change, in a person's words (core type-write.ts `writeTypeProblem` says what write may do). */
export function refusalWords(message: string): string {
  if (/which you didn't make/.test(message)) return "adding fields to a type made elsewhere needs admin";
  if (/plain tag/.test(message)) return "it is a tag here, and making a tag a type needs admin";
  if (/parent/.test(message)) return "another type builds on it, so changing it needs admin";
  if (/tag-scoped/.test(message)) return "this connection reaches only some tags";
  if (/Changing the field/.test(message)) return "changing a field it already has needs admin";
  return "that needs admin here";
}

/** Would core take this field beside another type's declaration of it? Its kind and its `indexed` must agree. */
const agrees = (a: { type?: string; indexed?: boolean } | undefined, b: FieldSpec) => a?.type === b.type && !!a?.indexed === !!b.indexed;
const sameKind = (a: { type?: string } | undefined, b: FieldSpec) => a?.type === b.type;
const list = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** Apply a pack to a vault (the rule at the top). If a step fails after something was written, the receipt still
 *  records what was made before the error goes on, so the next apply knows what is the pack's. */
export async function applyPack(pack: Pack, target: PackTarget): Promise<Applied> {
  const kept: string[] = [], notes: string[] = [];
  const newTypes: string[] = [], newFields: string[] = [], newRecords: string[] = [];
  const before = await target.receipt(pack.id);
  const ours = new Set(before?.receipt.made.records.map((r) => r.path) ?? []);
  const made: Receipt["made"] = { types: { ...(before?.receipt.made.types ?? {}) }, records: [...(before?.receipt.made.records ?? [])] };
  let wrote = false;
  /** `done`: every step ran, so the vault has this version; else it keeps the version it had (0: never finished). */
  const receipt = (done = true): Receipt => ({ contract: 1, id: pack.id, name: pack.name, version: done ? Math.max(pack.version, before?.receipt.version ?? 0) : before?.receipt.version ?? 0, source: pack.source, made,
    skipped: wrote || !before ? notes : before.receipt.skipped });
  const was = before ? { id: before.id, updatedAt: before.updatedAt } : null;

  try {
    // 1. Types
    const held = await target.types();
    for (const [name, def] of Object.entries(pack.types)) {
      const h = held.find((t) => t.name === name);
      if (h && h.kind === "tag" && h.count > 0) { notes.push(`#${name} is a tag in this vault, so it stays a tag (making it a type needs admin).`); continue; }
      // a field another type already declares otherwise (its kind, or whether it is indexed) would make the server
      // refuse the whole type: leave it out, and say so
      const fields: Record<string, FieldSpec> = {};
      for (const [f, spec] of Object.entries(def.fields)) {
        const other = held.find((t) => t.name !== name && t.fields[f] && !agrees(t.fields[f], spec));
        if (other) notes.push(`${name}'s ${f} wasn't added: your type ${other.name} has a ${f} field of its own, set up differently.`);
        else fields[f] = spec;
      }
      const has = h?.fields ?? {};
      const missing = Object.fromEntries(Object.entries(fields).filter(([f]) => !(f in has)));
      const different = Object.keys(fields).filter((f) => f in has && !sameKind(has[f], fields[f]));
      const fresh = !h || (Object.keys(has).length === 0 && !h.description);
      if (fresh) {
        const r = await target.defineType(name, { ...(def.description ? { description: def.description } : {}), fields });
        if (r === "unsupported") {
          // the server's route refuses this connection any type: nothing of the pack can land
          if (!wrote) throw new Error("This vault's server doesn't let Parachute make types yet. Nothing was changed.");
          notes.push(`The type ${name} wasn't made: this vault's server doesn't let Parachute make types.`);
          continue;
        }
        if (r !== "ok") { notes.push(`The type ${name} wasn't made: ${r.refused}`); continue; }
        wrote = true;
        made.types[name] = Object.keys(fields);
        newTypes.push(name);
        continue;
      }
      if (different.length) notes.push(`${name} is already a type here, and its ${list(different)} stay${different.length === 1 ? "s" : ""} as you have ${different.length === 1 ? "it" : "them"}.`);
      if (!Object.keys(missing).length) { if (!(name in made.types)) kept.push(`the type ${name}`); continue; }
      const r = await target.defineType(name, { fields: missing });
      if (r !== "ok") {
        notes.push(`${name} is already a type here and keeps its own fields. The pack's ${list(Object.keys(missing))} ${Object.keys(missing).length === 1 ? "wasn't" : "weren't"} added: ${r === "unsupported" ? "this vault's server doesn't let Parachute change types" : r.refused}.`);
        continue;
      }
      wrote = true;
      made.types[name] = [...new Set([...(made.types[name] ?? []), ...Object.keys(missing)])];
      newFields.push(`${list(Object.keys(missing))} on ${name}`);
    }

    // 2. Records, only at free paths
    for (const rec of pack.records) {
      const r = await target.create(rec);
      if ("refused" in r) { notes.push(`${rec.path} wasn't written: ${r.refused}`); continue; }
      if (!r.existed) {
        wrote = true;
        made.records = made.records.filter((x) => x.path !== rec.path).concat({ path: rec.path, id: r.id, updated_at: r.updatedAt });
        newRecords.push(rec.path);
      } else if (!ours.has(rec.path)) {
        notes.push(`${rec.path} is already a record of yours, so it stays as it is.`);
      } else kept.push(rec.path);
    }
  } catch (e) {
    // what landed before the error is the pack's: say so in the receipt, so the next apply doesn't call it the person's
    // at the version the vault had before, so the app still offers to finish (Update, or Finish adding at 0)
    if (wrote) await target.writeReceipt(receipt(false), was).catch(() => {});
    throw e;
  }

  const templates = newRecords.filter((p) => p.startsWith("Templates/")), views = newRecords.filter((p) => p.startsWith("Parachute/Views/"));
  const added = [
    ...(newTypes.length ? [`the type${newTypes.length === 1 ? "" : "s"} ${list(newTypes)}`] : []),
    ...newFields,
    ...(templates.length ? [templates.length === 1 ? `the template ${templates[0]}` : `${templates.length} templates`] : []),
    ...views.map((v) => `the saved view ${v.split("/").pop()}`),
    ...newRecords.filter((p) => !templates.includes(p) && !views.includes(p)),
  ];

  // 3. The receipt, last
  const newer = !before || pack.version > before.receipt.version;
  const final = receipt();
  if (wrote || newer) await target.writeReceipt(final, was);
  return { added, kept, notes, changed: wrote || newer, receipt: final };
}

/** A receipt as a record: its path, tag, fields and a line for a person reading the vault. */
export const receiptRecord = (r: Receipt) => ({
  path: `${RECEIPTS}${r.id}`, tags: [RECEIPT_TAG], fields: { receipt: r },
  body: `${r.name}, version ${r.version}, added from ${r.source}. This record says what it made, so applying it again changes nothing.\n`,
});

/** A receipt read back from a record's fields, or null when it isn't one. */
export function receiptOf(fields: Record<string, unknown>): Receipt | null {
  const r = fields.receipt;
  if (!plain(r) || r.contract !== 1 || typeof r.id !== "string" || typeof r.name !== "string" || !Number.isInteger(r.version) || !plain(r.made)) return null;
  const made = r.made as Record<string, unknown>;
  return {
    contract: 1, id: r.id, name: r.name, version: r.version as number, source: typeof r.source === "string" ? r.source : "",
    made: { types: plain(made.types) ? made.types as Receipt["made"]["types"] : {}, records: Array.isArray(made.records) ? made.records as Receipt["made"]["records"] : [] },
    skipped: Array.isArray(r.skipped) ? (r.skipped as unknown[]).filter((s): s is string => typeof s === "string") : [],
  };
}
