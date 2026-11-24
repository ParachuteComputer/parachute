// The pack check is the gate between a page's block and the vault: what it lets through is what gets written.
import { describe, expect, test } from "vitest";
import { applyPack, checkPack, packFromPage, receiptOf, receiptRecord, type PackTarget, type Receipt } from "./packs";
import coreTypes from "./packs/core-types.json";


const core = JSON.parse(JSON.stringify(coreTypes));
const withRecord = (r: Record<string, unknown>) => ({ ...core, records: [r] });

describe("checkPack", () => {
  test("Parachute's Core types pack passes", () => {
    expect(checkPack(core).id).toBe("core-types");
  });
  test("refuses what would publish, reach the app's own records, or run code", () => {
    for (const r of [
      { path: "Notes/a", body: "", tags: ["publish"] },
      { path: "Notes/a", body: "", fields: { published: true } },
      { path: "Notes/a", body: "", tags: ["applet"] },
      { path: "Notes/a", body: "", tags: ["parachute-settings"] },
      { path: "Applets/Evil", body: "" },
      { path: "Parachute/Receipts/other", body: "" },
      { path: ".parachute/x", body: "" },
      { path: "Notes/../Applets/x", body: "" },
      { path: "Notes/page.html", body: "" },
      { path: "Notes/a", body: "", tags: ["parachute-view"] },
      { path: "Parachute/Views/task/X", body: "" },
    ]) expect(() => checkPack(withRecord(r)), JSON.stringify(r)).toThrow(/not a pack/);
  });
  test("refuses a field named published, an unknown key, a field kind core doesn't have", () => {
    expect(() => checkPack({ ...core, types: { note: { fields: { published: { type: "boolean" } } } } })).toThrow(/published/);
    expect(() => checkPack({ ...core, applets: [] })).toThrow(/doesn't know/);
    expect(() => checkPack({ ...core, types: { note: { fields: { x: { type: "object" } } } } })).toThrow(/type/);
    expect(() => checkPack({ ...core, types: { note: { fields: {} , parent_names: ["x"] } } })).toThrow(/type note/);
  });
});

describe("packFromPage", () => {
  test("reads the one block that carries parachute_pack, and none of the prose", () => {
    const page = `# Core types\n\nSome words, and an example:\n\n\`\`\`json\n{"not": "a pack"}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(core, null, 2)}\n\`\`\`\n`;
    expect(packFromPage(page)).toEqual(core);
    expect(() => packFromPage("# Nothing here")).toThrow(/no pack block/);
    expect(() => packFromPage(`\`\`\`json\n${JSON.stringify(core)}\n\`\`\`\n\`\`\`json\n${JSON.stringify(core)}\n\`\`\``)).toThrow(/more than one/);
  });
});

test("a receipt reads back as it was written", () => {
  const r = { contract: 1 as const, id: "core-types", name: "Core types", version: 1, source: core.source, made: { types: { person: ["email"] }, records: [{ path: "Templates/person/Person", id: "1", updated_at: null }] }, skipped: ["x"] };
  const rec = receiptRecord(r);
  expect(rec.path).toBe("Parachute/Receipts/core-types");
  expect(receiptOf(rec.fields)).toEqual(r);
  expect(receiptOf({ receipt: { id: "x" } })).toBeNull();
});

// applyPack against a stand-in for the hub (the hub is the outside system here; e2e/packs.spec.ts runs a real one):
// types and records in memory, with core's two rules the applier leans on: a taken path is left (if_exists: ignore),
// and a field declared otherwise elsewhere refuses the whole type.
function hub(failOnCreate = -1) {
  const types = new Map<string, Record<string, { type: string; indexed?: boolean }>>();
  const records = new Map<string, { id: string; body: string; fields?: unknown; tags?: string[] }>();
  let creates = 0, n = 0;
  const target: PackTarget = {
    types: async () => [...types].map(([name, fields]) => ({ name, kind: "type" as const, count: 0, fields })),
    defineType: async (name, def) => {
      for (const [f, s] of Object.entries(def.fields)) for (const [o, fs] of types) if (o !== name && fs[f] && (fs[f].type !== s.type || !!fs[f].indexed !== !!s.indexed)) return { refused: "differently" };
      types.set(name, { ...(types.get(name) ?? {}), ...def.fields });
      return "ok";
    },
    create: async (r) => {
      if (creates++ === failOnCreate) throw new Error("the line dropped");
      const had = records.get(r.path);
      if (had) return { id: had.id, updatedAt: "t0", existed: true };
      const id = `r${++n}`; records.set(r.path, { id, body: r.body, fields: r.fields, tags: r.tags });
      return { id, updatedAt: "t0", existed: false };
    },
    receipt: async (id) => { const r = records.get(`Parachute/Receipts/${id}`); return r ? { receipt: (r.fields as { receipt: Receipt }).receipt, id: r.id, updatedAt: "t0" } : null; },
    writeReceipt: async (r) => { const rec = receiptRecord(r); records.set(rec.path, { id: records.get(rec.path)?.id ?? `r${++n}`, body: rec.body, fields: rec.fields, tags: rec.tags }); },
  };
  return { target, types, records };
}

describe("applyPack", () => {
  test("a failure midway still records what was made, so the retry doesn't call the pack's own records the person's", async () => {
    const h = hub(2);
    await expect(applyPack(checkPack(core), h.target)).rejects.toThrow(/line dropped/);
    const half = (await h.target.receipt("core-types"))!.receipt;
    // not the pack's version: the app still offers to finish it
    expect(half.version).toBe(0);
    expect(Object.keys(half.made.types).length).toBe(5);
    expect(half.made.records.map((r) => r.path)).toEqual(["Templates/meeting/Meeting", "Templates/project/Project"]);
    const again = await applyPack(checkPack(core), h.target);
    expect(again.notes).toEqual([]);
    expect((await h.target.receipt("core-types"))!.receipt.made.records.map((r) => r.path)).toEqual(core.records.map((r: { path: string }) => r.path));
    expect((await h.target.receipt("core-types"))!.receipt.version).toBe(1);
  });
  test("a field another type declares otherwise (here: indexed) is left out and said; the rest lands", async () => {
    const h = hub();
    h.types.set("journal", { date: { type: "date", indexed: true } });
    const r = await applyPack(checkPack(core), h.target);
    expect(r.notes).toContain("meeting's date wasn't added: your type journal has a date field of its own, set up differently.");
    expect(Object.keys(h.types.get("meeting")!).sort()).toEqual(["people", "project"]);
    expect(r.receipt.made.records).toHaveLength(core.records.length);
  });
  test("applying twice changes nothing: no write, not even the receipt", async () => {
    const h = hub();
    await applyPack(checkPack(core), h.target);
    let writes = 0;
    const counted: PackTarget = { ...h.target, defineType: async (...a) => { writes++; return h.target.defineType(...a); }, writeReceipt: async (...a) => { writes++; return h.target.writeReceipt(...a); } };
    const again = await applyPack(checkPack(core), counted);
    expect([again.changed, writes, again.added]).toEqual([false, 0, []]);
  });
});

// Parachute's starter packs (T-476 first run: a coach, a reader, people and projects; then Library): a person may add
// them all to one vault, and none may leave out a field of another's (a field one pack declares otherwise than another
// is refused). Library's book is the Reading list's book with more fields, so either may go first.
describe("the starter packs", () => {
  test("each passes, and all four go into one vault in any order with every field", async () => {
    const { STARTERS } = await import("../applet/modules/packs");
    expect(STARTERS.map((p) => p.id)).toEqual(["core-types", "clients", "reading", "library"]);
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2], [2, 3, 0, 1]]) {
      const types = new Map<string, { name: string; kind: "type"; count: number; fields: Record<string, { type?: string }> }>();
      const target: PackTarget = {
        types: async () => [...types.values()],
        defineType: async (name, def) => { const t = types.get(name) ?? { name, kind: "type" as const, count: 0, fields: {} }; Object.assign(t.fields, def.fields); types.set(name, t); return "ok"; },
        create: async (r) => ({ id: r.path, updatedAt: null, existed: false }),
        receipt: async () => null,
        writeReceipt: async () => {},
      };
      for (const i of order) {
        const r = await applyPack(STARTERS[i], target);
        expect(r.notes, `${STARTERS[i].id} after ${order.join(",")}`).toEqual([]);
      }
      for (const p of STARTERS) for (const [t, def] of Object.entries(p.types)) expect(Object.keys(types.get(t)!.fields)).toEqual(expect.arrayContaining(Object.keys(def.fields)));
    }
  });
});
