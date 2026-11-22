// Import from Notion (T-476): a Notion workspace exported as "Markdown & CSV" becomes a pack (packs.ts), applied by the
// same rule as any pack: types only added to, records only at free paths, and a receipt, so importing the same export
// twice changes nothing. Pure: files in (the zip's, zip.ts), a pack out.
//
// What an export holds (checked against a real one, obsidian-importer tests/notion/Notion.Test.Export.zip, and the
// fixture tools/make-notion-export.py in the T-476 worker's folder): one root folder `Export-<uuid>/`; every page and
// database named "<title> <32-hex id>"; a page is `<title> <id>.md` starting `# <title>`, its child pages in the folder
// `<title> <id>/`; a database is `<title> <id>.csv` (the current view) and `<title> <id>_all.csv` (every property), its
// rows' pages in `<title> <id>/`, each starting `# <title>` then one `Key: Value` line per property. CSVs start with a
// byte order mark. Links are relative and URL-encoded; a relation is "Title (path.md)".
//
// What it becomes, under one folder `Notion/` so nothing of the person's is in the way:
//   a database  -> a type named for it (Reading List -> reading-list), one field per column (dates, numbers, yes/no,
//                  lists and links to other rows found from the values), and a short record at its place saying so
//   a row       -> a record of that type: the title column names it, the other columns are its fields, the row's page
//                  (less its title and property lines) is its body
//   a page      -> a record with its words, at its place in the tree
//   a link      -> a wikilink to the record it became; an image or file -> a line saying it stayed in the export
import { checkPack, type FieldSpec, type Pack, type PackRecord } from "./packs";

export const ROOT = "Notion/";
export const NOTION_SOURCE = "https://www.notion.com/help/export-your-content";

export type Imported = {
  pack: Pack;
  /** What was found: pages, tables, rows. */
  found: { pages: number; tables: number; rows: number };
  /** Files that weren't brought in (images, attachments, other files), by their place in the export. */
  left: string[];
};

const ID = / ?[0-9a-f]{32}$/i;
/** A name less Notion's id. */
export const bare = (seg: string) => seg.replace(ID, "").trim();
const ext = (p: string) => /\.([a-z0-9]+)$/i.exec(p)?.[1]?.toLowerCase() ?? "";
const noExt = (p: string) => p.replace(/\.[a-z0-9]+$/i, "");
const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** One segment of a record's path: no characters a vault path refuses, not too long. */
function seg(s: string): string {
  const t = s.replace(/[\\%/\u0000-\u001f]/g, "-").replace(/^\.+/, "").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return t || "Untitled";
}

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes; a BOM first is dropped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (n: number) => String(n).padStart(2, "0");
/** A Notion date ("March 2, 2026", "Mar 2, 2026 3:00 PM", "2026/03/02", a range "A → B", a mention "@March 2, 2026")
 *  as YYYY-MM-DD, its first day; null when it isn't one. */
export function notionDate(raw: string): string | null {
  const s = raw.replace(/^@/, "").split("→")[0].replace(/\(.*?\)\s*$/, "").trim();
  let m = /^([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})(?: \d{1,2}:\d{2}(?: ?[AP]M)?)?$/i.exec(s);
  if (m) {
    const mo = MONTHS.findIndex((x) => x.startsWith(m![1].toLowerCase().slice(0, 3)) && x.startsWith(m![1].toLowerCase()));
    const d = Number(m[2]);
    return mo >= 0 && d >= 1 && d <= 31 ? `${m[3]}-${pad(mo + 1)}-${pad(d)}` : null;
  }
  m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T]\d{1,2}:\d{2}.*)?$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return null;
}

