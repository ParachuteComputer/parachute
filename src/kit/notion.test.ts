// Import from Notion: what a made-up workspace's export (e2e/fixtures/notion-export.zip, from
// scripts/make-notion-export.py, shaped like a real export) becomes. The parser is the point: each test is a way a real
// export would come out wrong in the vault.
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { notionDate, notionImport, parseCsv } from "./notion";
import { readZip, ZipError } from "./zip";
import { applyPack, type PackTarget, type Receipt } from "./packs";

const zip = () => readFileSync(`${process.cwd()}/e2e/fixtures/notion-export.zip`);
const load = async () => notionImport(await readZip(zip()), "Export-0c5e1b7a-notion.zip");
const rec = (r: Awaited<ReturnType<typeof load>>, path: string) => {
  const x = r.pack.records.find((p) => p.path === path);
  if (!x) throw new Error(`no record ${path}: ${r.pack.records.map((p) => p.path).join(", ")}`);
  return x;
};

describe("readZip", () => {
  test("opens Notion's zip inside the zip, deflated, with UTF-8 names", async () => {
    const files = await readZip(zip());
    const names = [...files.keys()];
    expect(names.some((n) => n.endsWith(".zip"))).toBe(false);
    expect(names).toContain("Export-0c5e1b7a-4f2d-4e1a-9b3c-7d8e9f0a1b2c/Home 8cf04a9734132302f96da8e113e80ce5/Tasks ef615563c8e8ea902c7fcac3cd2c4246/Invoice Little Fern Café 990fd3077d89dadb47367df091e3f051.md");
    expect(new TextDecoder().decode(files.get(names.find((n) => n.endsWith("Rates 62fd280c30b9823d99fa1e3649ef293b.md"))!)!)).toContain("Deposits are half up front.");
  });
  test("says plainly when the file isn't a zip", async () => {
    await expect(readZip(new TextEncoder().encode("not a zip at all, just words"))).rejects.toThrow(ZipError);
  });
  test("one budget for the zip and every zip at its top; a name only once; attachments and unwanted files not unpacked", async () => {
    const inner = (name: string, n: number) => zipOf(name, deflateRawSync(Buffer.alloc(n, 98)), n);
    // two inner zips of 600 bytes each, under a 1000-byte budget: the second is refused, not given a budget of its own
    await expect(readZip(zipOfMany([["Export-1-Part-1.zip", inner("a.md", 600)], ["Export-1-Part-2.zip", inner("b.md", 600)]]), { max: 1000 })).rejects.toThrow(/over/);
    // the same name twice (from two parts) is refused rather than one silently replacing the other
    await expect(readZip(zipOfMany([["Export-1-Part-1.zip", inner("a.md", 10)], ["Export-1-Part-2.zip", inner("a.md", 10)]]))).rejects.toThrow(/twice/);
    // a zip deeper in is an attachment: kept by name, not opened; a file not wanted is named, not unpacked
    const files = await readZip(zipOfMany([["E/page.md", deflateRawSync(Buffer.from("# page"))], ["E/files/old.zip", inner("x.md", 10)], ["E/pic.png", deflateRawSync(Buffer.alloc(50, 1))]], [6, 10 + 98, 50]), { want: (p) => /\.md$/.test(p) });
    expect([...files.keys()].sort()).toEqual(["E/files/old.zip", "E/page.md", "E/pic.png"]);
    expect(files.get("E/pic.png")!.length).toBe(0);
  });
  test("an entry that inflates past the size it claims is refused, not unpacked to the end", async () => {
    const big = deflateRawSync(Buffer.alloc(5_000_000, 97));
    await expect(readZip(zipOf("bomb.md", big, 10))).rejects.toThrow(/bigger than it says/);
    expect(new TextDecoder().decode((await readZip(zipOf("ok.md", deflateRawSync(Buffer.from("hello")), 5))).get("ok.md"))).toBe("hello");
  });
});

