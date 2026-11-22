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

/** One segment of a record's path: no characters a vault path refuses, no ending it takes for code ("Next.js notes"
 *  is fine; a page titled "notes.js" becomes "notes-js"), not too long. */
function seg(s: string): string {
  // (and none of the marks a wikilink reads: "Sprint #12" or "A | B" would break the link to it)
  const t = codeEnd(s.replace(/[\\%/\u0000-\u001f[\]|#^]/g, "-").replace(/^\.+/, "").replace(/\s+/g, " ").trim().slice(0, 80).trim());
  return t || "Untitled";
}
const codeEnd = (t: string) => t.replace(/\.(html?|tsx|jsx|js)$/i, "-$1");
/** A path a vault takes (200 characters at most, with room for " (2)"): its longest folders shortened first. */
function fit(path: string, max = 190): string {
  const segs = path.split("/");
  while (segs.join("/").length > max) {
    let at = 1;
    for (let i = 1; i < segs.length; i++) if (segs[i].length > segs[at].length) at = i;
    if (segs[at].length <= 12) break;
    segs[at] = codeEnd(segs[at].slice(0, Math.max(12, segs[at].length - (segs.join("/").length - max))).trim().replace(/\.$/, ""));
  }
  // a cut can leave an ending a vault path refuses (".js"), a dot or a "/": the same guards again
  return codeEnd(segs.join("/").slice(0, max).replace(/[/.\s]+$/, ""));
}

/** Only an export's pages and tables are read; its images and attachments are listed by name, never unpacked. */
export const NOTION_WANT = (path: string) => /\.(md|csv)$/i.test(path);

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

/** A link to a page on notion.so: "https://www.notion.so/Harbor-Books-cover-<32 hex>?pvs=21". Since about 2023 Notion's
 *  CSVs write a relation this way; older exports, and links inside pages, use the export's own relative paths. */
const NOTION_URL = /^https?:\/\/(?:www\.)?notion\.so\/[^\s()]*?([0-9a-f]{32})(?:[?#][^\s()]*)?$/i;
/** The 32-hex id Notion gives a page, from the end of a file name or a notion.so link; null when there is none. */
const idIn = (s: string) => NOTION_URL.exec(s)?.[1]?.toLowerCase() ?? / ([0-9a-f]{32})(?:\.[a-z0-9]+)?$/i.exec(s)?.[1]?.toLowerCase() ?? null;

/** "Title (path.md), Other (https://www.notion.so/Other-<id>?pvs=21)": each link's target (a path URL-decoded, or the
 *  notion.so link as it is); null when the value isn't only such links. Found by their "(…)" alone: a title may hold
 *  commas ("November 21, 2026") and parentheses, and so may a path, one deep. */
function relations(raw: string): string[] | null {
  const re = /\(((?:[^()]|\([^()]*\))+?\.(?:md|csv)|https?:\/\/(?:www\.)?notion\.so\/[^\s()]*?[0-9a-f]{32}[^\s()]*)\)/gi;
  const out: string[] = [];
  let last = 0;
  for (const m of raw.matchAll(re)) {
    // what came before this link, after the last one and its comma, is its title: there must be one
    if (!raw.slice(last, m.index).replace(/^\s*,/, "").trim()) return null;
    out.push(/^https?:/i.test(m[1]) ? m[1] : dec(m[1]));
    last = m.index! + m[0].length;
  }
  return out.length && !raw.slice(last).trim() ? out : null;
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
  // (not a number with a decimal comma, "1,5")
  if (v.some((x) => x.includes(",")) && !v.every((x) => /^[\d\s.,-]+$/.test(x)) && v.every((x) => x.split(",").every((t) => { const w = t.trim(); return w.length > 0 && w.length <= 40 && !/[.!?]$/.test(w); }))) return "list";
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

  /** Where an export path lands: Notion/<titles, less ids>, short enough for a vault. */
  const placeOf = (p: string) => fit(ROOT + rel(noExt(p)).split("/").map((s) => seg(bare(dec(s)))).join("/"));
  const used = new Set<string>();
  const unique = (path: string) => { let n = path, i = 2; while (used.has(n.toLowerCase())) n = `${path} (${i++})`; used.add(n.toLowerCase()); return n; };
  const lines = (p: string) => text(files.get(p)!).replace(/\r\n/g, "\n").split("\n");
  /** A row page's property lines (after its title), as Notion writes them: "Key: Value" until the first other line. */
  const propsOf = (p: string) => {
    const l = lines(p), out = new Map<string, string>();
    let i = /^# /.test(l[0] ?? "") ? 1 : 0;
    while (i < l.length && l[i].trim() === "") i++;
    for (; i < l.length && /^[^:\n]{1,60}: /.test(l[i]); i++) out.set(l[i].slice(0, l[i].indexOf(":")).trim().toLowerCase(), l[i].slice(l[i].indexOf(":") + 1).trim());
    return out;
  };

  const resolve = (from: string, target: string): string => {
    const t = dec(target.replace(/[?#].*$/, ""));
    const parts = (t.startsWith("/") ? [] : from.split("/").slice(0, -1));
    for (const s of t.split("/")) { if (s === "..") parts.pop(); else if (s && s !== ".") parts.push(s); }
    return parts.join("/");
  };

  // every page and table by Notion's id, so a notion.so link finds what it became
  const byId = new Map<string, string>();
  for (const p of paths) { const id = idIn(noExt(p.replace(/_all\.csv$/i, ".csv")).split("/").pop()!); if (id && /\.(md|csv)$/i.test(p)) byId.set(id, p.replace(/_all\.csv$/i, ".csv")); }
  /** Where a link leads in the export: a notion.so link by its id, a path from where it is written. */
  const target = (from: string, raw: string) => (/^https?:/i.test(raw) ? byId.get(idIn(raw) ?? "") ?? raw : resolve(from, raw));

  // 1. Databases: one per "<title> <id>", from its _all.csv when there is one, each a type
  const dbs = new Map<string, string>();
  for (const p of paths.filter((x) => ext(x) === "csv")) {
    const key = p.replace(/_all\.csv$/i, ".csv");
    if (!dbs.has(key) || /_all\.csv$/i.test(p)) dbs.set(key, p);
  }
  const rowFolder = (csvKey: string) => noExt(csvKey) + "/";
  const inFolder = (p: string, k: string) => p.startsWith(rowFolder(k)) && !p.slice(rowFolder(k).length).includes("/");
  type Col = { header: string; field: string; kind: Kind; i: number };
  type Table = { key: string; csv: string; title: string; type: string; place: string; header: string[]; body: string[][]; cols: Col[] };
  const typeNames = new Set<string>();
  const tables: Table[] = [];
  for (const [key, csv] of dbs) {
    const [header = [], ...body] = parseCsv(text(files.get(csv)!));
    if (!header.length) continue;
    const taken = new Set<string>();
    const title = bare(noExt(key.split("/").pop()!));
    tables.push({ key, csv, title, type: typeName(title, typeNames), place: unique(placeOf(key)), header, body,
      cols: header.slice(1).map((h, i) => ({ header: h.trim(), field: fieldName(h, taken), kind: kindOf(body.map((r) => r[i + 1] ?? "")), i: i + 1 })) });
  }
  // a field is one thing in a vault: where two tables have a column of one name but of different kinds, it is text in
  // both (a vault refuses a type whose field another type declares otherwise)
  const kinds = new Map<string, Set<Kind>>();
  for (const t of tables) for (const c of t.cols) kinds.set(c.field, (kinds.get(c.field) ?? new Set()).add(c.kind));
  for (const t of tables) for (const c of t.cols) if (kinds.get(c.field)!.size > 1) c.kind = "text";

  // 2. Rows and their pages: by title; a title the page says otherwise ("@Today" for a date), or two rows of one title,
  // by the property lines the page holds, so a row is one record and its page isn't a second
  const place = new Map<string, string>(); // export path -> record path
  const rowOf: { t: Table; r: string[]; path: string; page: string | null }[] = [];
  for (const t of tables) {
    const pages = paths.filter((x) => ext(x) === "md" && inFolder(x, t.key));
    const props = new Map(pages.map((p) => [p, propsOf(p)]));
    // a relation is written relative to where it is (the CSV, the page): compared by what it points at
    const targets = (raw: string, from: string) => (relations(raw) ?? []).map((x) => target(from, x)).sort().join("\n");
    const same = (c: Col, rowValue: string, page: string) => {
      const v = props.get(page)!.get(c.header.toLowerCase());
      if (v === undefined) return false;
      return c.kind === "relation" ? targets(rowValue, t.csv) === targets(v, page) : v === rowValue;
    };
    const score = (p: string, r: string[]) => t.cols.filter((c) => (r[c.i] ?? "").trim() && same(c, (r[c.i] ?? "").trim(), p)).length;
    const free = new Set(pages);
    const byTitle = new Map<string, string[]>();
    for (const p of pages) { const k = bare(noExt(p.split("/").pop()!)).toLowerCase(); byTitle.set(k, [...(byTitle.get(k) ?? []), p]); }
    const rows = t.body.map((r) => ({ r, title: (r[0] ?? "").trim() || "Untitled", page: null as string | null }));
    for (const row of rows) {
      const named = (byTitle.get(row.title.toLowerCase()) ?? []).filter((p) => free.has(p));
      const best = named.length > 1 ? named.sort((a, b) => score(b, row.r) - score(a, row.r))[0] : named[0];
      if (best) { row.page = best; free.delete(best); }
    }
    for (const row of rows.filter((x) => !x.page)) {
      const [best, next] = [...free].map((p) => ({ p, n: score(p, row.r) })).sort((a, b) => b.n - a.n);
      if (best && best.n > 0 && best.n === props.get(best.p)!.size && (!next || next.n < best.n)) { row.page = best.p; free.delete(best.p); }
    }
    for (const row of rows) {
      const path = unique(fit(`${t.place}/${seg(row.title)}`));
      if (row.page) place.set(row.page, path);
      rowOf.push({ t, r: row.r, path, page: row.page });
    }
  }
  for (const p of paths.filter((x) => ext(x) === "md" && !place.has(x))) place.set(p, unique(placeOf(p)));

  // 3. Words: links to pages as wikilinks; a file said, whether it stayed in the export or was never in it
  const tableAt = (to: string) => tables.find((t) => t.key === to.replace(/_all\.csv$/i, ".csv"));
  const wiki = (rec: string, label: string) => `[[${rec}${label && label !== rec.split("/").pop() ? `|${label}` : ""}]]`;
  const words = (from: string, body: string) => body
    // (a target may hold one level of parentheses: "Notes (weekly) <id>.md")
    .replace(/(!?)\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (all, img: string, label: string, link: string) => {
      // a link to a notion.so page the export holds: to the record it became
      if (/^https?:/i.test(link)) { const to = target(from, link); const rec = place.get(to) ?? tableAt(to)?.place; return rec ? wiki(rec, label) : all; }
      if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("#")) return all;
      const to = resolve(from, link);
      // a linked view of a table is a .csv the export doesn't hold: its page of the same name, if there is one
      const rec = place.get(to) ?? tableAt(to)?.place ?? (ext(to) === "csv" ? place.get(to.replace(/(_all)?\.csv$/i, ".md")) : undefined);
      if (rec) return wiki(rec, label);
      const file = dec(link.split("/").pop() ?? link);
      const there = files.has(to);
      return img ? `*(image ${file}: ${there ? "it stayed in your Notion export" : "not in your Notion export"})*`
        : `${label || file} *(${there ? "it stayed in your Notion export" : "not in your Notion export"})*`;
    })
    // a relation written into a page as text, "Title (path.md)": a wikilink, where it is a page of the export
    // (after a line's start, a property's "Key: " or another link's ", "; its title has no ":" or "," of its own)
    .replace(/(^|: |, )([^\n()[\]:,]+?) \(([^()\s]+\.md|https?:\/\/(?:www\.)?notion\.so\/[^()\s]*)\)/gm, (all, lead: string, label: string, link: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^https?:\/\/(?:www\.)?notion\.so\//i.test(link)) return all;
      const rec = place.get(target(from, link));
      return rec ? `${lead}${wiki(rec, label.trim())}` : all;
    })
    // Notion writes a checklist item as "- [ ]  text", two spaces after the box
    .replace(/^(\s*[-*] \[[ xX]\]) {2,}/gm, "$1 ");

  // 4. Records: each table's own, its rows, then every other page
  const types: Pack["types"] = {};
  const records: PackRecord[] = [];
  for (const t of tables) {
    types[t.type] = { description: `From Notion: ${t.title}.`, fields: Object.fromEntries(t.cols.map((c) => [c.field, c.kind === "relation" ? { type: "reference", cardinality: "many" } as FieldSpec : SPEC[c.kind as Exclude<Kind, "relation">]])) };
    records.push({ path: t.place, body: `This was the Notion table **${t.title}**. Its rows are the type ${t.type} here: open it in Vault.\n` });
  }
  for (const { t, r, path, page } of rowOf) {
    const fields: Record<string, unknown> = {};
    for (const c of t.cols) {
      const v = (r[c.i] ?? "").trim();
      if (!v) continue;
      fields[c.field] = c.kind === "date" ? notionDate(v)
        : c.kind === "number" ? Number(v.replace(/,(?=\d{3}\b)/g, ""))
        : c.kind === "boolean" ? /^yes$/i.test(v)
        : c.kind === "list" ? v.split(",").map((x) => x.trim()).filter(Boolean)
        : c.kind === "relation" ? relations(v)!.map((to) => { const f = target(t.csv, to); return place.get(f) ?? tableAt(f)?.place ?? (/^https?:/i.test(to) ? to : bare(to.split("/").pop()!.replace(/\.md$/, ""))); })
        : v;
    }
    // the row's page: its words, less the title line and the property lines the table already holds
    let body = "";
    if (page) {
      const l = lines(page);
      let i = /^# /.test(l[0] ?? "") ? 1 : 0;
      while (i < l.length && l[i].trim() === "") i++;
      const keys = new Set(t.header.map((h) => h.trim().toLowerCase()));
      while (i < l.length && /^[^:\n]{1,60}: /.test(l[i]) && keys.has(l[i].split(":")[0].trim().toLowerCase())) i++;
      body = words(page, l.slice(i).join("\n").trim());
    }
    records.push({ path, types: [t.type], fields, body: body ? `${body}\n` : "" });
  }
  // pages, and a row's page its table's CSV didn't list: their words, less the title line (the path names them)
  const rowPages = new Set(rowOf.map((x) => x.page).filter(Boolean));
  let pageCount = 0;
  for (const p of paths.filter((x) => ext(x) === "md" && !rowPages.has(x))) {
    const l = lines(p);
    if (/^# /.test(l[0] ?? "")) l.shift();
    records.push({ path: place.get(p)!, body: `${words(p, l.join("\n").trim())}\n` });
    pageCount++;
  }
  const left = paths.filter((p) => !["md", "csv"].includes(ext(p))).map(rel);
  const rows = rowOf.length;
  const dbsCount = tables.length;

  const label = name.replace(/\.zip$/i, "").slice(0, 60) || "Notion export";
  const pack = checkPack({
    parachute_pack: 1, id: `notion-${idOf(paths.map(rel))}`, name: `Notion: ${label}`, version: 1, source: NOTION_SOURCE,
    summary: `${pageCount} page${pageCount === 1 ? "" : "s"} and ${dbsCount} table${dbsCount === 1 ? "" : "s"} from Notion.`,
    types, records,
  });
  return { pack, found: { pages: pageCount, tables: dbsCount, rows }, left };
}