/** "Title (path.md), Other (path2.md)": each link's path, URL-decoded; null when the value isn't only such links. */
function relations(raw: string): string[] | null {
  const parts = [...raw.matchAll(/(?:^|,\s*)([^,()]*?(?:\([^()]*\)[^,()]*?)*?)\s*\(([^()]+?\.(?:md|csv))\)/g)];
  if (!parts.length) return null;
  const rest = raw.replace(/(?:^|,\s*)[^,()]*?(?:\([^()]*\)[^,()]*?)*?\s*\([^()]+?\.(?:md|csv)\)/g, "").trim();
  return rest ? null : parts.map((p) => dec(p[2]));
}

type Kind = "date" | "number" | "boolean" | "list" | "relation" | "text";
/** A column's kind, from every value it has: one that doesn't fit makes the column text. */
function kindOf(values: string[]): Kind {
  const v = values.map((x) => x.trim()).filter(Boolean);
  if (!v.length) return "text";
  if (v.every((x) => relations(x))) return "relation";
  if (v.every((x) => /^(yes|no)$/i.test(x))) return "boolean";
  if (v.every((x) => notionDate(x))) return "date";
  if (v.every((x) => /^-?\d+(\.\d+)?$/.test(x.replace(/,(?=\d{3}\b)/g, "")))) return "number";
  // a multi-select: short words split by commas, with no sentence in them
  if (v.some((x) => x.includes(",")) && v.every((x) => x.split(",").every((t) => { const w = t.trim(); return w.length > 0 && w.length <= 40 && !/[.!?]$/.test(w); }))) return "list";
  return "text";
}
const SPEC: Record<Exclude<Kind, "relation">, FieldSpec> = { date: { type: "date" }, number: { type: "number" }, boolean: { type: "boolean" }, list: { type: "array" }, text: { type: "string" } };

/** A name a vault takes for a type: lower case, words joined by "-". */
function typeName(title: string, taken: Set<string>): string {
  let t = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[0-9-]+/, "").slice(0, 36).replace(/-+$/, "");
  if (!t) t = "notion-table";
  if (/^(publish|published|applet|component|parachute|template)/.test(t)) t = `my-${t}`.slice(0, 36);
  let n = t, i = 2;
  while (taken.has(n)) n = `${t}-${i++}`;
  taken.add(n);
  return n;
}
/** A name a vault takes for a field: lower case, words joined by "_". */
function fieldName(header: string, taken: Set<string>): string {
  let f = header.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9_]+/, "").slice(0, 36).replace(/_+$/, "");
  if (!f || f === "published" || f === "parachute") f = f ? `${f}_field` : "field";
  let n = f, i = 2;
  while (taken.has(n)) n = `${f}_${i++}`;
  taken.add(n);
  return n;
}