describe("notionImport", () => {
  test("a database is a type, its columns fields of the right kind, its rows records with values a vault takes", async () => {
    const r = await load();
    expect(r.found).toEqual({ pages: 9, tables: 4, rows: 82 });
    expect(Object.keys(r.pack.types).sort()).toEqual(["projects", "reading-list", "sketch-log", "tasks"]);
    expect(r.pack.types["reading-list"].fields).toEqual({
      author: { type: "string" }, status: { type: "string" }, rating: { type: "number" }, tags: { type: "array" }, finished: { type: "date" }, notes: { type: "string" },
    });
    expect(r.pack.types.tasks.fields).toEqual({ project: { type: "reference", cardinality: "many" }, due: { type: "date" }, done: { type: "boolean" } });
    // the row keeps its title as its name, and its values as fields: a date as a date, a number as a number, a list
    const book = rec(r, "Notion/Home/Reading List/Piranesi");
    expect(book.types).toEqual(["reading-list"]);
    expect(book.fields).toEqual({ author: "Susanna Clarke", status: "Read", rating: 5, tags: ["Fiction"], finished: "2026-07-07", notes: "The house, the tides. Reread it." });
    // the _all.csv is read, so a row the current view filtered out is still there
    expect(rec(r, "Notion/Home/Reading List/The Creative Act").fields).toMatchObject({ status: "Want to read" });
  });

  test("a relation points at the record the other row became; yes and no are true and false", async () => {
    const r = await load();
    expect(rec(r, "Notion/Home/Tasks/Invoice Little Fern Café").fields).toEqual({ project: ["Notion/Home/Projects/Café menu illustrations"], due: "2026-09-30", done: true });
    expect(rec(r, "Notion/Home/Projects/Zine: Night Birds").fields?.tasks).toEqual(["Notion/Home/Tasks/Pick paper for the zine", "Notion/Home/Tasks/Scan the owl drawings"]);
  });

  test("a row's page gives its words, without its title or the properties the table holds", async () => {
    const r = await load();
    expect(rec(r, "Notion/Home/Projects/Harbor Books cover").body).toBe("Cover for a poetry book, three sketches first.\n");
  });

  test("a page whose title says the day otherwise (\"@Today\") is still its row's: one record, the row's name, the page's words", async () => {
    const r = await load();
    const today = rec(r, "Notion/Home/Sketch log/@November 21, 2026");
    expect(today).toMatchObject({ types: ["sketch-log"], fields: { drew: false, minutes: 29, subject: "Owls" }, body: "Day 70: owl wings, three tries.\n" });
    expect(rec(r, "Notion/Home/Sketch log/@November 20, 2026").body).toBe("Day 69: heron legs.\n");
    expect(r.pack.records.filter((x) => /@(Today|Yesterday)/.test(x.path))).toEqual([]);
    expect(r.pack.records.filter((x) => x.path.startsWith("Notion/Home/Sketch log/"))).toHaveLength(70);
  });

  test("odd titles still land: a name ending like code, and pages nested deep with long names", async () => {
    const r = await load();
    expect(rec(r, "Notion/Next.js notes").body).toContain("portfolio");
    const deep = r.pack.records.find((x) => x.body.includes("Old things.") && x.path.split("/").length === 4)!;
    expect(deep.path.length).toBeLessThanOrEqual(200);
    const odd = new Map([["E/notes.js 0123456789abcdef0123456789abcdef.md", new TextEncoder().encode("# notes.js\n\nhi\n")]]);
    expect(notionImport(odd).pack.records.map((x) => x.path)).toEqual(["Notion/notes-js"]);
  });

  test("a cut path never ends like code; a title with a wikilink's marks still links", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const long = "a".repeat(79), id = "0123456789abcdef0123456789abcdef";
    const page = `${"x".repeat(20)}.js ${"y".repeat(56)}`;
    const r = notionImport(new Map([[`E/${long} ${id}/${long} ${id}/${page} ${id}.md`, enc("# p\n\nhi\n")], [`E/Sprint #12 | Q3 ${id}.md`, enc("# Sprint #12 | Q3\n\nplan\n")], [`E/Home ${id}.md`, enc(`# Home\n\n[Sprint](Sprint%20%2312%20%7C%20Q3%20${id}.md)\n`)]]));
    for (const x of r.pack.records) expect(x.path.length).toBeLessThanOrEqual(200);
    expect(r.pack.records.find((x) => x.path === "Notion/Home")!.body).toContain("[[Notion/Sprint -12 - Q3|Sprint]]");
  });

  test("a row whose page says another title is matched by its properties, relations included", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const P = "Projects 1111111111111111111111111111111a", T = "Tasks 2222222222222222222222222222222b", pid = "3333333333333333333333333333333c";
    const r = notionImport(new Map([
      [`E/${P}_all.csv`, enc(`Name\r\nCover\r\n`)],
      [`E/${P}/Cover ${pid}.md`, enc("# Cover\n")],
      [`E/${T}_all.csv`, enc(`Name,Project,Due\r\n"@November 21, 2026",Cover (${encodeURIComponent(P)}/Cover%20${pid}.md),"November 21, 2026"\r\n`)],
      [`E/${T}/@Today 4444444444444444444444444444444d.md`, enc(`# @Today\n\nProject: Cover (../${encodeURIComponent(P)}/Cover%20${pid}.md)\nDue: November 21, 2026\n\nSend it.\n`)],
    ]));
    expect(r.found).toEqual({ pages: 0, tables: 2, rows: 2 });
    expect(r.pack.records.find((x) => x.path === "Notion/Tasks/@November 21, 2026")).toMatchObject({ fields: { project: ["Notion/Projects/Cover"], due: "2026-11-21" }, body: "Send it.\n" });
  });

  test("a column of one name in two tables, of two kinds, is text in both: the vault would refuse one type", () => {
    const csv = (rows: string) => new TextEncoder().encode(`\ufeffName,Tags\r\n${rows}`);
    const two = notionImport(new Map([
      ["E/A 0123456789abcdef0123456789abcdef_all.csv", csv('a,"x, y"\r\n')],
      ["E/B 1123456789abcdef0123456789abcdef_all.csv", csv("b,a sentence. With a stop.\r\n")],
    ]));
    expect(two.pack.types.a.fields.tags).toEqual({ type: "string" });
    expect(two.pack.types.b.fields.tags).toEqual({ type: "string" });
    expect(two.pack.records.find((x) => x.path === "Notion/A/a")?.fields).toEqual({ tags: "x, y" });
    // a number with a decimal comma isn't a list
    const dec = notionImport(new Map([["E/C 2123456789abcdef0123456789abcdef_all.csv", new TextEncoder().encode('Name,Score\r\nc,"1,5"\r\nd,"2,25"\r\n')]]));
    expect(dec.pack.types.c.fields.score).toEqual({ type: "string" });
  });

  test("pages keep their place, their links become wikilinks, and an image is said, not lost silently", async () => {
    const r = await load();
    const home = rec(r, "Notion/Home");
    expect(home.types ?? []).toEqual([]);
    expect(home.body).toContain("[[Notion/Home/Meeting notes]]");
    expect(home.body).toContain("[[Notion/Home/Reading List]]");
    expect(home.body).not.toMatch(/%20|[0-9a-f]{32}/);
    // a relation written into a page as text links too
    expect(rec(r, "Notion/Home/Meeting notes/Kickoff with Harbor Books").body).toContain("Project: [[Notion/Home/Projects/Harbor Books cover]]");
    const ideas = rec(r, "Notion/Home/Ideas").body;
    expect(ideas).toContain("- [ ] A print series of city birds");
    expect(ideas).toContain("image owl-sketch.png");
    expect(r.left).toEqual(["Home 8cf04a9734132302f96da8e113e80ce5/Ideas d46ef9e7211d041671cdbe6c3d884884/owl-sketch.png"]);
    // a linked view (a .csv the export doesn't hold) is said to be missing, not to have stayed
    expect(home.body).toContain("Open tasks *(not in your Notion export)*");
    expect(home.body).toContain("[[Notion/Home/Sketch log]]");
    // the table that held the rows has a record at its place, so a link to it lands somewhere
    expect(rec(r, "Notion/Home/Reading List").body).toContain("reading-list");
    // the export's own wrapping isn't the person's: no Export-… folder, no index page
    expect(r.pack.records.every((x) => x.path.startsWith("Notion/") && !x.path.includes("Export-") && !/index/i.test(x.path))).toBe(true);
  });

  test("the same export is the same pack (its receipt), so bringing it in again changes nothing", async () => {
    const a = await load(), b = await load();
    expect(a.pack.id).toBe(b.pack.id);
    const vault = memoryVault();
    expect((await applyPack(a.pack, vault)).changed).toBe(true);
    const n = vault.records.size;
    const again = await applyPack(b.pack, vault);
    expect(again.changed).toBe(false);
    expect(vault.records.size).toBe(n);
    // another export (one page more) is another pack
    const files = await readZip(zip());
    files.set("Export-0c5e1b7a-4f2d-4e1a-9b3c-7d8e9f0a1b2c/Later 0123456789abcdef0123456789abcdef.md", new TextEncoder().encode("# Later\n\nA new page.\n"));
    expect(notionImport(files).pack.id).not.toBe(a.pack.id);
  });

  test("a zip with no Notion pages in it says what to do", () => {
    expect(() => notionImport(new Map([["photo.png", new Uint8Array([1])]]))).toThrow(/Markdown & CSV/);
  });
});

