// Import from Notion (T-476): a Notion workspace exported as "Markdown & CSV" becomes a pack (packs.ts), applied by the
// same rule as any pack: types only added to, records only at free paths, and a receipt, so importing the same export
// twice changes nothing. Pure: files in (the zip's, zip.ts), a pack and its attachments out.
//
// What an export holds (checked against a real one, obsidian-importer tests/notion/Notion.Test.Export.zip, and the
// fixture scripts/make-notion-export.py): one root folder `Export-<uuid>/` with an `index.html` naming the workspace;
// every page and database named "<title> <32-hex id>"; a page is `<title> <id>.md` starting `# <title>`, its child pages
// and files in the folder `<title> <id>/`; a database is `<title> <id>.csv` (the current view) and `<title> <id>_all.csv`
// (every property), its rows' pages in `<title> <id>/`, each starting `# <title>` then one `Key: Value` line per
// property. CSVs start with a byte order mark. Links are relative and URL-encoded; a relation is "Title (path.md)" or
// "Title (https://www.notion.so/...)".
//
// What it becomes, under one folder `Notion/` so nothing of the person's is in the way (`Notion/<workspace>/` when the
// export's index.html names its workspace, so two workspaces' pages never meet at one path):
//   a database  -> a type named for it (Reading List -> reading-list; a title another workspace's import already took
//                  is named by workspace, e.g. personal-tasks), one field per column (dates, numbers,
//                  yes/no, lists and links to other rows found from the values; values that no longer fit a column
//                  whose kind changed between exports go to a text field with a summary note), and a short record at
//                  its place saying so
//   a row       -> a record of that type: the title column names it, the other columns are its fields, the row's page
//                  (less its title and property lines) is its body
//   a page      -> a record with its words, at its place in the tree
//   a link      -> a wikilink to the record it became
//   an image or attachment -> a vault attachment on the record it belongs to, with body links rewritten to
//                  `/api/storage/...`; oversized or empty files are skipped with a plain message
import { applyPack, checkPack, type Applied, type FieldSpec, type Pack, type PackRecord, type PackTarget } from "./packs";
import { MAX_TOTAL } from "./zip";
import { FILE_MAX } from "../applet/files";

export const ROOT = "Notion/";
export const NOTION_SOURCE = "https://www.notion.com/help/export-your-content";
/** Per-file attachment size limit: the vault's own (applet/files.ts FILE_MAX, 25 MB). */
export const ATTACHMENT_MAX = FILE_MAX;
/** Total unpacked attachment bytes brought in by one import. */
export const ATTACHMENT_TOTAL_MAX = 150 * 1024 * 1024;
/** readZip's budget for a Notion export: the pages' and tables' own (zip.ts MAX_TOTAL, as before attachments came in),
 *  and the attachments' on top, so an export whose pages fit still comes in however many images it has. */
export const NOTION_ZIP_MAX = MAX_TOTAL + ATTACHMENT_TOTAL_MAX;
/** Max size of Notion's export index.html read for the workspace name. */
const INDEX_MAX = 2 * 1024 * 1024;

export type NotionAttachment = {
  /** Placeholder token in the record's body template, or null when attached by folder/property without a body link. */
  token: string | null;
  /** Whether the markdown link was an image (`![alt](...)`) or a plain file link (`[label](...)`). */
  image: boolean;
  /** Alt text or link label from the markdown. */
  label: string;
  /** Path inside the export (as keyed in `files`). */
  exportPath: string;
  /** Path relative to the export root (matches `left` / `skipped`). */
  relPath: string;
  /** Bare filename. */
  name: string;
  /** Media type inferred from the filename extension. */
  mimeType: string;
  /** File bytes to upload. */
  bytes: Uint8Array;
};

export type SkippedFile = {
  /** Path inside the export (relative to export root). */
  path: string;
  /** Bare filename. */
  name: string;
  /** Plain reason the file wasn't attached. */
  reason: string;
};

export type NotionImportOptions = {
  /** Unpacked sizes of files that readZip skipped (e.g. over ATTACHMENT_MAX or over total budget). */
  skippedSizes?: ReadonlyMap<string, number>;
  /** Override per-file attachment limit in bytes (default ATTACHMENT_MAX). */
  maxFile?: number;
  /** Override total attachment budget in bytes (default ATTACHMENT_TOTAL_MAX). */
  maxTotal?: number;
  /** Explicit workspace name override (normally read from the export's index.html). */
  workspace?: string | null;
};

export type Imported = {
  pack: Pack;
  /** What was found: pages, tables, rows, and attachments ready to upload. */
  found: { pages: number; tables: number; rows: number; files: number };
  /** Images and attachments to upload and attach, keyed by record path. */
  attachments: Map<string, NotionAttachment[]>;
  /** Body templates carrying placeholder tokens for records with linked attachments (used by applyNotion). */
  bodyTemplates: Map<string, string>;
  /** Files that weren't brought in (over size limit, empty, unowned), with plain reasons. */
  skipped: SkippedFile[];
  /** Plain summary notes (column kind changes, skipped files). */
  notes: string[];
  /** Workspace name found in the export's index.html, if any. */
  workspace: string | null;
  /** The folder it all lands under: `Notion/`, or `Notion/<workspace>/`. */
  root: string;
};

