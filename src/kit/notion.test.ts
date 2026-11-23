// Import from Notion: what a made-up workspace's export (e2e/fixtures/notion-export.zip, from
// scripts/make-notion-export.py, shaped like a real export) becomes. The parser is the point: each test is a way a real
// export would come out wrong in the vault.
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { applyNotion, ATTACHMENT_MAX, notionDate, notionImport, notionWant, parseCsv, workspaceFromIndex, type Held, type NotionTarget } from "./notion";
import { readZip, ZipError } from "./zip";
import { applyPack, type Receipt } from "./packs";

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
    // many entries naming the same big inner zip: refused once their unpacking passes the budget, not done each time
    await expect(readZip(zipOfMany([["Export-1-Part-1.zip", inner("a.md", 600)], ["Export-1-Part-2.zip", inner("b.md", 600)], ["Export-1-Part-3.zip", inner("c.md", 600)]]), { max: 300, want: () => false })).rejects.toThrow(/over/);
  });
  test("an entry that claims to make nothing still costs what it reads: many of them are refused, not read for minutes", async () => {
    // empty stored deflate blocks: 1000 bytes of input that make nothing
    const empty = new Uint8Array(1000); for (let i = 0; i < 995; i += 5) empty.set([0, 0, 0, 0xff, 0xff], i);
    empty.set([1, 0, 0, 0xff, 0xff], 995);
    const entries: [string, Uint8Array][] = Array.from({ length: 5 }, (_, i) => [`e${i}.md`, empty]);
    await expect(readZip(zipOfMany(entries, entries.map(() => 0)), { max: 3000 })).rejects.toThrow(/over/);
  });
  test("a file name over 1 KB is refused: names would fill memory as keys at no cost", async () => {
    await expect(readZip(zipOfMany([[`${"n".repeat(2000)}.md`, deflateRawSync(Buffer.from("x"))]], [1]))).rejects.toThrow(/over 1 KB/);
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
    expect(r.found).toEqual({ pages: 9, tables: 4, rows: 82, files: 1 });
    expect(Object.keys(r.pack.types).sort()).toEqual(["projects", "reading-list", "sketch-log", "tasks"]);
    expect(r.pack.types["reading-list"].fields).toEqual({
      author: { type: "string" }, status: { type: "string" }, rating: { type: "number" }, tags: { type: "array" }, finished: { type: "date" }, notes: { type: "string" },
    });
    expect(r.pack.types.tasks.fields).toEqual({ project: { type: "reference", cardinality: "many" }, due: { type: "date" }, done: { type: "boolean" } });
    // the row keeps its title as its name, and its values as fields: a date as a date, a number as a number, a list
    const book = rec(r, "Notion/Juno's studio/Home/Reading List/Piranesi");
    expect(book.types).toEqual(["reading-list"]);
    expect(book.fields).toEqual({ author: "Susanna Clarke", status: "Read", rating: 5, tags: ["Fiction"], finished: "2026-07-07", notes: "The house, the tides. Reread it." });
    // the _all.csv is read, so a row the current view filtered out is still there
    expect(rec(r, "Notion/Juno's studio/Home/Reading List/The Creative Act").fields).toMatchObject({ status: "Want to read" });
  });

  test("a relation points at the record the other row became; yes and no are true and false", async () => {
    const r = await load();
    expect(rec(r, "Notion/Juno's studio/Home/Tasks/Invoice Little Fern Café").fields).toEqual({ project: ["Notion/Juno's studio/Home/Projects/Café menu illustrations"], due: "2026-09-30", done: true });
    expect(rec(r, "Notion/Juno's studio/Home/Projects/Zine: Night Birds").fields?.tasks).toEqual(["Notion/Juno's studio/Home/Tasks/Pick paper for the zine", "Notion/Juno's studio/Home/Tasks/Scan the owl drawings"]);
  });

  test("a row's page gives its words, without its title or the properties the table holds", async () => {
    const r = await load();
    expect(rec(r, "Notion/Juno's studio/Home/Projects/Harbor Books cover").body).toBe("Cover for a poetry book, three sketches first.\n");
  });

  test("a page whose title says the day otherwise (\"@Today\") is still its row's: one record, the row's name, the page's words", async () => {
    const r = await load();
    const today = rec(r, "Notion/Juno's studio/Home/Sketch log/@November 21, 2026");
    expect(today).toMatchObject({ types: ["sketch-log"], fields: { drew: false, minutes: 29, subject: "Owls" }, body: "Day 70: owl wings, three tries.\n" });
    expect(rec(r, "Notion/Juno's studio/Home/Sketch log/@November 20, 2026").body).toBe("Day 69: heron legs.\n");
    expect(r.pack.records.filter((x) => /@(Today|Yesterday)/.test(x.path))).toEqual([]);
    expect(r.pack.records.filter((x) => x.path.startsWith("Notion/Juno's studio/Home/Sketch log/"))).toHaveLength(70);
  });

  test("odd titles still land: a name ending like code, and pages nested deep with long names", async () => {
    const r = await load();
    expect(rec(r, "Notion/Juno's studio/Next.js notes").body).toContain("portfolio");
    const deep = r.pack.records.find((x) => x.body.includes("Old things.") && x.path.split("/").length === 5)!;
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
    const paren = notionImport(new Map([[`E/Notes (weekly) ${id}.md`, enc("# Notes (weekly)\n\nx\n")], [`E/Index ${id.replace("0", "1")}.md`, enc(`# Index\n\n[Notes](Notes%20(weekly)%20${id}.md)\n`)]]));
    expect(paren.pack.records.find((x) => x.path === "Notion/Index")!.body).toContain("[[Notion/Notes (weekly)|Notes]]");
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
    expect(r.found).toEqual({ pages: 0, tables: 2, rows: 2, files: 0 });
    expect(r.pack.records.find((x) => x.path === "Notion/Tasks/@November 21, 2026")).toMatchObject({ fields: { project: ["Notion/Projects/Cover"], due: "2026-11-21" }, body: "Send it.\n" });
  });

  test("a relation to a page whose title has a comma (a date) is still a relation", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const M = "Meetings 5555555555555555555555555555555e", N = "Notes 6666666666666666666666666666666f", id = "7777777777777777777777777777777a", id2 = "8888888888888888888888888888888b";
    const r = notionImport(new Map([
      [`E/${M}_all.csv`, enc("Name\r\nNovember 21, 2026\r\nKickoff (v2)\r\n")],
      [`E/${M}/November 21, 2026 ${id}.md`, enc("# November 21, 2026\n")],
      [`E/${M}/Kickoff (v2) ${id2}.md`, enc("# Kickoff (v2)\n")],
      [`E/${N}_all.csv`, enc(`Name,Meeting\r\na,"November 21, 2026 (${encodeURIComponent(M)}/November%2021%2C%202026%20${id}.md), Kickoff (v2) (${encodeURIComponent(M)}/Kickoff%20(v2)%20${id2}.md)"\r\nb,Kickoff (v2) (${encodeURIComponent(M)}/Kickoff%20(v2)%20${id2}.md)\r\n`)],
    ]));
    expect(r.pack.types.notes.fields.meeting).toEqual({ type: "reference", cardinality: "many" });
    expect(r.pack.records.find((x) => x.path === "Notion/Notes/a")?.fields).toEqual({ meeting: ["Notion/Meetings/November 21, 2026", "Notion/Meetings/Kickoff (v2)"] });
  });

  test("a relation to a page outside the export keeps its title, not a notion.so link that reads like a path", () => {
    const r = notionImport(new Map([["E/Tasks 9999999999999999999999999999999c_all.csv", new TextEncoder().encode("Name,Project\r\nx,Gone project (https://www.notion.so/Gone-project-0000000000000000000000000000000a?pvs=21)\r\n")]]));
    expect(r.pack.records.find((x) => x.path === "Notion/Tasks/x")?.fields).toEqual({ project: ["Gone project"] });
  });

  test("names stay clear of the vault's own types; a name with a comma isn't a list; a leading zero isn't a number", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const r = notionImport(new Map([["E/Book 1111111111111111111111111111111d_all.csv", enc('Name,Author,Zip,Date\r\na,"Le Guin, Ursula",02134,next week\r\nb,"Butler, Octavia",01002,soon\r\n')]]), "x",
      [{ name: "book", fields: { author: { type: "string" } } }, { name: "meeting", fields: { date: { type: "date" } } }]);
    expect(Object.keys(r.pack.types)).toEqual(["book-2"]);
    expect(r.pack.types["book-2"].fields).toEqual({ author: { type: "string" }, zip: { type: "string" }, date_2: { type: "string" } });
    expect(r.pack.records.find((x) => x.path === "Notion/Book/a")?.fields).toEqual({ author: "Le Guin, Ursula", zip: "02134", date_2: "next week" });
  });

  test("a type an import made is the table's again: a newer export of the same workspace adds to it, renames nothing", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const fitting = notionImport(new Map([["E/Book 2222222222222222222222222222222d_all.csv", enc("Name,Rating,Shelf\r\nc,5,top\r\n")]]), "newer",
      [{ name: "book", description: "From Notion: Book.", fields: { rating: { type: "number" } } }, { name: "shelf-type", description: null, fields: { shelf: { type: "string", indexed: true } } }]);
    expect(Object.keys(fitting.pack.types)).toEqual(["book"]);
    // its own earlier field isn't another's (no rating_2); a field the person indexed elsewhere is
    expect(Object.keys(fitting.pack.types.book.fields)).toEqual(["rating", "shelf_2"]);
    expect(rec(fitting, "Notion/Book/c").fields).toEqual({ rating: 5, shelf_2: "top" });
    // a value with a leading zero ("05") doesn't fit number: kept in rating_text with a note, never written as a string to rating
    const nonFit = notionImport(new Map([["E/Book 2222222222222222222222222222222d_all.csv", enc("Name,Rating,Shelf\r\nc,05,top\r\n")]]), "newer",
      [{ name: "book", description: "From Notion: Book.", fields: { rating: { type: "number" } } }, { name: "shelf-type", description: null, fields: { shelf: { type: "string", indexed: true } } }]);
    expect(Object.keys(nonFit.pack.types.book.fields)).toEqual(["rating", "rating_text", "shelf_2"]);
    expect(rec(nonFit, "Notion/Book/c").fields).toEqual({ rating_text: "05", shelf_2: "top" });
    expect(nonFit.notes.some((n) => n.includes("Rating") && n.includes("rating_text"))).toBe(true);
  });

  test("a column named Tags is a list even when no tag repeats; a used tag's name is taken; a field named Constructor is just a field", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const r = notionImport(new Map([["E/Reading 8888888888888888888888888888888e_all.csv", enc('Name,Tags,Constructor\r\na,"urgent, home",x\r\nb,"work, errands",y\r\n')]]), "x",
      [{ name: "reading", description: null, fields: {} }, { name: "other", description: null, fields: { author: { type: "string" } } }]);
    expect(Object.keys(r.pack.types)).toEqual(["reading-2"]);
    expect(r.pack.types["reading-2"].fields).toEqual({ tags: { type: "array" }, constructor: { type: "string" } });
  });

  test("another import's types count in a clash; two tables of one title each find their own type again", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const files = new Map([
      ["E/A 3333333333333333333333333333333a/Tasks 4444444444444444444444444444444a_all.csv", enc("Name,Owner\r\nx,me\r\n")],
      ["E/B 5555555555555555555555555555555b/Tasks 6666666666666666666666666666666b_all.csv", enc("Name,Due\r\ny,soon\r\n")],
      ["E/Books 7777777777777777777777777777777c_all.csv", enc("Name,Status\r\nz,read\r\n")],
    ]);
    const first = notionImport(files);
    expect(Object.keys(first.pack.types).sort()).toEqual(["books", "tasks", "tasks-2"]);
    const held = Object.entries(first.pack.types).map(([name, t]) => ({ name, description: t.description, fields: t.fields as Record<string, { type?: string }> }));
    // the same export again: the same names, each table on its own type
    expect(notionImport(files, "again", held).pack.types).toEqual(first.pack.types);
    // another workspace's import made projects with a number status: a new table's text status is its own field
    const other = notionImport(new Map([["E/Books 7777777777777777777777777777777c_all.csv", enc("Name,Status\r\nz,read\r\n")]]), "x",
      [{ name: "projects", description: "From Notion: Projects.", fields: { status: { type: "number" } } }]);
    expect(Object.keys(other.pack.types.books.fields)).toEqual(["status_2"]);
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

  test("pages keep their place, their links become wikilinks, and images become vault attachments with rewritten links", async () => {
    const r = await load();
    const home = rec(r, "Notion/Juno's studio/Home");
    expect(home.types ?? []).toEqual([]);
    expect(home.body).toContain("[[Notion/Juno's studio/Home/Meeting notes]]");
    expect(home.body).toContain("[[Notion/Juno's studio/Home/Reading List]]");
    expect(home.body).not.toMatch(/%20|[0-9a-f]{32}/);
    // a relation written into a page as text links too
    expect(rec(r, "Notion/Juno's studio/Home/Meeting notes/Kickoff with Harbor Books").body).toContain("Project: [[Notion/Juno's studio/Home/Projects/Harbor Books cover]]");
    expect(r.skipped).toEqual([]);
    expect(r.attachments.get("Notion/Juno's studio/Home/Ideas")?.map((a) => [a.name, a.mimeType])).toEqual([["owl-sketch.png", "image/png"]]);
    const vault = memoryVault();
    const applied = await applyNotion(r, vault);
    expect(applied.attached).toBe(1);
    const ideas = (vault.records.get("Notion/Juno's studio/Home/Ideas") as { body: string }).body;
    expect(ideas).toContain("- [ ] A print series of city birds");
    expect(ideas).toContain("![owl sketch](/api/storage/uploads/owl-sketch.png)");
    expect(vault.attached.get("Notion/Juno's studio/Home/Ideas")).toEqual([{ path: "uploads/owl-sketch.png", mimeType: "image/png" }]);
    // a linked view (a .csv the export doesn't hold) is said to be missing, not to have stayed
    expect(home.body).toContain("Open tasks *(not in your Notion export)*");
    expect(home.body).toContain("[[Notion/Juno's studio/Home/Sketch log]]");
    // the table that held the rows has a record at its place, so a link to it lands somewhere
    expect(rec(r, "Notion/Juno's studio/Home/Reading List").body).toContain("reading-list");
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

  test("images and attachments become vault attachments on their record with body links rewritten; re-import uploads nothing", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const pdf = new TextEncoder().encode("%PDF-1.4\nhello\n");
    const bonus = new TextEncoder().encode("%PDF-1.4\nbonus\n");
    const id1 = "11111111111111111111111111111111", id2 = "22222222222222222222222222222222", id3 = "33333333333333333333333333333333";
    const inner = zipOfMany([
      ["Export-1/index.html", deflateRawSync(Buffer.from("<html><body><p>Workspace name: Field Notes</p></body></html>"))],
      [`Export-1/Ideas ${id1}.md`, deflateRawSync(Buffer.from(`# Ideas\n\n![owl sketch](Ideas%20${id1}/owl%20(1).png)\n\n[Project brief](Ideas%20${id1}/Project%20brief.pdf)\n`))],
      [`Export-1/Ideas ${id1}/owl (1).png`, deflateRawSync(Buffer.from(png))],
      [`Export-1/Ideas ${id1}/Project brief.pdf`, deflateRawSync(Buffer.from(pdf))],
      [`Export-1/Ideas ${id1}/extra.pdf`, deflateRawSync(Buffer.from(bonus))],
      [`Export-1/Tasks ${id2}_all.csv`, deflateRawSync(Buffer.from("Name,Done\r\nDraw bird,No\r\n"))],
      [`Export-1/Tasks ${id2}/Draw bird ${id3}.md`, deflateRawSync(Buffer.from(`# Draw bird\n\nDone: No\n\n![draft](Draw%20bird%20${id3}/draft.png)\n`))],
      [`Export-1/Tasks ${id2}/Draw bird ${id3}/draft.png`, deflateRawSync(Buffer.from(png))],
    ], [
      Buffer.from("<html><body><p>Workspace name: Field Notes</p></body></html>").length,
      Buffer.from(`# Ideas\n\n![owl sketch](Ideas%20${id1}/owl%20(1).png)\n\n[Project brief](Ideas%20${id1}/Project%20brief.pdf)\n`).length,
      png.length, pdf.length, bonus.length,
      Buffer.from("Name,Done\r\nDraw bird,No\r\n").length,
      Buffer.from(`# Draw bird\n\nDone: No\n\n![draft](Draw%20bird%20${id3}/draft.png)\n`).length,
      png.length,
    ]);
    const outer = zipOfMany([["Export-1-Part-1.zip", inner]]);
    const skippedSizes = new Map<string, number>();
    const files = await readZip(outer, { want: notionWant(), onSkip: (p, sz) => skippedSizes.set(p, sz) });
    const imp = notionImport(files, "Export-1.zip", [], { skippedSizes });
    expect(imp.skipped.map((s) => s.path)).toEqual([]);
    expect(imp.found.files).toBe(4);
    const vault = memoryVault();
    const res = await applyNotion(imp, vault);
    expect(res.changed).toBe(true);
    expect(res.attached).toBe(4);
    expect(res.left).toEqual([]);
    // Ideas record has 3 vault attachments (owl (1).png, Project brief.pdf, extra.pdf) and rewritten links
    const ideas = vault.records.get("Notion/Field Notes/Ideas") as { body: string };
    expect(ideas.body).toContain("![owl sketch](/api/storage/uploads/owl%20%281%29.png)");
    expect(ideas.body).toContain("[Project brief](/api/storage/uploads/Project%20brief.pdf)");
    expect(vault.attached.get("Notion/Field Notes/Ideas")?.map((a) => [a.path, a.mimeType])).toEqual([
      ["uploads/owl (1).png", "image/png"],
      ["uploads/Project brief.pdf", "application/pdf"],
      ["uploads/extra.pdf", "application/pdf"],
    ]);
    // Row page also gets its attachment with body link rewritten
    const row = vault.records.get("Notion/Field Notes/Tasks/Draw bird") as { body: string };
    expect(row.body).toContain("![draft](/api/storage/uploads/draft.png)");
    expect(vault.attached.get("Notion/Field Notes/Tasks/Draw bird")).toEqual([{ path: "uploads/draft.png", mimeType: "image/png" }]);
    // Importing the same export again uploads and attaches nothing
    const uploadsBefore = vault.uploads.length;
    const again = await applyNotion(notionImport(files, "Export-1.zip", [], { skippedSizes }), vault);
    expect(again.changed).toBe(false);
    expect(again.attached).toBe(0);
    expect(vault.uploads.length).toBe(uploadsBefore);
  });

  test("oversized, empty, and over-budget attachments are skipped with plain messages while smaller files still land", async () => {
    const id = "44444444444444444444444444444444";
    const okPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const big = new Uint8Array(2048).fill(7);
    const second = new Uint8Array(900).fill(8);
    const empty = new Uint8Array(0);
    const md = `# Gallery\n\n![ok](Gallery%20${id}/ok.png)\n\n![huge](Gallery%20${id}/huge.png)\n\n[zero](Gallery%20${id}/empty.pdf)\n\n![over](Gallery%20${id}/over.png)\n`;
    const z = zipOfMany([
      [`E/Gallery ${id}.md`, deflateRawSync(Buffer.from(md))],
      [`E/Gallery ${id}/ok.png`, deflateRawSync(Buffer.from(okPng))],
      [`E/Gallery ${id}/huge.png`, deflateRawSync(Buffer.from(big))],
      [`E/Gallery ${id}/empty.pdf`, deflateRawSync(Buffer.from(empty))],
      [`E/Gallery ${id}/over.png`, deflateRawSync(Buffer.from(second))],
    ], [Buffer.from(md).length, okPng.length, big.length, empty.length, second.length]);
    const skippedSizes = new Map<string, number>();
    const files = await readZip(z, { want: notionWant({ maxFile: 1024, maxTotal: 500 }), onSkip: (p, sz) => skippedSizes.set(p, sz) });
    // oversized and over-budget entries were never unpacked by readZip
    expect(files.get(`E/Gallery ${id}/huge.png`)!.length).toBe(0);
    expect(files.get(`E/Gallery ${id}/over.png`)!.length).toBe(0);
    const imp = notionImport(files, "Gallery.zip", [], { skippedSizes, maxFile: 1024, maxTotal: 500 });
    expect(imp.found.files).toBe(1);
    expect(imp.skipped.map((s) => s.name)).toEqual(["huge.png", "empty.pdf", "over.png"]);
    expect(imp.notes.some((n) => n.includes("huge.png") && /limit/i.test(n))).toBe(true);
    expect(imp.notes.some((n) => n.includes("empty.pdf") && /empty/i.test(n))).toBe(true);
    expect(imp.notes.some((n) => n.includes("over.png") && /limit/i.test(n))).toBe(true);
    const vault = memoryVault();
    const res = await applyNotion(imp, vault);
    expect(res.attached).toBe(1);
    const body = (vault.records.get("Notion/Gallery") as { body: string }).body;
    expect(body).toContain("![ok](/api/storage/uploads/ok.png)");
    expect(body).toContain("huge.png");
    expect(body).toMatch(/skipped/i);
    expect(ATTACHMENT_MAX).toBe(25 * 1024 * 1024);
  });

  test("column whose kind changed between exports puts non-fitting values in a text field with a summary note, never silently dropped", async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const b1 = "55555555555555555555555555555555", b2 = "66666666666666666666666666666666";
    // Export 1: Rating is number, Due is date, Done is boolean, Tags is array
    const firstFiles = new Map([
      ["E/index.html", enc("<html><body><p>Workspace name: Studio</p></body></html>")],
      [`E/Books ${b1}_all.csv`, enc('Name,Rating,Due,Done,Tags\r\nPiranesi,5,"July 7, 2026",Yes,"Fiction, Nature"\r\nDune,4,"August 1, 2026",No,"Fiction, Sci-Fi"\r\n')],
    ]);
    const first = notionImport(firstFiles, "Studio-1.zip");
    const vault = memoryVault();
    await applyNotion(first, vault);
    const held = await vault.types();
    // Export 2: newer export of the same workspace where Rating has "five stars" alongside 5,
    // Due has "next spring" alongside a valid date, Done has "maybe", Tags has a prose sentence
    const secondFiles = new Map([
      ["E/index.html", enc("<html><body><p>Workspace name: Studio</p></body></html>")],
      [`E/Books ${b2}_all.csv`, enc('Name,Rating,Due,Done,Tags\r\nNew Book,five stars,next spring,maybe,A whole sentence about this book.\r\nGood Book,5,"September 2, 2026",Yes,"Fiction, Craft"\r\n')],
    ]);
    const second = notionImport(secondFiles, "Studio-2.zip", held);
    expect(Object.keys(second.pack.types)).toEqual(["books"]);
    expect(second.pack.types.books.fields).toMatchObject({
      rating: { type: "number" },
      rating_text: { type: "string" },
      due: { type: "date" },
      due_text: { type: "string" },
      done: { type: "boolean" },
      done_text: { type: "string" },
      tags: { type: "array" },
      tags_text: { type: "string" },
    });
    // Fitting row goes into the typed fields; non-fitting row goes into the text fields (never dropped, never wrong type!)
    expect(rec(second, "Notion/Studio/Books/New Book").fields).toEqual({
      rating_text: "five stars",
      due_text: "next spring",
      done_text: "maybe",
      tags_text: "A whole sentence about this book.",
    });
    expect(rec(second, "Notion/Studio/Books/Good Book").fields).toEqual({
      rating: 5,
      due: "2026-09-02",
      done: true,
      tags: ["Fiction", "Craft"],
    });
    expect(second.notes.some((n) => n.includes("Rating") && n.includes("rating_text"))).toBe(true);
    expect(second.notes.some((n) => n.includes("Due") && n.includes("due_text"))).toBe(true);
    expect(second.notes.some((n) => n.includes("Done") && n.includes("done_text"))).toBe(true);
    expect(second.notes.some((n) => n.includes("Tags") && n.includes("tags_text"))).toBe(true);
    const applied2 = await applyNotion(second, vault);
    expect(applied2.changed).toBe(true);
    expect(applied2.notes.some((n) => n.includes("rating_text"))).toBe(true);
    // the same export again writes nothing, so it says nothing of values written
    const applied3 = await applyNotion(notionImport(secondFiles, "Studio-2.zip", await vault.types()), vault);
    expect(applied3.changed).toBe(false);
    expect(applied3.notes.filter((n) => n.includes("_text"))).toEqual([]);
  });

  test("same-titled tables from different workspaces get distinct types named by workspace, while re-imports of each workspace reuse their own", async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const workZip = zipOfMany([
      ["Export-w/index.html", deflateRawSync(Buffer.from("<html><body><p>Workspace name: Work</p></body></html>"))],
      ["Export-w/Tasks aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_all.csv", deflateRawSync(Buffer.from("Name,Owner\r\nShip release,Sam\r\n"))],
    ], [
      Buffer.from("<html><body><p>Workspace name: Work</p></body></html>").length,
      Buffer.from("Name,Owner\r\nShip release,Sam\r\n").length,
    ]);
    const personalZip = zipOfMany([
      ["Export-p/index.html", deflateRawSync(Buffer.from("<html><body><p>Workspace name: Personal</p></body></html>"))],
      ["Export-p/Tasks bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_all.csv", deflateRawSync(Buffer.from("Name,Priority\r\nBuy soil,1\r\n"))],
      ["Export-p/Recipes cccccccccccccccccccccccccccccccc_all.csv", deflateRawSync(Buffer.from("Name,Minutes\r\nSoup,30\r\n"))],
    ], [
      Buffer.from("<html><body><p>Workspace name: Personal</p></body></html>").length,
      Buffer.from("Name,Priority\r\nBuy soil,1\r\n").length,
      Buffer.from("Name,Minutes\r\nSoup,30\r\n").length,
    ]);
    const vault = memoryVault();
    const work1 = notionImport(await readZip(workZip, { want: notionWant() }), "Work-1.zip");
    expect(Object.keys(work1.pack.types)).toEqual(["tasks"]);
    expect(work1.pack.types.tasks.description).toBe("From Notion (Work): Tasks.");
    await applyNotion(work1, vault);

    // Personal workspace also has Tasks -> distinct type named by workspace, NOT sharing Work's `tasks`!
    const personal1 = notionImport(await readZip(personalZip, { want: notionWant() }), "Personal-1.zip", await vault.types());
    expect(Object.keys(personal1.pack.types).sort()).toEqual(["personal-tasks", "recipes"]);
    expect(personal1.pack.types["personal-tasks"].description).toBe("From Notion (Personal): Tasks.");
    expect(rec(personal1, "Notion/Personal/Tasks/Buy soil").types).toEqual(["personal-tasks"]);
    await applyNotion(personal1, vault);

    // Re-importing Work reuses `tasks`, re-importing Personal reuses `personal-tasks`
    const work2 = notionImport(new Map([
      ["Export-w2/index.html", enc("<html><body><p>Workspace name: Work</p></body></html>")],
      ["Export-w2/Tasks aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_all.csv", enc("Name,Owner\r\nPlan Q4,Alex\r\n")],
    ]), "Work-2.zip", await vault.types());
    expect(Object.keys(work2.pack.types)).toEqual(["tasks"]);

    const personal2 = notionImport(new Map([
      ["Export-p2/index.html", enc("<html><body><p>Workspace name: Personal</p></body></html>")],
      ["Export-p2/Tasks bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_all.csv", enc("Name,Priority\r\nWater plants,2\r\n")],
    ]), "Personal-2.zip", await vault.types());
    expect(Object.keys(personal2.pack.types)).toEqual(["personal-tasks"]);

    // Table-form index.html with HTML entities and a digit-leading workspace name both produce valid distinct types
    const ent = notionImport(new Map([
      ["E/index.html", enc("<html><body><table><tr><th>Workspace name</th><td>Studio &amp; Co</td></tr></table></body></html>")],
      ["E/Tasks dddddddddddddddddddddddddddddddd_all.csv", enc("Name\r\nLogo\r\n")],
    ]), "Studio.zip", await vault.types());
    expect(Object.keys(ent.pack.types)).toEqual(["studio-co-tasks"]);
    await applyNotion(ent, vault);

    const numWs = notionImport(new Map([
      ["E/index.html", enc("<html><body><p>Workspace name: 2026 Lab</p></body></html>")],
      ["E/Tasks eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee_all.csv", enc("Name\r\nTest\r\n")],
    ]), "2026.zip", await vault.types());
    expect(Object.keys(numWs.pack.types)).toEqual(["tasks-2026-lab"]);
  });

  test("two workspaces' pages of one title both land, each under its workspace; neither is taken for the other's", async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const ws = (name: string, id: string, words: string) => new Map([
      ["E/index.html", enc(`<html><body><p>Workspace name: ${name}</p></body></html>`)],
      [`E/Getting Started ${id}.md`, enc(`# Getting Started\n\n${words}\n`)],
      [`E/Tasks ${id.replace(/./g, "f")}_all.csv`, enc("Name\r\nUntitled\r\n")],
    ]);
    const vault = memoryVault();
    const work = await applyNotion(notionImport(ws("Work", "a".repeat(32), "work words"), "w.zip"), vault);
    const personal = await applyNotion(notionImport(ws("Personal", "b".repeat(32), "home words"), "p.zip", await vault.types()), vault);
    expect(work.changed && personal.changed).toBe(true);
    expect(vault.records.get("Notion/Work/Getting Started")?.body).toContain("work words");
    expect(vault.records.get("Notion/Personal/Getting Started")?.body).toContain("home words");
    expect(vault.records.get("Notion/Personal/Tasks/Untitled")?.types).toEqual(["personal-tasks"]);
    expect(personal.notes.filter((n) => /already/i.test(n))).toEqual([]);
  });

  test("a name the person's own type holds, or another table of this export, is -2, not named by workspace", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const r = notionImport(new Map([
      ["E/index.html", enc("<html><body><p>Workspace name: Studio</p></body></html>")],
      [`E/Book ${"1".repeat(32)}_all.csv`, enc("Name\r\na\r\n")],
      [`E/Tasks ${"2".repeat(32)}_all.csv`, enc("Name\r\nb\r\n")],
      [`E/Old/Tasks ${"3".repeat(32)}_all.csv`, enc("Name\r\nc\r\n")],
    ]), "s.zip", [{ name: "book", description: null, fields: {} }]);
    expect(Object.keys(r.pack.types).sort()).toEqual(["book-2", "tasks", "tasks-2"]);
  });

  test("a column an earlier import named apart (date_2) is that field again; a value that no longer fits goes to date_2_text", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const held: Held[] = [
      { name: "event", description: null, fields: { date: { type: "string" } } },
      { name: "book", description: "From Notion (Studio): Book.", fields: { date_2: { type: "date" } } },
    ];
    const r = notionImport(new Map([
      ["E/index.html", enc("<html><body><p>Workspace name: Studio</p></body></html>")],
      [`E/Book ${"4".repeat(32)}_all.csv`, enc('Name,Date\r\na,"July 7, 2026"\r\nb,some day\r\n')],
    ]), "s2.zip", held);
    expect(r.pack.types.book.fields).toEqual({ date_2: { type: "date" }, date_2_text: { type: "string" } });
    expect(rec(r, "Notion/Studio/Book/a").fields).toEqual({ date_2: "2026-07-07" });
    expect(rec(r, "Notion/Studio/Book/b").fields).toEqual({ date_2_text: "some day" });
  });

  test("a renamed column is found by its number (date_2 before date_10); a number is a tag in a list field", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const held: Held[] = [{ name: "book", description: "From Notion (Studio): Book.", fields: { date_2: { type: "date" }, date_10: { type: "string" }, tags: { type: "array" } } }];
    const r = notionImport(new Map([
      ["E/index.html", enc("<html><body><p>Workspace name: Studio</p></body></html>")],
      [`E/Book ${"8".repeat(32)}_all.csv`, enc('Name,Date,Tags\r\na,"July 7, 2026",2024\r\n')],
    ]), "s3.zip", held);
    expect(rec(r, "Notion/Studio/Book/a").fields).toEqual({ date_2: "2026-07-07", tags: ["2024"] });
  });

  test("an upload that fails once is tried again for the next record that links the file", async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const imp = notionImport(new Map([
      [`E/One ${"1".repeat(32)}.md`, enc("# One\n\n![a](pic.png)\n")],
      [`E/Two ${"2".repeat(32)}.md`, enc("# Two\n\n![b](pic.png)\n")],
      ["E/pic.png", new Uint8Array([1, 2, 3])],
    ]), "u.zip");
    const vault = memoryVault();
    const base = vault.upload!;
    let tries = 0;
    vault.upload = async (n, b, m) => { if (tries++ === 0) throw new Error("blip"); return base(n, b, m); };
    await applyNotion(imp, vault);
    expect(vault.records.get("Notion/Two")?.body).toContain("![b](/api/storage/uploads/pic.png)");
  });

  test("a workspace name Notion escaped twice is read once", () => {
    expect(workspaceFromIndex("<p>Workspace name: R&amp;amp;D &amp;lt;team&amp;gt;</p>")).toBe("R&amp;D &lt;team&gt;");
    expect(workspaceFromIndex("<p>Workspace name: Test Workspace</p>")).toBe("Test Workspace");
    // no "Workspace name" line: no name guessed from a title that may change between exports
    expect(workspaceFromIndex("<html><head><title>Export 2026-11-22</title></head><body><h1>Home</h1></body></html>")).toBeNull();
  });

  test("a file link just before a relation written as text stays a whole link, not folded into a wikilink's label", async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const id = "6".repeat(32), other = "7".repeat(32);
    const imp = notionImport(new Map([
      [`E/One ${id}.md`, enc(`# One\n\nFiles: [spec.pdf](spec.pdf) (Other%20${other}.md)\n`)],
      [`E/Other ${other}.md`, enc("# Other\n")],
      ["E/spec.pdf", enc("%PDF-1.4\n")],
    ]), "r.zip");
    const vault = memoryVault();
    await applyNotion(imp, vault);
    // (the file's link is whole; the relation, with no "Key: " just before it, stays as written)
    expect(vault.records.get("Notion/One")?.body).toBe(`Files: [spec.pdf](/api/storage/uploads/spec.pdf) (Other%20${other}.md)\n`);
  });

  test("when every upload fails, the body says each couldn't be attached, not that it stayed in the export", async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const imp = notionImport(new Map([[`E/One ${"5".repeat(32)}.md`, enc("# One\n\n![pic](pic.png)\n")], ["E/pic.png", new Uint8Array([1, 2, 3])]]), "f.zip");
    const vault = memoryVault();
    vault.upload = async () => { throw new Error("no room"); };
    const res = await applyNotion(imp, vault);
    expect(vault.records.get("Notion/One")?.body).toContain("*(image pic.png: couldn't be attached)*");
    expect(res.left).toEqual(["pic.png"]);
  });

  test("attachment deduplication, upload failure fallback, and stray unowned files", async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const id1 = "12121212121212121212121212121212", id2 = "34343434343434343434343434343434";
    const files = new Map<string, Uint8Array>([
      [`E/One ${id1}.md`, enc(`# One\n\n![first](shared.png)\n\n[again](shared.png)\n\n![broken](bad.png)\n`)],
      [`E/Two ${id2}.md`, enc("# Two\n\n![also](shared.png)\n")],
      ["E/shared.png", png],
      ["E/bad.png", png],
      ["E/orphan.pdf", enc("%PDF-1.4\n")],
    ]);
    const imp = notionImport(files, "Shared.zip");
    // orphan.pdf belongs to no page
    expect(imp.skipped.map((s) => s.path)).toEqual(["orphan.pdf"]);
    expect(imp.notes.some((n) => n.includes("orphan.pdf") && /doesn't belong/i.test(n))).toBe(true);
    const vault = memoryVault();
    const baseUpload = vault.upload!;
    vault.upload = async (name, bytes, mime) => {
      if (name === "bad.png") throw new Error("server rejected");
      return baseUpload(name, bytes, mime);
    };
    const res = await applyNotion(imp, vault);
    // shared.png uploaded once, attached to both One and Two (and only once on One even though linked twice)
    expect(vault.uploads.map((u) => u.name)).toEqual(["shared.png"]);
    expect(vault.attached.get("Notion/One")).toEqual([{ path: "uploads/shared.png", mimeType: "image/png" }]);
    expect(vault.attached.get("Notion/Two")).toEqual([{ path: "uploads/shared.png", mimeType: "image/png" }]);
    const oneBody = (vault.records.get("Notion/One") as { body: string }).body;
    expect(oneBody).toContain("![first](/api/storage/uploads/shared.png)");
    expect(oneBody).toContain("[again](/api/storage/uploads/shared.png)");
    expect(oneBody).toContain("*(image bad.png: couldn't be attached)*");
    expect(oneBody).not.toContain("⟦notion-file");
    expect(res.notes.some((n) => n.includes("bad.png") && n.includes("server rejected"))).toBe(true);
    expect(res.left).toContain("bad.png");
  });

  test("column kind change: existing string field keeps numbers as text; reference overflow and overflow reuse work cleanly", async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const pid = "77777777777777777777777777777771", tid = "88888888888888888888888888888882";
    const held = [
      { name: "tasks", description: "From Notion: Tasks.", fields: { notes: { type: "string" }, project: { type: "reference" }, rating: { type: "number" }, rating_text: { type: "string" } } },
    ];
    const files = new Map<string, Uint8Array>([
      [`E/Projects ${pid}_all.csv`, enc("Name\r\nAlpha\r\n")],
      [`E/Projects ${pid}/Alpha ${pid.replace("1", "9")}.md`, enc("# Alpha\n")],
      [`E/Tasks ${tid}_all.csv`, enc(`Name,Notes,Project,Rating\r\nA,42,Alpha (Projects%20${pid}/Alpha%20${pid.replace("1", "9")}.md),great\r\nB,99,Ad hoc work,5\r\n`)],
    ]);
    const r = notionImport(files, "Later.zip", held);
    // notes was string -> "42" stays string, no overflow field
    expect(r.pack.types.tasks.fields).toMatchObject({
      notes: { type: "string" },
      project: { type: "reference", cardinality: "many" },
      project_text: { type: "string" },
      rating: { type: "number" },
      rating_text: { type: "string" },
    });
    expect(r.pack.types.tasks.fields).not.toHaveProperty("notes_text");
    expect(r.pack.types.tasks.fields).not.toHaveProperty("rating_text_2");
    expect(rec(r, "Notion/Tasks/A").fields).toEqual({ notes: "42", project: ["Notion/Projects/Alpha"], rating_text: "great" });
    expect(rec(r, "Notion/Tasks/B").fields).toEqual({ notes: "99", project_text: "Ad hoc work", rating: 5 });
    expect(r.notes.some((n) => n.includes("Project") && n.includes("project_text"))).toBe(true);
    expect(r.notes.some((n) => n.includes("Rating") && n.includes("rating_text"))).toBe(true);
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

/** A vault in memory, as the applier sees one: types, records at free paths, attachments, the receipt. */
function memoryVault(): NotionTarget & { records: Map<string, { path: string; body: string; types?: string[]; fields?: Record<string, unknown> }>; uploads: { name: string; bytes: Uint8Array; mimeType: string; path: string }[]; attached: Map<string, { path: string; mimeType: string }[]> } {
  const types = new Map<string, { description?: string; fields: Record<string, unknown> }>();
  const records = new Map<string, { path: string; body: string; types?: string[]; fields?: Record<string, unknown> }>();
  const uploads: { name: string; bytes: Uint8Array; mimeType: string; path: string }[] = [];
  const attached = new Map<string, { path: string; mimeType: string }[]>();
  let receipt: { receipt: Receipt; id: string; updatedAt: string | null } | null = null;
  return {
    records,
    uploads,
    attached,
    types: async () => [...types].map(([name, t]) => ({ name, kind: "type" as const, count: 0, description: t.description ?? null, fields: t.fields as never })),
    defineType: async (name, def) => { const prev = types.get(name); types.set(name, { description: def.description ?? prev?.description, fields: { ...(prev?.fields ?? {}), ...def.fields } }); return "ok"; },
    create: async (r) => { const existed = records.has(r.path); if (!existed) records.set(r.path, { ...r }); return { id: r.path, updatedAt: "t0", existed }; },
    upload: async (name, bytes, mimeType) => { const path = `uploads/${name}`; uploads.push({ name, bytes, mimeType, path }); return { path, mimeType }; },
    attach: async (recordId, path, mimeType) => { attached.set(recordId, [...(attached.get(recordId) ?? []), { path, mimeType }]); return { id: `${recordId}:${path}`, path, mimeType }; },
    updateBody: async (recordId, body) => { const rec = records.get(recordId); if (rec) rec.body = body; return { updatedAt: "t1" }; },
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