test("parseCsv: Notion's byte order mark, quotes, commas and line breaks inside a value", () => {
  expect(parseCsv('﻿Name,Notes\r\n"A, b","said ""hi""\nthen left"\r\nC,\r\n')).toEqual([["Name", "Notes"], ["A, b", 'said "hi"\nthen left'], ["C", ""]]);
});

test("notionDate: the ways Notion writes a date, its first day; anything else is not one", () => {
  expect(notionDate("March 2, 2026")).toBe("2026-03-02");
  expect(notionDate("Dec 4, 2024 8:45 AM")).toBe("2024-12-04");
  expect(notionDate("@December 1, 2024")).toBe("2024-12-01");
  expect(notionDate("November 3, 2026 → November 5, 2026")).toBe("2026-11-03");
  expect(notionDate("2026/11/03")).toBe("2026-11-03");
  for (const no of ["Read", "13/45/2026", "Smarch 3, 2026", "5"]) expect(notionDate(no), no).toBeNull();
});

/** A vault in memory, as the applier sees one: types, records at free paths, the receipt. */
function memoryVault(): PackTarget & { records: Map<string, unknown> } {
  const types = new Map<string, Record<string, unknown>>(), records = new Map<string, unknown>();
  let receipt: { receipt: Receipt; id: string; updatedAt: string | null } | null = null;
  return {
    records,
    types: async () => [...types].map(([name, fields]) => ({ name, kind: "type" as const, count: 0, fields: fields as never })),
    defineType: async (name, def) => { types.set(name, { ...(types.get(name) ?? {}), ...def.fields }); return "ok"; },
    create: async (r) => { const existed = records.has(r.path); if (!existed) records.set(r.path, r); return { id: r.path, updatedAt: null, existed }; },
    receipt: async () => receipt,
    writeReceipt: async (r) => { receipt = { receipt: r, id: "receipt", updatedAt: null }; },
  };
}

/** A zip of one deflated entry whose header says it unpacks to `size` bytes. */
function zipOf(name: string, data: Uint8Array, size: number): Uint8Array {
  const n = new TextEncoder().encode(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x800, 8); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(size, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const at = 30 + n.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(at, 16);
  return new Uint8Array(Buffer.concat([local, n, data, cd, n, end]));
}

/** A zip of several entries: deflated ones (data from deflateRawSync, with their unpacked sizes), or stored inner zips. */
function zipOfMany(entries: [string, Uint8Array][], sizes?: number[]): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let at = 0;
  entries.forEach(([name, data], i) => {
    const n = Buffer.from(name), stored = name.endsWith(".zip") && !sizes, method = stored ? 0 : 8, size = sizes ? sizes[i] : data.length;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x800, 8); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(size, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(at, 42);
    parts.push(local, n, Buffer.from(data)); central.push(cd, n);
    at += 30 + n.length + data.length;
  });
  const cdLen = central.reduce((x, b) => x + b.length, 0);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cdLen, 12); end.writeUInt32LE(at, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}