const ID = / ?[0-9a-f]{32}$/i;
/** A name less Notion's id. */
export const bare = (seg: string) => seg.replace(ID, "").trim();
const ext = (p: string) => /\.([a-z0-9]+)$/i.exec(p)?.[1]?.toLowerCase() ?? "";
const noExt = (p: string) => p.replace(/\.[a-z0-9]+$/i, "");
const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff",
  heic: "image/heic", heif: "image/heif",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo", mkv: "video/x-matroska",
  pdf: "application/pdf", txt: "text/plain", json: "application/json", xml: "application/xml", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rtf: "application/rtf",
};
/** Media type inferred from a filename's extension. */
export const mimeOf = (name: string) => MIME[ext(name)] ?? "application/octet-stream";

/** Human-readable byte size for plain messages. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 || Number.isInteger(mb) ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}

/** Encode a vault storage path for markdown links (`/api/storage/...`), escaping spaces and parentheses cleanly
 *  without percent-encoding dots or slashes (which surface-render's traversal guard rejects). */
export function storageHref(storagePath: string): string {
  const clean = storagePath.replace(/^\/+/, "");
  return `/api/storage/${clean.split("/").map((s) => encodeURIComponent(s).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"))).join("/")}`;
}

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

const IGNORED = /(^|\/)(__MACOSX|\.DS_Store)(\/|$)|(^|\/)\._/;
const isIndexHtml = (path: string) => /^([^/]+\/)?index\.html$/i.test(path);

/** Zip entry filter for a Notion export: unpacks pages (.md), tables (.csv), index.html (for the workspace name),
 *  and images/attachments within the per-file and total size limits. Oversized/excess files are left unpacked and
 *  reported via readZip's `onSkip` so the rest of the export still comes in. One per readZip (it counts the budget);
 *  give readZip `max: NOTION_ZIP_MAX`, so the attachments' budget comes on top of the pages' own, not out of it. */
export function notionWant(opts: { maxFile?: number; maxTotal?: number } = {}): (path: string, size: number) => boolean {
  const maxFile = opts.maxFile ?? ATTACHMENT_MAX;
  const maxTotal = opts.maxTotal ?? ATTACHMENT_TOTAL_MAX;
  let attached = 0;
  return (path: string, size = 0) => {
    if (IGNORED.test(path)) return false;
    if (/\.(md|csv)$/i.test(path)) return true;
    if (isIndexHtml(path)) return size <= INDEX_MAX;
    if (size <= 0 || size > maxFile || attached + size > maxTotal) return false;
    attached += size;
    return true;
  };
}

/** Decode basic HTML entities in text extracted from Notion's index.html. */
function decodeHtml(s: string): string {
  // (&amp; last, so an escaped entity, "&amp;lt;", is read once: "&lt;")
  return s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ""; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const c = parseInt(h, 16); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ""; })
    .replace(/&amp;/gi, "&");
}

/** The workspace's name, from the line Notion's export index.html says it in ("Workspace name: …"); null without one. */
export function workspaceFromIndex(html: string): string | null {
  const clean = (raw: string) => decodeHtml(raw.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().slice(0, 80);
  // table form: <th>Workspace name</th><td>Studio</td>
  const td = /<t[hd][^>]*>\s*workspace\s*name\s*:?\s*<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
  if (td) { const w = clean(td[1]); if (w) return w; }
  // prose form: <p>Workspace name: Juno's studio</p>
  const plain = decodeHtml(html.replace(/<(?:br\s*\/?|\/(?:p|div|li|tr|h[1-6]|td|th))>/gi, "\n").replace(/<[^>]*>/g, ""));
  const m = /workspace\s*name\s*:\s*([^\n]+)/i.exec(plain);
  if (m) { const w = m[1].replace(/\s+/g, " ").trim().slice(0, 80); if (w) return w; }
  // (nothing else is guessed at, its <title> or first heading: a name that changed between exports would put a newer
  // export of the same workspace in a folder and types of its own)
  return null;
}

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes; a BOM first is dropped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\ufeff/, "");
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
  return links(raw)?.map((l) => l.to) ?? null;
}
/** The same, each with the title written before it (what a link to a page outside the export is known by). */
function links(raw: string): { title: string; to: string }[] | null {
  const re = /\(((?:[^()]|\([^()]*\))+?\.(?:md|csv)|https?:\/\/(?:www\.)?notion\.so\/[^\s()]*?[0-9a-f]{32}[^\s()]*)\)/gi;
  const out: { title: string; to: string }[] = [];
  let last = 0;
  for (const m of raw.matchAll(re)) {
    // what came before this link, after the last one and its comma, is its title: there must be one
    const title = raw.slice(last, m.index).replace(/^\s*,/, "").trim();
    if (!title) return null;
    out.push({ title, to: /^https?:/i.test(m[1]) ? m[1] : dec(m[1]) });
    last = m.index! + m[0].length;
  }
  return out.length && !raw.slice(last).trim() ? out : null;
}