/** A short hash of the export's file list: the same export is the same pack (its receipt), another export another. */
function idOf(paths: string[]): string {
  let h = 0x811c9dc5;
  for (const c of paths.slice().sort().join("\n")) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** Notion's Markdown & CSV export, as a pack. `name`: the file's name, for the receipt. */
export function notionImport(files: Map<string, Uint8Array>, name = "Notion export"): Imported {
  const text = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
  // the export's own wrapping: hidden files, its index page, and one root folder above everything
  let paths = [...files.keys()].filter((p) => !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(p) && !/(^|\/)\._/.test(p));
  const first = new Set(paths.map((p) => p.split("/")[0]));
  const strip = first.size === 1 && paths.every((p) => p.includes("/")) && !paths.some((p) => p === `${[...first][0]}.md`) ? `${[...first][0]}/` : "";
  const rel = (p: string) => p.slice(strip.length);
  paths = paths.filter((p) => !(strip ? rel(p) === "index.html" : p === "index.html"));
  if (!paths.some((p) => ext(p) === "md" || ext(p) === "csv")) throw new Error("This zip has no Notion pages in it. In Notion: Settings, Export, Markdown & CSV.");

  /** Where an export path lands: Notion/<titles, less ids>. */
  const placeOf = (p: string) => ROOT + rel(noExt(p)).split("/").map((s) => seg(bare(dec(s)))).join("/");

  // databases: one per "<title> <id>", from its _all.csv when there is one
  const dbs = new Map<string, string>();
  for (const p of paths.filter((x) => ext(x) === "csv")) {
    const key = p.replace(/_all\.csv$/i, ".csv");
    if (!dbs.has(key) || /_all\.csv$/i.test(p)) dbs.set(key, p);
  }
  const rowFolder = (csvKey: string) => noExt(csvKey) + "/";
  const isRow = (p: string) => [...dbs.keys()].some((k) => p.startsWith(rowFolder(k)) && !p.slice(rowFolder(k).length).includes("/"));

  // every md page and row's place, so links can be made into wikilinks
  const used = new Set<string>();
  const unique = (path: string) => { let n = path, i = 2; while (used.has(n.toLowerCase())) n = `${path} (${i++})`; used.add(n.toLowerCase()); return n; };
  const place = new Map<string, string>(); // export path (decoded, less root) -> record path
  const tables = new Map<string, { type: string; place: string }>();
  const typeNames = new Set<string>();
  for (const [key] of dbs) tables.set(key, { type: typeName(bare(noExt(key.split("/").pop()!)), typeNames), place: unique(placeOf(key)) });
  for (const p of paths.filter((x) => ext(x) === "md")) place.set(p, unique(placeOf(p)));

  const resolve = (from: string, target: string): string => {
    const t = dec(target.replace(/[?#].*$/, ""));
    const parts = (t.startsWith("/") ? [] : from.split("/").slice(0, -1));
    for (const s of t.split("/")) { if (s === "..") parts.pop(); else if (s && s !== ".") parts.push(s); }
    return parts.join("/");
  };
  const left: string[] = [];
  /** A page's words: its links to pages as wikilinks; images and files said, since they stay in the export. */
  const words = (from: string, body: string) => body
    .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (all, img: string, label: string, target: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return all;
      const to = resolve(from, target);
      const rec = place.get(to) ?? tables.get(to.replace(/_all\.csv$/i, ".csv"))?.place;
      if (rec) return `[[${rec}${label && label !== rec.split("/").pop() ? `|${label}` : ""}]]`;
      const file = dec(target.split("/").pop() ?? target);
      return img ? `*(image ${file}: it stayed in your Notion export)*` : `${label || file} *(it stayed in your Notion export)*`;
    })
    // a relation written into a page as text, "Title (path.md)": a wikilink, where it is a page of the export
    // (after a line's start, a property's "Key: " or another link's ", "; its title has no ":" or "," of its own)
    .replace(/(^|: |, )([^\n()[\]:,]+?) \(([^()\s]+\.md)\)/gm, (all, lead: string, label: string, target: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return all;
      const rec = place.get(resolve(from, target));
      const name = label.trim();
      return rec ? `${lead}[[${rec}${name && name !== rec.split("/").pop() ? `|${name}` : ""}]]` : all;
    })
    // Notion writes a checklist item as "- [ ]  text", two spaces after the box
    .replace(/^(\s*[-*] \[[ xX]\]) {2,}/gm, "$1 ");

  const types: Pack["types"] = {};
  const records: PackRecord[] = [];
  let rows = 0;
  for (const [key, csvPath] of dbs) {
    const t = tables.get(key)!;
    const grid = parseCsv(text(files.get(csvPath)!));
    const [header = [], ...body] = grid;
    if (!header.length) continue;
    const taken = new Set<string>();
    const cols = header.slice(1).map((h, i) => {
      const values = body.map((r) => r[i + 1] ?? "");
      const kind = kindOf(values);
      return { header: h.trim(), field: fieldName(h, taken), kind, i: i + 1 };
    });
    types[t.type] = { description: `From Notion: ${bare(noExt(key.split("/").pop()!))}.`, fields: Object.fromEntries(cols.map((c) => [c.field, c.kind === "relation" ? { type: "reference", cardinality: "many" } as FieldSpec : SPEC[c.kind]])) };
    records.push({ path: t.place, body: `This was the Notion table **${bare(noExt(key.split("/").pop()!))}**. Its rows are the type ${t.type} here: open it in Vault.\n` });
    // the rows' own pages, by their title, in the database's folder
    const pages = new Map<string, string[]>();
    for (const p of paths.filter((x) => ext(x) === "md" && x.startsWith(rowFolder(key)) && !x.slice(rowFolder(key).length).includes("/"))) {
      const k = bare(noExt(p.split("/").pop()!)).toLowerCase();
      pages.set(k, [...(pages.get(k) ?? []), p]);
    }
    for (const r of body) {
      const title = (r[0] ?? "").trim() || "Untitled";
      const page = pages.get(title.toLowerCase())?.shift() ?? null;
      const at = page ? place.get(page)! : unique(`${t.place}/${seg(title)}`);
      const fields: Record<string, unknown> = {};
      for (const c of cols) {
        const v = (r[c.i] ?? "").trim();
        if (!v) continue;
        fields[c.field] = c.kind === "date" ? notionDate(v)
          : c.kind === "number" ? Number(v.replace(/,(?=\d{3}\b)/g, ""))
          : c.kind === "boolean" ? /^yes$/i.test(v)
          : c.kind === "list" ? v.split(",").map((x) => x.trim()).filter(Boolean)
          : c.kind === "relation" ? relations(v)!.map((to) => { const f = resolve(csvPath, to); return place.get(f) ?? tables.get(f)?.place ?? bare(to.split("/").pop()!.replace(/\.md$/, "")); })
          : v;
      }
      // the row's page: its words, less the title line and the property lines the table already holds
      let words_ = "";
      if (page) {
        const lines = text(files.get(page)!).replace(/\r\n/g, "\n").split("\n");
        let i = 0;
        if (/^# /.test(lines[0] ?? "")) i = 1;
        while (i < lines.length && lines[i].trim() === "") i++;
        const keys = new Set(header.map((h) => h.trim().toLowerCase()));
        while (i < lines.length && /^[^:\n]{1,60}: /.test(lines[i]) && keys.has(lines[i].split(":")[0].trim().toLowerCase())) i++;
        words_ = words(page, lines.slice(i).join("\n").trim());
      }
      records.push({ path: at, types: [t.type], fields, body: words_ ? `${words_}\n` : "" });
      rows++;
    }
  }
  // pages that aren't a table's rows: their words, less the title line (the path names them)
  let pageCount = 0;
  for (const p of paths.filter((x) => ext(x) === "md" && !isRow(x))) {
    const lines = text(files.get(p)!).replace(/\r\n/g, "\n").split("\n");
    if (/^# /.test(lines[0] ?? "")) lines.shift();
    records.push({ path: place.get(p)!, body: `${words(p, lines.join("\n").trim())}\n` });
    pageCount++;
  }
  // a row whose page wasn't in its table's CSV (a filtered view): a page of its own, so nothing is lost
  for (const p of paths.filter((x) => ext(x) === "md" && isRow(x))) {
    if (records.some((r) => r.path === place.get(p))) continue;
    const lines = text(files.get(p)!).replace(/\r\n/g, "\n").split("\n");
    if (/^# /.test(lines[0] ?? "")) lines.shift();
    records.push({ path: place.get(p)!, body: `${words(p, lines.join("\n").trim())}\n` });
    pageCount++;
  }
  for (const p of paths) if (!["md", "csv"].includes(ext(p))) left.push(rel(p));

  const label = name.replace(/\.zip$/i, "").slice(0, 60) || "Notion export";
  const pack = checkPack({
    parachute_pack: 1, id: `notion-${idOf(paths.map(rel))}`, name: `Notion: ${label}`, version: 1, source: NOTION_SOURCE,
    summary: `${pageCount} page${pageCount === 1 ? "" : "s"} and ${dbs.size} table${dbs.size === 1 ? "" : "s"} from Notion.`,
    types, records,
  });
  return { pack, found: { pages: pageCount, tables: dbs.size, rows }, left };
}
