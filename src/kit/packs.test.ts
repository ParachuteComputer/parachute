// The pack check is the gate between a page's block and the vault: what it lets through is what gets written.
import { describe, expect, test } from "vitest";
import { checkPack, packFromPage, receiptOf, receiptRecord } from "./packs";
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