const isNumberVal = (x: string) => /^-?\d+(\.\d+)?$/.test(x.replace(/,(?=\d{3}\b)/g, "")) && !/^-?0\d/.test(x);
const isIntVal = (x: string) => /^-?\d+$/.test(x.replace(/,(?=\d{3}\b)/g, "")) && !/^-?0\d/.test(x);
const isListItemVal = (x: string) => !/^[\d\s.,-]+$/.test(x) && x.split(",").every((t) => { const w = t.trim(); return w.length > 0 && w.length <= 40 && !/[.!?]$/.test(w); });

type Kind = "date" | "number" | "boolean" | "list" | "relation" | "text";
/** A column's kind, from every value it has: one that doesn't fit makes the column text. */
function kindOf(values: string[], header = ""): Kind {
  const v = values.map((x) => x.trim()).filter(Boolean);
  if (!v.length) return "text";
  if (v.every((x) => relations(x))) return "relation";
  if (v.every((x) => /^(yes|no)$/i.test(x))) return "boolean";
  if (v.every((x) => notionDate(x))) return "date";
  // (a leading zero is an id, a zip code, not a number: kept as written)
  if (v.every(isNumberVal)) return "number";
  // a multi-select: short words split by commas, with no sentence in them
  // (not a number with a decimal comma, "1,5")
  // (and a choice used in more than one row, as a select's options are: "Le Guin, Ursula" names one author)
  const seen = new Map<string, number>();
  for (const x of v) for (const t of new Set(x.split(",").map((w) => w.trim().toLowerCase()))) seen.set(t, (seen.get(t) ?? 0) + 1);
  // (or a column named as a multi-select is: Tags, Labels, Categories, Topics)
  const tagsByName = /^(tags?|labels?|categor(y|ies)|topics?|keywords?)$/i.test(header.trim());
  if (v.some((x) => x.includes(",")) && !v.every((x) => /^[\d\s.,-]+$/.test(x)) && (tagsByName || [...seen.values()].some((n) => n > 1)) && v.every(isListItemVal)) return "list";
  return "text";
}
const SPEC: Record<Exclude<Kind, "relation">, FieldSpec> = { date: { type: "date" }, number: { type: "number" }, boolean: { type: "boolean" }, list: { type: "array" }, text: { type: "string" } };

const slugOf = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const guardType = (t: string) => (/^(publish|published|applet|component|parachute|template)/.test(t) ? `my-${t}`.slice(0, 36).replace(/-+$/, "") : t);

/** A name a vault takes for a type: lower case, words joined by "-". */
function typeName(title: string, taken: Set<string>, byWorkspace: (base: string) => string | null = () => null): string {
  let base = slugOf(title).replace(/^[0-9-]+/, "").slice(0, 36).replace(/-+$/, "");
  if (!base) base = "notion-table";
  base = guardType(base);
  // a name another workspace's import holds is named by this workspace ("personal-tasks"), not "-2"; one the person's
  // own type, or another table of this export, holds is "-2" (book-2, tasks-2)
  const workspace = byWorkspace(base);
  if (taken.has(base) && workspace) {
    const ws = slugOf(workspace);
    if (ws) {
      const wsPart = ws.slice(0, 18).replace(/-+$/, "");
      const titlePart = base.slice(0, 17).replace(/-+$/, "");
      const combined = /^[a-z]/.test(wsPart)
        ? guardType(`${wsPart}-${titlePart}`.slice(0, 36).replace(/-+$/, ""))
        : guardType(`${titlePart}-${wsPart}`.slice(0, 36).replace(/-+$/, ""));
      if (combined) base = combined;
    }
  }
  let n = base, i = 2;
  while (taken.has(n)) n = `${base}-${i++}`;
  taken.add(n);
  return n;
}
/** A name a vault takes for a field: lower case, words joined by "_". */
function fieldName(header: string, taken: Set<string>): string {
  let f = header.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9_]+/, "").slice(0, 36).replace(/_+$/, "");
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

/** Description stamped on a type made by Notion import, scoped by workspace when known. */
const typeDescription = (title: string, workspace: string | null) => workspace ? `From Notion (${workspace}): ${title}.` : `From Notion: ${title}.`;

/** Try to fit a raw CSV cell value into an existing vault field type. */
function fitValue(v: string, vaultType: string, resolveRel: (raw: string) => string[] | null): { ok: true; value: unknown } | { ok: false } {
  switch (vaultType) {
    case "string": return { ok: true, value: v };
    case "date": { const d = notionDate(v); return d ? { ok: true, value: d } : { ok: false }; }
    case "boolean": return /^(yes|no|true|false)$/i.test(v) ? { ok: true, value: /^(yes|true)$/i.test(v) } : { ok: false };
    case "number": return isNumberVal(v) ? { ok: true, value: Number(v.replace(/,(?=\d{3}\b)/g, "")) } : { ok: false };
    case "integer": return isIntVal(v) ? { ok: true, value: Number(v.replace(/,(?=\d{3}\b)/g, "")) } : { ok: false };
    case "reference": { const r = resolveRel(v); return r ? { ok: true, value: r } : { ok: false }; }
    // (into a list it already is, a tag that is a number, "2024", is one; a date, "March 2, 2026", isn't two)
    case "array": return !notionDate(v) && v.split(",").every((t) => { const w = t.trim(); return w.length > 0 && w.length <= 40 && !/[.!?]$/.test(w); }) ? { ok: true, value: v.split(",").map((x) => x.trim()).filter(Boolean) } : { ok: false };
    default: return { ok: false };
  }
}

/** A type the vault has already, as the import reads it: its name and its declared fields (packs.ts HeldType). */
export type Held = { name: string; description?: string | null; fields: Record<string, { type?: string; indexed?: boolean }> };

/** Notion's Markdown & CSV export, as a pack plus its attachments. `name`: the file's name, for the receipt.
 *  `held`: the vault's types. One an import made for this workspace ("From Notion (<ws>): <title>.", or "From Notion:
 *  <title>." when no workspace name is in the export) is that table's again, so a newer export of the same workspace
 *  adds to it. A same-titled table from another workspace gets its own distinct type named by workspace. Any column
 *  whose kind changed between exports keeps the existing field for values that fit and sends values that don't fit to
 *  a text field with a note in the summary, never silently dropped. */
export function notionImport(files: Map<string, Uint8Array>, name = "Notion export", held: Held[] = [], opts: NotionImportOptions = {}): Imported {
  const text = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
  const maxFile = opts.maxFile ?? ATTACHMENT_MAX;
  const maxTotal = opts.maxTotal ?? ATTACHMENT_TOTAL_MAX;
  const skippedSizes = opts.skippedSizes ?? new Map<string, number>();

  // the export's own wrapping: hidden files, its index page, and one root folder above everything
  let paths = [...files.keys()].filter((p) => !IGNORED.test(p));
  const first = new Set(paths.map((p) => p.split("/")[0]));
  const strip = first.size === 1 && paths.every((p) => p.includes("/")) && !paths.some((p) => p === `${[...first][0]}.md`) ? `${[...first][0]}/` : "";
  const rel = (p: string) => p.slice(strip.length);

  // read workspace name from index.html before stripping it from export paths
  const indexPath = paths.find((p) => (strip ? rel(p) === "index.html" : p === "index.html"));
  const indexBytes = indexPath ? files.get(indexPath) : undefined;
  const workspace = opts.workspace !== undefined
    ? (opts.workspace?.trim() || null)
    : (indexBytes && indexBytes.byteLength > 0 ? workspaceFromIndex(text(indexBytes)) : null);

  paths = paths.filter((p) => !(strip ? rel(p) === "index.html" : p === "index.html"));
  if (!paths.some((p) => ext(p) === "md" || ext(p) === "csv")) throw new Error("This zip has no Notion pages in it. In Notion: Settings, Export, Markdown & CSV.");

  /** Where an export path lands: Notion/<titles, less ids>, short enough for a vault. */
  const root = workspace ? `${ROOT}${seg(workspace)}/` : ROOT;
  const placeOf = (p: string) => fit(root + rel(noExt(p)).split("/").map((s) => seg(bare(dec(s)))).join("/"));
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

  const resolve = (from: string, targetPath: string): string => {
    const t = dec(targetPath.replace(/[?#].*$/, ""));
    const parts = (t.startsWith("/") ? [] : from.split("/").slice(0, -1));
    for (const s of t.split("/")) { if (s === "..") parts.pop(); else if (s && s !== ".") parts.push(s); }
    return parts.join("/");
  };

  // every page and table by Notion's id, so a notion.so link finds what it became
  const byId = new Map<string, string>();
  for (const p of paths) { const id = idIn(noExt(p.replace(/_all\.csv$/i, ".csv")).split("/").pop()!); if (id && /\.(md|csv)$/i.test(p)) byId.set(id, p.replace(/_all\.csv$/i, ".csv")); }
  /** Where a link leads in the export: a notion.so link by its id, a path from where it is written. */
  const target = (from: string, raw: string) => (/^https?:/i.test(raw) ? byId.get(idIn(raw) ?? "") ?? raw : resolve(from, raw));

  const notes: string[] = [];

  // 1. Databases: one per "<title> <id>", from its _all.csv when there is one, each a type
  const dbs = new Map<string, string>();
  for (const p of paths.filter((x) => ext(x) === "csv")) {
    const key = p.replace(/_all\.csv$/i, ".csv");
    if (!dbs.has(key) || /_all\.csv$/i.test(p)) dbs.set(key, p);
  }
  const rowFolder = (csvKey: string) => noExt(csvKey) + "/";
  const inFolder = (p: string, k: string) => p.startsWith(rowFolder(k)) && !p.slice(rowFolder(k).length).includes("/");
  type Col = { header: string; field: string; kind: Kind; i: number; existingType?: string; overflowField?: string; overflowCount?: number };
  type Table = { key: string; csv: string; title: string; type: string; again?: Held; place: string; header: string[]; body: string[][]; cols: Col[] };
  // (two tables of one title made tasks and tasks-2: each takes the first one left, in the same order as then;
  // scoped by workspace so two workspaces' same-titled tables never share one type)
  const claimed = new Set<string>();
  const fromNotion = (title: string) => {
    const desc = typeDescription(title, workspace);
    const h = held.filter((x) => x.description === desc && !claimed.has(x.name)).sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))[0];
    if (h) claimed.add(h.name);
    return h;
  };
  // a new table's name avoids every type the vault has (a table found again keeps its own)
  const typeNames = new Set<string>(held.map((h) => h.name));
  // the types another workspace's import made (or one before workspaces were named, when this export names its own)
  const otherWorkspace = new Set(held.filter((h) => /^From Notion[ :]/.test(h.description ?? "") && !(h.description ?? "").startsWith(workspace ? `From Notion (${workspace}): ` : "From Notion: ")).map((h) => h.name));
  const tables: Table[] = [];
  for (const [key, csv] of dbs) {
    const [header = [], ...body] = parseCsv(text(files.get(csv)!));
    if (!header.length) continue;
    const taken = new Set<string>();
    const title = bare(noExt(key.split("/").pop()!));
    const again = fromNotion(title);
    const tName = again?.name ?? typeName(title, typeNames, (base) => (otherWorkspace.has(base) ? workspace : null));
    const plainFields = header.slice(1).map((h) => fieldName(h, taken));
    const cols: Col[] = header.slice(1).map((h, i) => {
      let f = plainFields[i];
      // a column the earlier import named apart ("date_2", beside another type's date) is that field again
      if (again && !Object.hasOwn(again.fields, f)) {
        const was = Object.keys(again.fields).filter((k) => new RegExp(`^${f}_\\d+$`).test(k) && !plainFields.includes(k)).sort((a, b) => Number(a.slice(f.length + 1)) - Number(b.slice(f.length + 1)))[0];
        if (was) f = was;
      }
      const existing = again && Object.hasOwn(again.fields, f) ? again.fields[f] : undefined;
      return { header: h.trim(), field: f, kind: kindOf(body.map((r) => r[i + 1] ?? ""), h), i: i + 1, ...(existing?.type ? { existingType: existing.type } : {}) };
    });
    tables.push({ key, csv, title, type: tName, again, place: unique(placeOf(key)), header, body, cols });
  }
  // a field is one thing in a vault: where two new tables have a column of one name but of different kinds, it is text
  // in both (a vault refuses a type whose field another type declares otherwise); a column already declared on an
  // existing Notion type keeps its vault type (non-fitting values go to an overflow text field below)
  const kinds = new Map<string, Set<Kind>>();
  for (const t of tables) for (const c of t.cols) if (!c.existingType) kinds.set(c.field, (kinds.get(c.field) ?? new Set()).add(c.kind));
  for (const t of tables) for (const c of t.cols) if (!c.existingType && (kinds.get(c.field)?.size ?? 0) > 1) c.kind = "text";
  // and one the vault's own types declare otherwise is another field here
  const specOf = (c: Col): FieldSpec => {
    if (c.existingType) {
      if (c.existingType === "reference") return { type: "reference", cardinality: "many" };
      if (["string", "number", "integer", "boolean", "array", "date"].includes(c.existingType)) return { type: c.existingType };
    }
    return c.kind === "relation" ? { type: "reference", cardinality: "many" } : SPEC[c.kind as Exclude<Kind, "relation">];
  };
  // (what a vault refuses beside another type's field of that name: another kind, or an indexed one; cardinality it takes)
  // (every type but the table's own again: another import's types count as much as the person's)
  const clash = (f: string, spec: FieldSpec, own: string) => held.some((h) => { const d = h.name !== own && Object.hasOwn(h.fields, f) && h.fields[f]; return !!d && (d.type !== spec.type || !!d.indexed); });
  const renamed = new Map<string, string>();
  for (const t of tables) for (const c of t.cols) {
    if (c.existingType) continue;
    if (!clash(c.field, specOf(c), t.type)) continue;
    if (!renamed.has(`${c.field}|${c.kind}`)) {
      let i = 2, n = `${c.field}_${i}`;
      while (clash(n, specOf(c), t.type) || held.some((h) => h.name !== t.type && Object.hasOwn(h.fields, n)) || tables.some((x) => x.cols.some((y) => y.field === n))) n = `${c.field}_${++i}`;
      renamed.set(`${c.field}|${c.kind}`, n);
    }
    c.field = renamed.get(`${c.field}|${c.kind}`)!;
  }
  /** Pick a free `string` field name for values that don't fit an existing column's vault type (reusing `<field>_text`
   *  on the same table if a previous re-import already added it as string). */
  const pickOverflowField = (t: Table, c: Col): string => {
    const base = `${c.field.slice(0, 31).replace(/_+$/, "")}_text`;
    const ok = (n: string) => {
      if (t.cols.some((y) => y.field === n || y.overflowField === n)) return false;
      const ownField = t.again && Object.hasOwn(t.again.fields, n) ? t.again.fields[n] : undefined;
      if (ownField && (ownField.type !== "string" || !!ownField.indexed)) return false;
      if (clash(n, { type: "string" }, t.type)) return false;
      if (tables.some((x) => x !== t && x.cols.some((y) => y.field === n && specOf(y).type !== "string"))) return false;
      return true;
    };
    if (ok(base)) return base;
    let i = 2;
    while (!ok(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  };

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

  // 3. Attachments: judge every non-md/csv file against size limits once, track which records claim it
  const attachments = new Map<string, NotionAttachment[]>();
  const bodyTemplates = new Map<string, string>();
  const skippedMap = new Map<string, SkippedFile>();
  const claimedFiles = new Set<string>();
  const validFiles = new Map<string, { bytes: Uint8Array; name: string; mimeType: string }>();
  const rejectedFiles = new Map<string, { name: string; reason: string; shortReason: string }>();
  let totalAttachBytes = 0;

  for (const p of paths) {
    if (["md", "csv"].includes(ext(p))) continue;
    const rawName = dec(p.split("/").pop() ?? p);
    const bytes = files.get(p)!;
    const declaredSize = bytes.byteLength > 0 ? bytes.byteLength : (skippedSizes.get(p) ?? 0);
    if (declaredSize <= 0) {
      rejectedFiles.set(p, { name: rawName, reason: `${rawName} was skipped: the file is empty.`, shortReason: "empty file" });
    } else if (declaredSize > maxFile) {
      rejectedFiles.set(p, { name: rawName, reason: `${rawName} (${formatSize(declaredSize)}) was skipped: over the ${formatSize(maxFile)} attachment limit.`, shortReason: `over the ${formatSize(maxFile)} limit` });
    } else if (bytes.byteLength === 0 || totalAttachBytes + bytes.byteLength > maxTotal) {
      rejectedFiles.set(p, { name: rawName, reason: `${rawName} (${formatSize(declaredSize)}) was skipped: this import reached the ${formatSize(maxTotal)} attachment limit.`, shortReason: `over the ${formatSize(maxTotal)} attachment limit` });
    } else {
      totalAttachBytes += bytes.byteLength;
      validFiles.set(p, { bytes, name: rawName, mimeType: mimeOf(rawName) });
    }
  }
  const markSkipped = (p: string, name: string, reason: string) => {
    if (skippedMap.has(p)) return;
    skippedMap.set(p, { path: rel(p), name, reason });
    notes.push(reason);
  };
  let tokenSeq = 0;
  // (a token holds a ":", so the relation-as-text rule below never takes it for a page's title)
  const nextToken = (body: string) => {
    let tok = `⟦notion-file:${tokenSeq++}⟧`;
    while (body.includes(tok)) tok = `⟦notion-file:${tokenSeq++}⟧`;
    return tok;
  };
  const addAttachment = (recordPath: string, att: NotionAttachment) => {
    attachments.set(recordPath, [...(attachments.get(recordPath) ?? []), att]);
  };

  // 4. Words: links to pages as wikilinks; images & attachments become vault attachments with links rewritten
  const tableAt = (to: string) => tables.find((t) => t.key === to.replace(/_all\.csv$/i, ".csv"));
  const wiki = (rec: string, label: string) => `[[${rec}${label && label !== rec.split("/").pop() ? `|${label}` : ""}]]`;
  /** The words as they land (`fallback`: a file said to have stayed in the export), and, where a file will be attached,
   *  the same words with a token at each such link, for applyNotion to put the vault's link in (`template`). */
  const words = (from: string, recordPath: string, body: string): { fallback: string; template: string | null } => {
    const said = new Map<string, string>(); // token -> what the words say when the file isn't attached
    const template = body
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
        const valid = validFiles.get(to);
        if (valid) {
          claimedFiles.add(to);
          const token = nextToken(body);
          addAttachment(recordPath, { token, image: !!img, label, exportPath: to, relPath: rel(to), name: valid.name, mimeType: valid.mimeType, bytes: valid.bytes });
          said.set(token, img ? `*(image ${file}: it stayed in your Notion export)*` : `${label || file} *(it stayed in your Notion export)*`);
          return token;
        }
        const rej = rejectedFiles.get(to);
        if (rej) {
          claimedFiles.add(to);
          markSkipped(to, rej.name, rej.reason);
          return img ? `*(image ${file}: skipped, ${rej.shortReason})*` : `${label || file} *(skipped, ${rej.shortReason})*`;
        }
        const there = files.has(to);
        return img ? `*(image ${file}: ${there ? "it stayed in your Notion export" : "not in your Notion export"})*`
          : `${label || file} *(${there ? "it stayed in your Notion export" : "not in your Notion export"})*`;
      })
      // a relation written into a page as text, "Title (path.md)": a wikilink, where it is a page of the export
      // (after a line's start, a property's "Key: " or another link's ", "; its title has no ":" or "," of its own)
      .replace(/(^|: |, )([^\n()[\]:,]+?) \(([^()\s]+\.md|https?:\/\/(?:www\.)?notion\.so\/[^()\s]*)\)/gim, (all, lead: string, label: string, link: string) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^https?:\/\/(?:www\.)?notion\.so\//i.test(link)) return all;
        const rec = place.get(target(from, link));
        return rec ? `${lead}${wiki(rec, label.trim())}` : all;
      })
      // Notion writes a checklist item as "- [ ]  text", two spaces after the box
      .replace(/^(\s*[-*] \[[ xX]\]) {2,}/gm, "$1 ");

    if (!said.size) return { fallback: template, template: null };
    let fallback = template;
    for (const [tok, words] of said) fallback = fallback.replace(tok, () => words);
    return { fallback, template };
  };

  // 5. Records: rows and pages first (so we know any overflow text fields needed for existing types), then types
  const records: PackRecord[] = [];
  for (const t of tables) {
    records.push({ path: t.place, body: `This was the Notion table **${t.title}**. Its rows are the type ${t.type} here: open it in Vault.\n` });
  }
  const resolveRel = (csv: string) => (raw: string): string[] | null => {
    const ls = links(raw);
    if (!ls) return null;
    return ls.map(({ title, to }) => {
      const f = target(csv, to);
      return place.get(f) ?? tableAt(f)?.place ?? (/^https?:/i.test(to) ? title : bare(to.split("/").pop()!.replace(/\.md$/, "")));
    });
  };
  for (const { t, r, path, page } of rowOf) {
    const fields: Record<string, unknown> = {};
    const relOf = resolveRel(t.csv);
    for (const c of t.cols) {
      const v = (r[c.i] ?? "").trim();
      if (!v) continue;
      if (c.existingType) {
        const fitted = fitValue(v, c.existingType, relOf);
        if (fitted.ok) {
          fields[c.field] = fitted.value;
        } else {
          c.overflowField ??= pickOverflowField(t, c);
          c.overflowCount = (c.overflowCount ?? 0) + 1;
          fields[c.overflowField] = v;
        }
        continue;
      }
      fields[c.field] = c.kind === "date" ? notionDate(v)
        : c.kind === "number" ? Number(v.replace(/,(?=\d{3}\b)/g, ""))
        : c.kind === "boolean" ? /^yes$/i.test(v)
        : c.kind === "list" ? v.split(",").map((x) => x.trim()).filter(Boolean)
        : c.kind === "relation" ? relOf(v)!
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
      const rawBody = l.slice(i).join("\n").trim();
      if (rawBody) {
        const w = words(page, path, rawBody);
        body = `${w.fallback}\n`;
        if (w.template !== null) bodyTemplates.set(path, `${w.template}\n`);
      }
    }
    records.push({ path, types: [t.type], fields, body });
  }
  // pages, and a row's page its table's CSV didn't list: their words, less the title line (the path names them)
  const rowPages = new Set(rowOf.map((x) => x.page).filter(Boolean));
  let pageCount = 0;
  for (const p of paths.filter((x) => ext(x) === "md" && !rowPages.has(x))) {
    const recPath = place.get(p)!;
    const l = lines(p);
    if (/^# /.test(l[0] ?? "")) l.shift();
    const w = words(p, recPath, l.join("\n").trim());
    records.push({ path: recPath, body: `${w.fallback}\n` });
    if (w.template !== null) bodyTemplates.set(recPath, `${w.template}\n`);
    pageCount++;
  }

  // Unlinked files sitting inside a page's, row's, or table's folder belong to that record (deepest prefix wins)
  const folders: { prefix: string; recordPath: string }[] = [
    ...[...place.entries()].map(([p, recPath]) => ({ prefix: `${noExt(p)}/`, recordPath: recPath })),
    ...tables.map((t) => ({ prefix: rowFolder(t.key), recordPath: t.place })),
  ].sort((a, b) => b.prefix.length - a.prefix.length);

  for (const p of paths) {
    if (["md", "csv"].includes(ext(p)) || claimedFiles.has(p)) continue;
    const owner = folders.find((f) => p.startsWith(f.prefix));
    const valid = validFiles.get(p);
    if (valid) {
      if (owner) {
        claimedFiles.add(p);
        addAttachment(owner.recordPath, { token: null, image: valid.mimeType.startsWith("image/"), label: valid.name, exportPath: p, relPath: rel(p), name: valid.name, mimeType: valid.mimeType, bytes: valid.bytes });
      } else {
        markSkipped(p, valid.name, `${valid.name} wasn't attached: it doesn't belong to any page in the export.`);
      }
      continue;
    }
    const rej = rejectedFiles.get(p);
    if (rej) markSkipped(p, rej.name, rej.reason);
  }

  // Build types, including any overflow text fields added for changed column kinds, with summary notes
  const types: Pack["types"] = {};
  for (const t of tables) {
    const fieldSpecs: Record<string, FieldSpec> = {};
    for (const c of t.cols) {
      fieldSpecs[c.field] = specOf(c);
      if (c.overflowField && c.overflowCount) {
        fieldSpecs[c.overflowField] = { type: "string" };
        notes.push(`In ${t.title}, ${c.header} is ${c.existingType} here, so ${c.overflowCount} value${c.overflowCount === 1 ? "" : "s"} that didn't fit went to ${c.overflowField}.`);
      }
    }
    types[t.type] = { description: typeDescription(t.title, workspace), fields: fieldSpecs };
  }

  // Count distinct export files queued for attachment
  const attachedExportFiles = new Set<string>();
  for (const list of attachments.values()) for (const a of list) attachedExportFiles.add(a.exportPath);
  const skipped = [...skippedMap.values()];
  const rows = rowOf.length;
  const dbsCount = tables.length;

  const label = name.replace(/\.zip$/i, "").slice(0, 60) || "Notion export";
  const pack = checkPack({
    parachute_pack: 1, id: `notion-${idOf(paths.map(rel))}`, name: `Notion: ${label}`, version: 1, source: NOTION_SOURCE,
    summary: `${pageCount} page${pageCount === 1 ? "" : "s"} and ${dbsCount} table${dbsCount === 1 ? "" : "s"} from Notion.`,
    types, records,
  });
  return { pack, found: { pages: pageCount, tables: dbsCount, rows, files: attachedExportFiles.size }, attachments, bodyTemplates, skipped, notes, workspace, root };
}

export type NotionTarget = PackTarget & {
  /** Upload a file to vault storage; returns its storage path. */
  upload?(name: string, bytes: Uint8Array, mimeType: string): Promise<{ path: string; mimeType?: string }>;
  /** Attach an uploaded storage path to a record. */
  attach?(recordId: string, path: string, mimeType: string): Promise<{ id?: string; path: string; mimeType?: string }>;
  /** Patch a newly created record's body with rewritten `/api/storage/...` links. */
  updateBody?(recordId: string, body: string, updatedAt: string | null): Promise<{ updatedAt: string | null }>;
};

export type AppliedNotion = Applied & {
  /** Number of attachments attached to newly created records in this run. */
  attached: number;
  /** Files that weren't attached (size limits, empty, unowned, or upload failures), by export path. */
  left: string[];
};

/** Apply a parsed Notion import to a vault: creates types & records via `applyPack`, uploads and attaches each newly
 *  created record's images/attachments, and rewrites body links to `/api/storage/...`. Re-importing the same export
 *  uploads and changes nothing. */
export async function applyNotion(imported: Imported, target: NotionTarget): Promise<AppliedNotion> {
  const canAttach = !!(target.upload && target.attach && target.updateBody);
  const uploaded = new Map<string, Promise<{ path: string; mimeType: string }>>();
  const attachNotes: string[] = [];
  const failedPaths: string[] = [];
  let attached = 0;

  const uploadOnce = (att: NotionAttachment) => {
    let p = uploaded.get(att.exportPath);
    if (!p) {
      // (one that failed is tried again for the next record that links it)
      p = target.upload!(att.name, att.bytes, att.mimeType).then((r) => ({ path: r.path, mimeType: r.mimeType ?? att.mimeType }), (e) => { uploaded.delete(att.exportPath); throw e; });
      uploaded.set(att.exportPath, p);
    }
    return p;
  };

  const wrapped: PackTarget = {
    ...target,
    async create(rec) {
      const created = await target.create(rec);
      if ("refused" in created || created.existed) return created;
      const atts = imported.attachments.get(rec.path);
      if (!atts?.length) return created;
      if (!canAttach) {
        for (const a of atts) if (!failedPaths.includes(a.relPath)) failedPaths.push(a.relPath);
        attachNotes.push(`Attachments on ${rec.path} weren't uploaded: this vault connection doesn't upload files.`);
        return created;
      }
      const attachedStorage = new Set<string>();
      const replacements = new Map<string, string>();
      for (const a of atts) {
        try {
          const up = await uploadOnce(a);
          if (!attachedStorage.has(up.path)) {
            await target.attach!(created.id, up.path, up.mimeType);
            attachedStorage.add(up.path);
            attached++;
          }
          if (a.token) {
            const href = storageHref(up.path);
            replacements.set(a.token, a.image ? `![${a.label}](${href})` : `[${a.label || a.name}](${href})`);
          }
        } catch (e) {
          const why = e instanceof Error ? e.message.slice(0, 120) : "upload failed";
          attachNotes.push(`${a.name} wasn't attached: ${why}`);
          if (!failedPaths.includes(a.relPath)) failedPaths.push(a.relPath);
          if (a.token) {
            replacements.set(a.token, a.image ? `*(image ${a.name}: couldn't be attached)*` : `${a.label || a.name} *(couldn't be attached)*`);
          }
        }
      }
      const tmpl = imported.bodyTemplates.get(rec.path);
      // (also when every upload failed: the body then says each couldn't be attached, not that it stayed in the export)
      if (tmpl && replacements.size) {
        let nextBody = tmpl;
        for (const [tok, rep] of replacements) nextBody = nextBody.replace(tok, () => rep);
        try {
          const patched = await target.updateBody!(created.id, nextBody, created.updatedAt);
          return { ...created, updatedAt: patched.updatedAt ?? created.updatedAt };
        } catch (e) {
          attachNotes.push(`${rec.path}'s attachment links weren't updated: ${e instanceof Error ? e.message.slice(0, 120) : "update failed"}`);
        }
      }
      return created;
    },
  };

  const applied = await applyPack(imported.pack, wrapped);
  return {
    ...applied,
    attached,
    // (an export already here wrote nothing: what it says of values written is left out, what it left behind isn't)
    notes: [...(applied.changed ? imported.notes : imported.skipped.map((x) => x.reason)), ...attachNotes, ...applied.notes],
    left: [...imported.skipped.map((x) => x.path), ...failedPaths],
  };
}
