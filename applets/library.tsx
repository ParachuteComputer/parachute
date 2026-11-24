// Library: Shelf, Book, Read, Quotes (T-476).
// Folder-scoped to Books/ (read, update) and Quotes/ (read, create, update).
// Record types (from the Library pack):
//   book     Books/<Title>                author, translator, language, kind, status, rating, finished, source, rights, at
//   chapter  Books/<Title>/<NN Chapter>   book, part, order, words
//   summary  Books/<Title>/Summaries/...  of, sources, by, made
//   quote    Quotes/<Book>/<stamp slug>   from, book, block, before, after, by, used_in
//
// Scrolling everywhere (no page-turning). Quotes are marked directly in the reading view and round-trip via
// block + before/after context locators. Where you stopped (`book.fields.at`) is written to the book when you leave.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  app, Button, Card, Drawer, Empty, Fields, List, Loading, Note, onBack, onOpen, onShown, Page, Problem,
  ready, Search, still as kitStill, Tabs, toast, useSaved, vault, when, Write,
} from "parachute";

const isStill = kitStill ?? (() => typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue("--t-state").trim() === "0ms");

// ── pure helpers (tested in src/applet/libraryApplet.test.ts) ──

type LibraryRecord = {
  id: string;
  path: string;
  createdAt?: string | null;
  updatedAt: string | null;
  tags?: string[];
  types?: string[];
  fields?: Record<string, unknown>;
  body?: string;
};

type BookFields = {
  author: string;
  translator: string;
  language: string;
  kind: string;
  status: string;
  rating: number | null;
  finished: string;
  source: string;
  rights: string;
  at: string;
  cover: string;
};

type QuoteLocator = {
  quote: string;
  block: number;
  before: string;
  after: string;
};

type BlockSelection = {
  startBlock: number;
  startOffset: number;
  endBlock: number;
  endOffset: number;
};

type LocatedQuote = BlockSelection & {
  flatStart: number;
  flatEnd: number;
  score: number;
};

type ParsedQuote = {
  record: LibraryRecord;
  text: string;
  note: string;
  bookRef: string;
  chapterRef: string;
  block: number | null;
  before: string;
  after: string;
  by: string;
};

type ChapterGroup = {
  part: LibraryRecord | null;
  title: string;
  chapters: LibraryRecord[];
};

type BookBundle = {
  book: LibraryRecord;
  title: string;
  fields: BookFields;
  coverSrc: string;
  chapters: LibraryRecord[];
  groups: ChapterGroup[];
  bookSummaries: LibraryRecord[];
  summariesByChapter: Map<string, LibraryRecord[]>;
  quotes: ParsedQuote[];
};

type OrganizedLibrary = {
  books: BookBundle[];
  bookByKey: Map<string, BookBundle>;
  chapterByKey: Map<string, { chapter: LibraryRecord; book: BookBundle }>;
  summaryByKey: Map<string, { summary: LibraryRecord; book: BookBundle; chapter: LibraryRecord | null }>;
  quoteByKey: Map<string, ParsedQuote>;
  quotes: ParsedQuote[];
};

type HighlightSlice = {
  start: number;
  end: number;
  quoteIds: string[];
};

const BOOKS_FOLDER = "Books/";
const QUOTES_FOLDER = "Quotes/";
const BOOK_STATUSES = ["want to read", "reading", "read"] as const;
const BOOK_KINDS = ["book", "scripture", "cookbook", "method"] as const;
const CONTEXT_LEN = 48;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
};

function stripMd(path: string): string {
  return path.replace(/\.md$/i, "").trim();
}

function normalizeRef(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  const wiki = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(s);
  if (wiki) s = wiki[1].trim();
  return stripMd(s);
}

function hasRecordKind(rec: Pick<LibraryRecord, "tags" | "types">, kind: string): boolean {
  const low = kind.toLowerCase();
  const all = [...(rec.types ?? []), ...(rec.tags ?? [])];
  return all.some((t) => {
    const s = String(t).toLowerCase();
    return s === low || s.startsWith(`${low}/`);
  });
}

function basenameOf(path: string): string {
  const clean = stripMd(path);
  const parts = clean.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? clean;
}

function bookTitleOf(path: string): string {
  const clean = stripMd(path).replace(/^Books\//, "");
  return clean.split("/")[0]?.trim() || clean;
}

function chapterDisplayTitle(rec: Pick<LibraryRecord, "path" | "fields">): string {
  const explicit = str(rec.fields?.title);
  if (explicit) return explicit;
  const base = basenameOf(rec.path);
  return base.replace(/^\d{1,3}[\s._-]+/, "").trim() || base;
}

function cleanPathSegment(raw: string, maxLen = 64): string {
  return raw
    .replace(/[\\/:*?"<>|#[\]\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
    .replace(/[. ]+$/, "")
    .trim();
}

function readBookFields(fields?: Record<string, unknown>): BookFields {
  const f = fields ?? {};
  return {
    author: str(f.author),
    translator: str(f.translator),
    language: str(f.language),
    kind: str(f.kind),
    status: str(f.status) || "want to read",
    rating: num(f.rating),
    finished: str(f.finished),
    source: str(f.source),
    rights: str(f.rights),
    at: str(f.at),
    cover: str(f.cover),
  };
}

/** Extract a vault storage image path from fields.cover or the first markdown image in the book's body. */
function extractCoverPath(body?: string, fields?: Record<string, unknown>): string {
  const fieldCover = str(fields?.cover);
  if (fieldCover) {
    if (fieldCover.startsWith("/api/storage/")) return fieldCover;
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[^/\s]+$/.test(fieldCover)) return `/api/storage/${fieldCover}`;
  }
  if (!body) return "";
  const m = /!\[[^\]]*\]\((\/api\/storage\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/.exec(body);
  return m ? m[1] : "";
}

/** Format reading position (`book.fields.at`) as `<chapterPath>#p<block>`. */
function formatReadingAt(chapterPath: string, block = 1): string {
  const clean = stripMd(chapterPath);
  if (!clean) return "";
  const b = Number.isFinite(block) && block >= 1 ? Math.floor(block) : 1;
  return `${clean}#p${b}`;
}

/** Parse reading position (`book.fields.at`) accepting `<path>#p<n>`, `<path>#<n>`, or `<path>`. */
function parseReadingAt(raw: unknown): { chapterRef: string; block: number } | null {
  const s = str(raw);
  if (!s) return null;
  const hash = s.lastIndexOf("#");
  if (hash < 0) return { chapterRef: normalizeRef(s), block: 1 };
  const ref = normalizeRef(s.slice(0, hash));
  if (!ref) return null;
  const tail = s.slice(hash + 1).trim();
  const m = /^p?(\d+)$/i.exec(tail);
  const block = m ? Math.max(1, Number(m[1])) : 1;
  return { chapterRef: ref, block };
}

/** Format a quote record body: quoted passage as leading markdown blockquote, followed by an optional note. */
function formatQuoteBody(quoteText: string, note = ""): string {
  const cleanQuote = quoteText.replace(/\r\n/g, "\n").trim();
  const quoted = cleanQuote
    .split("\n")
    .map((line) => (line.length ? `> ${line}` : ">"))
    .join("\n");
  const cleanNote = note.replace(/\r\n/g, "\n").trim();
  return cleanNote ? `${quoted}\n\n${cleanNote}\n` : `${quoted}\n`;
}

/** Parse a quote record body back into `{ text, note }` (round-trips `formatQuoteBody`). */
function parseQuoteBody(body?: string): { text: string; note: string } {
  const raw = (body ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return { text: "", note: "" };
  const lines = raw.split("\n");
  if (!lines[0].startsWith(">")) {
    return { text: raw, note: "" };
  }
  const quoteLines: string[] = [];
  let i = 0;
  while (i < lines.length && lines[i].startsWith(">")) {
    quoteLines.push(lines[i].replace(/^> ?/, ""));
    i++;
  }
  while (i < lines.length && lines[i].trim() === "") i++;
  const note = lines.slice(i).join("\n").trim();
  return { text: quoteLines.join("\n").trim(), note };
}

/** Build a vault-safe path under `Quotes/<BookTitle>/...` for a newly marked quote. */
function makeQuotePath(bookTitle: string, quoteText: string, stamp: string): string {
  const folder = cleanPathSegment(bookTitle, 48) || "Book";
  const words = quoteText.replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ");
  const slug = cleanPathSegment(words, 42) || "Quote";
  const timePart = cleanPathSegment(stamp.replace(/\//g, "-"), 24) || "quote";
  return `${QUOTES_FOLDER}${folder}/${timePart} ${slug}`;
}

/** First non-heading preview line from markdown (for chapter summary previews in Book contents). */
function markdownPreview(body?: string, maxLen = 140): string {
  if (!body) return "";
  for (const rawLine of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("![") || line === "---") continue;
    const plain = line
      .replace(/^[-*+]\s+/, "")
      .replace(/^>\s*/, "")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) continue;
    return plain.length > maxLen ? `${plain.slice(0, maxLen - 1).trimEnd()}…` : plain;
  }
  return "";
}

// ── Quote locator engine (pure, DOM-independent) ──

type FlatDocument = {
  raw: string;
  spans: { block: number; start: number; end: number }[];
};

function flattenBlocks(blocks: readonly string[]): FlatDocument {
  let raw = "";
  const spans: { block: number; start: number; end: number }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) raw += "\n\n";
    const start = raw.length;
    raw += blocks[i];
    spans.push({ block: i + 1, start, end: raw.length });
  }
  return { raw, spans };
}

function blockOffsetToFlat(doc: FlatDocument, block: number, offset: number): number {
  const idx = Math.max(0, Math.min(doc.spans.length - 1, block - 1));
  const sp = doc.spans[idx];
  if (!sp) return 0;
  return sp.start + Math.max(0, Math.min(sp.end - sp.start, offset));
}

function flatOffsetToBlock(doc: FlatDocument, flatOffset: number, isEnd: boolean): { block: number; offset: number } {
  if (!doc.spans.length) return { block: 1, offset: 0 };
  const clamped = Math.max(0, Math.min(doc.raw.length, flatOffset));
  for (let i = 0; i < doc.spans.length; i++) {
    const sp = doc.spans[i];
    if (isEnd) {
      if (clamped >= sp.start && clamped <= sp.end) return { block: sp.block, offset: clamped - sp.start };
      if (clamped < sp.start && i > 0) {
        const prev = doc.spans[i - 1];
        return { block: prev.block, offset: prev.end - prev.start };
      }
    } else {
      if (clamped >= sp.start && clamped <= sp.end) {
        // A start landing right at the end of a block while another follows stays there unless pushed past separator
        return { block: sp.block, offset: clamped - sp.start };
      }
      if (clamped < sp.start) return { block: sp.block, offset: 0 };
    }
  }
  const last = doc.spans[doc.spans.length - 1];
  return { block: last.block, offset: last.end - last.start };
}

/** Collapse whitespace to single spaces while preserving exact character index mapping back to `raw`. */
function normalizeWithMap(raw: string, foldPunct = false): { norm: string; toRaw: number[] } {
  let norm = "";
  const toRaw: number[] = [];
  let inSpace = false;
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (/\s/.test(ch)) {
      if (!inSpace && norm.length > 0) {
        norm += " ";
        toRaw.push(i);
        inSpace = true;
      }
      continue;
    }
    inSpace = false;
    if (foldPunct) {
      if (ch === "\u2018" || ch === "\u2019" || ch === "\u2032") ch = "'";
      else if (ch === "\u201C" || ch === "\u201D" || ch === "\u2033") ch = '"';
      else if (ch === "\u2013" || ch === "\u2014") ch = "-";
      ch = ch.toLowerCase();
    }
    norm += ch;
    toRaw.push(i);
  }
  while (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    toRaw.pop();
  }
  return { norm, toRaw };
}

function normalizePhrase(s: string, foldPunct = false): string {
  return normalizeWithMap(s, foldPunct).norm;
}

/** Create a locator (`quote`, `block`, `before`, `after`) from a block-range selection. */
function createQuoteLocator(blocks: readonly string[], sel: BlockSelection): QuoteLocator | null {
  if (!blocks.length) return null;
  const doc = flattenBlocks(blocks);
  let a = blockOffsetToFlat(doc, sel.startBlock, sel.startOffset);
  let b = blockOffsetToFlat(doc, sel.endBlock, sel.endOffset);
  if (b < a) { const t = a; a = b; b = t; }
  while (a < b && /\s/.test(doc.raw[a])) a++;
  while (b > a && /\s/.test(doc.raw[b - 1])) b--;
  if (a >= b) return null;

  const quote = doc.raw.slice(a, b);
  const startPos = flatOffsetToBlock(doc, a, false);
  const rawBefore = doc.raw.slice(Math.max(0, a - CONTEXT_LEN * 2), a);
  const rawAfter = doc.raw.slice(b, Math.min(doc.raw.length, b + CONTEXT_LEN * 2));
  const normBefore = normalizePhrase(rawBefore);
  const normAfter = normalizePhrase(rawAfter);
  const before = normBefore.length > CONTEXT_LEN ? normBefore.slice(-CONTEXT_LEN).trimStart() : normBefore;
  const after = normAfter.length > CONTEXT_LEN ? normAfter.slice(0, CONTEXT_LEN).trimEnd() : normAfter;

  return { quote, block: startPos.block, before, after };
}

/** Match similarity of the right end of `hay` against `needle` (for `before` context). */
function suffixMatchScore(hay: string, needle: string): number {
  if (!needle) return 0;
  const n = Math.min(hay.length, needle.length);
  if (n === 0) return 0;
  let exact = 0;
  while (exact < n && hay[hay.length - 1 - exact] === needle[needle.length - 1 - exact]) exact++;
  if (exact === needle.length) return 1;
  // Also credit matching trailing words if a punctuation/word drifted slightly
  const hWords = hay.slice(-needle.length - 12).split(" ").filter(Boolean);
  const nWords = needle.split(" ").filter(Boolean);
  let wordHits = 0;
  for (let i = 1; i <= Math.min(hWords.length, nWords.length); i++) {
    if (hWords[hWords.length - i] === nWords[nWords.length - i]) wordHits++;
    else break;
  }
  return Math.max(exact / needle.length, nWords.length ? (wordHits / nWords.length) * 0.9 : 0);
}

/** Match similarity of the left end of `hay` against `needle` (for `after` context). */
function prefixMatchScore(hay: string, needle: string): number {
  if (!needle) return 0;
  const n = Math.min(hay.length, needle.length);
  if (n === 0) return 0;
  let exact = 0;
  while (exact < n && hay[exact] === needle[exact]) exact++;
  if (exact === needle.length) return 1;
  const hWords = hay.slice(0, needle.length + 12).split(" ").filter(Boolean);
  const nWords = needle.split(" ").filter(Boolean);
  let wordHits = 0;
  for (let i = 0; i < Math.min(hWords.length, nWords.length); i++) {
    if (hWords[i] === nWords[i]) wordHits++;
    else break;
  }
  return Math.max(exact / needle.length, nWords.length ? (wordHits / nWords.length) * 0.9 : 0);
}

/** Locate a quote back in a chapter's blocks using exact/folded text, `before`/`after` context, and `block` proximity. */
function locateQuote(
  blocks: readonly string[],
  locator: { quote: string; block?: number | null; before?: string; after?: string },
): LocatedQuote | null {
  if (!blocks.length || !locator.quote.trim()) return null;
  const doc = flattenBlocks(blocks);

  const searchPass = (foldPunct: boolean): LocatedQuote | null => {
    const { norm, toRaw } = normalizeWithMap(doc.raw, foldPunct);
    const needle = normalizePhrase(locator.quote, foldPunct);
    if (!needle) return null;

    const hits: number[] = [];
    let pos = 0;
    while (pos <= norm.length - needle.length) {
      const idx = norm.indexOf(needle, pos);
      if (idx < 0) break;
      hits.push(idx);
      pos = idx + 1;
    }
    if (!hits.length) return null;

    const wantBefore = normalizePhrase(locator.before ?? "", foldPunct);
    const wantAfter = normalizePhrase(locator.after ?? "", foldPunct);
    const wantBlock = typeof locator.block === "number" && Number.isFinite(locator.block) && locator.block >= 1 ? Math.floor(locator.block) : null;

    let best: LocatedQuote | null = null;
    for (const hit of hits) {
      const rawStart = toRaw[hit];
      const rawEndIdx = hit + needle.length - 1;
      const rawEnd = (toRaw[rawEndIdx] ?? rawStart) + 1;
      const startPos = flatOffsetToBlock(doc, rawStart, false);
      const endPos = flatOffsetToBlock(doc, rawEnd, true);

      const beforeSlice = norm.slice(Math.max(0, hit - Math.max(CONTEXT_LEN, wantBefore.length + 12)), hit).trimEnd();
      const afterSlice = norm.slice(hit + needle.length, hit + needle.length + Math.max(CONTEXT_LEN, wantAfter.length + 12)).trimStart();

      const bScore = wantBefore ? suffixMatchScore(beforeSlice, wantBefore) : 0;
      const aScore = wantAfter ? prefixMatchScore(afterSlice, wantAfter) : 0;
      const blkScore = wantBlock !== null ? 1 / (1 + Math.abs(startPos.block - wantBlock)) : 0;

      // Weight available signals: context dominates when present; block breaks ties and rescues shifted/missing context
      let weightSum = 0;
      let weighted = 0;
      if (wantBefore) { weighted += bScore * 0.42; weightSum += 0.42; }
      if (wantAfter) { weighted += aScore * 0.42; weightSum += 0.42; }
      if (wantBlock !== null) { weighted += blkScore * 0.16; weightSum += 0.16; }
      const score = weightSum > 0 ? weighted / weightSum : 0.5;

      if (!best || score > best.score + 1e-6) {
        best = {
          startBlock: startPos.block,
          startOffset: startPos.offset,
          endBlock: endPos.block,
          endOffset: endPos.offset,
          flatStart: rawStart,
          flatEnd: rawEnd,
          score,
        };
      }
    }
    return best;
  };

  return searchPass(false) ?? searchPass(true);
}

/** Merge located quotes into sorted, non-overlapping highlight slices per 1-based block index. */
function buildHighlightRanges(
  blocks: readonly string[],
  quotes: readonly { id: string; text: string; block: number | null; before: string; after: string }[],
): { byBlock: Map<number, HighlightSlice[]>; locatedIds: Map<string, LocatedQuote> } {
  const locatedIds = new Map<string, LocatedQuote>();
  const rawPerBlock = new Map<number, { start: number; end: number; id: string }[]>();

  for (const q of quotes) {
    const loc = locateQuote(blocks, { quote: q.text, block: q.block, before: q.before, after: q.after });
    if (!loc) continue;
    locatedIds.set(q.id, loc);
    for (let b = loc.startBlock; b <= loc.endBlock; b++) {
      const text = blocks[b - 1] ?? "";
      const s = b === loc.startBlock ? loc.startOffset : 0;
      const e = b === loc.endBlock ? loc.endOffset : text.length;
      if (e <= s) continue;
      const list = rawPerBlock.get(b) ?? [];
      list.push({ start: s, end: e, id: q.id });
      rawPerBlock.set(b, list);
    }
  }

  // Sweep-line per block so overlapping quotes become clean adjacent slices carrying all covering quote IDs
  const byBlock = new Map<number, HighlightSlice[]>();
  for (const [b, segs] of rawPerBlock) {
    const pts = [...new Set(segs.flatMap((s) => [s.start, s.end]))].sort((x, y) => x - y);
    const out: HighlightSlice[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const start = pts[i], end = pts[i + 1];
      if (end <= start) continue;
      const ids = segs.filter((s) => s.start <= start && s.end >= end).map((s) => s.id);
      if (!ids.length) continue;
      const prev = out[out.length - 1];
      if (prev && prev.end === start && prev.quoteIds.length === ids.length && prev.quoteIds.every((x, j) => x === ids[j])) {
        prev.end = end;
      } else {
        out.push({ start, end, quoteIds: ids });
      }
    }
    if (out.length) byBlock.set(b, out);
  }
  return { byBlock, locatedIds };
}

function parseQuoteRecord(rec: LibraryRecord): ParsedQuote {
  const { text, note } = parseQuoteBody(rec.body);
  const f = rec.fields ?? {};
  return {
    record: rec,
    text,
    note,
    bookRef: normalizeRef(f.book),
    chapterRef: normalizeRef(f.from),
    block: num(f.block),
    before: str(f.before),
    after: str(f.after),
    by: str(f.by),
  };
}

function compareChapters(a: LibraryRecord, b: LibraryRecord): number {
  const oa = num(a.fields?.order);
  const ob = num(b.fields?.order);
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  if (oa !== null && ob === null) return -1;
  if (oa === null && ob !== null) return 1;
  return stripMd(a.path).localeCompare(stripMd(b.path), undefined, { numeric: true, sensitivity: "base" });
}

/** Classify books, chapters (grouped by parts in reading order), summaries, and quotes across Books/ and Quotes/. */
function organizeLibrary(records: readonly LibraryRecord[]): OrganizedLibrary {
  const bookRecs: LibraryRecord[] = [];
  const chapterRecs: LibraryRecord[] = [];
  const summaryRecs: LibraryRecord[] = [];
  const quoteRecs: LibraryRecord[] = [];

  for (const r of records) {
    const clean = stripMd(r.path);
    const isUnderBooks = clean.startsWith(BOOKS_FOLDER);
    const isUnderQuotes = clean.startsWith(QUOTES_FOLDER);
    const depth = isUnderBooks ? clean.slice(BOOKS_FOLDER.length).split("/").filter(Boolean).length : 0;

    if (hasRecordKind(r, "quote") || isUnderQuotes || (str(r.fields?.from) && !hasRecordKind(r, "summary") && !hasRecordKind(r, "chapter"))) {
      quoteRecs.push(r);
    } else if (hasRecordKind(r, "summary") || (isUnderBooks && (clean.includes("/Summaries/") || Boolean(str(r.fields?.of))))) {
      summaryRecs.push(r);
    } else if (hasRecordKind(r, "book") || (isUnderBooks && depth === 1)) {
      bookRecs.push(r);
    } else if (hasRecordKind(r, "chapter") || (isUnderBooks && depth >= 2)) {
      chapterRecs.push(r);
    }
  }

  const bookByKey = new Map<string, BookBundle>();
  const bundles: BookBundle[] = [];
  for (const b of bookRecs) {
    const bundle: BookBundle = {
      book: b,
      title: bookTitleOf(b.path),
      fields: readBookFields(b.fields),
      coverSrc: extractCoverPath(b.body, b.fields),
      chapters: [],
      groups: [],
      bookSummaries: [],
      summariesByChapter: new Map(),
      quotes: [],
    };
    bundles.push(bundle);
    bookByKey.set(b.id, bundle);
    bookByKey.set(stripMd(b.path), bundle);
    bookByKey.set(stripMd(b.path).toLowerCase(), bundle);
  }

  const findBookForPath = (path: string, explicitRef: string): BookBundle | undefined => {
    if (explicitRef) {
      const hit = bookByKey.get(explicitRef) ?? bookByKey.get(explicitRef.toLowerCase());
      if (hit) return hit;
    }
    const clean = stripMd(path);
    if (clean.startsWith(BOOKS_FOLDER)) {
      const root = `${BOOKS_FOLDER}${clean.slice(BOOKS_FOLDER.length).split("/")[0]}`;
      return bookByKey.get(root) ?? bookByKey.get(root.toLowerCase());
    }
    return undefined;
  };

  const chapterByKey = new Map<string, { chapter: LibraryRecord; book: BookBundle }>();
  for (const ch of chapterRecs) {
    const bundle = findBookForPath(ch.path, normalizeRef(ch.fields?.book));
    if (!bundle) continue;
    bundle.chapters.push(ch);
    chapterByKey.set(ch.id, { chapter: ch, book: bundle });
    chapterByKey.set(stripMd(ch.path), { chapter: ch, book: bundle });
    chapterByKey.set(stripMd(ch.path).toLowerCase(), { chapter: ch, book: bundle });
  }

  // Group chapters by parts in each book while keeping reading order
  for (const bundle of bundles) {
    bundle.chapters.sort(compareChapters);
    const partRefSet = new Set<string>();
    for (const ch of bundle.chapters) {
      const pref = normalizeRef(ch.fields?.part);
      if (pref) partRefSet.add(pref.toLowerCase());
    }
    const isPartRec = (ch: LibraryRecord) =>
      partRefSet.has(ch.id.toLowerCase()) || partRefSet.has(stripMd(ch.path).toLowerCase());

    const byPart = new Map<string, ChapterGroup>();
    const orderedGroups: ChapterGroup[] = [];
    const ensureGroup = (key: string, part: LibraryRecord | null, title: string): ChapterGroup => {
      let g = byPart.get(key);
      if (!g) {
        g = { part, title, chapters: [] };
        byPart.set(key, g);
        orderedGroups.push(g);
      }
      return g;
    };

    for (const ch of bundle.chapters) {
      if (isPartRec(ch)) {
        const key = stripMd(ch.path).toLowerCase();
        const g = ensureGroup(key, ch, chapterDisplayTitle(ch));
        if (!g.part) g.part = ch;
        continue;
      }
      const pref = normalizeRef(ch.fields?.part);
      if (pref) {
        const partHit = chapterByKey.get(pref) ?? chapterByKey.get(pref.toLowerCase());
        const key = partHit ? stripMd(partHit.chapter.path).toLowerCase() : pref.toLowerCase();
        const title = partHit ? chapterDisplayTitle(partHit.chapter) : chapterDisplayTitle({ path: pref });
        const g = ensureGroup(key, partHit?.chapter ?? null, title);
        g.chapters.push(ch);
      } else {
        const g = ensureGroup("__front__", null, "");
        g.chapters.push(ch);
      }
    }
    bundle.groups = orderedGroups;
  }

  const summaryByKey = new Map<string, { summary: LibraryRecord; book: BookBundle; chapter: LibraryRecord | null }>();
  for (const sum of summaryRecs) {
    const ofRef = normalizeRef(sum.fields?.of);
    const chHit = ofRef ? (chapterByKey.get(ofRef) ?? chapterByKey.get(ofRef.toLowerCase())) : undefined;
    const bookHit = chHit?.book ?? findBookForPath(sum.path, ofRef);
    if (!bookHit) continue;
    if (chHit) {
      const list = bookHit.summariesByChapter.get(chHit.chapter.id) ?? [];
      list.push(sum);
      bookHit.summariesByChapter.set(chHit.chapter.id, list);
      summaryByKey.set(sum.id, { summary: sum, book: bookHit, chapter: chHit.chapter });
      summaryByKey.set(stripMd(sum.path), { summary: sum, book: bookHit, chapter: chHit.chapter });
    } else {
      bookHit.bookSummaries.push(sum);
      summaryByKey.set(sum.id, { summary: sum, book: bookHit, chapter: null });
      summaryByKey.set(stripMd(sum.path), { summary: sum, book: bookHit, chapter: null });
    }
  }

  const parsedQuotes = quoteRecs
    .map(parseQuoteRecord)
    .sort((a, b) => (b.record.createdAt ?? b.record.updatedAt ?? "").localeCompare(a.record.createdAt ?? a.record.updatedAt ?? ""));

  const quoteByKey = new Map<string, ParsedQuote>();
  for (const q of parsedQuotes) {
    quoteByKey.set(q.record.id, q);
    quoteByKey.set(stripMd(q.record.path), q);
    const chHit = q.chapterRef ? (chapterByKey.get(q.chapterRef) ?? chapterByKey.get(q.chapterRef.toLowerCase())) : undefined;
    const bookHit = chHit?.book ?? (q.bookRef ? (bookByKey.get(q.bookRef) ?? bookByKey.get(q.bookRef.toLowerCase())) : undefined);
    if (bookHit) bookHit.quotes.push(q);
  }

  // Sort books: reading first (by most recently updated), then want to read, then read, then alphabetically
  const statusRank = (s: string, at: string) => {
    if (s === "reading" || (at && s !== "read")) return 0;
    if (s === "want to read" || !s) return 1;
    return 2;
  };
  bundles.sort((a, b) => {
    const ra = statusRank(a.fields.status, a.fields.at);
    const rb = statusRank(b.fields.status, b.fields.at);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (b.book.updatedAt ?? "").localeCompare(a.book.updatedAt ?? "") || a.title.localeCompare(b.title);
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });

  return { books: bundles, bookByKey, chapterByKey, summaryByKey, quoteByKey, quotes: parsedQuotes };
}

/** Paginated folder reader (up to the app's 5,000 offset cap, falling back gracefully on 0.8 hubs). */
async function readFolder(
  query: (q: Record<string, unknown>) => Promise<LibraryRecord[]>,
  base: Record<string, unknown>,
): Promise<{ rows: LibraryRecord[]; capped: boolean }> {
  const PAGE = 50;
  const MAX_OFFSET = 5000;
  const byId = new Map<string, LibraryRecord>();
  let capped = false;

  const pull = async (extra: Record<string, unknown>) => {
    let offset = 0;
    while (offset <= MAX_OFFSET) {
      const page = await query({ ...base, ...extra, limit: PAGE, offset });
      for (const r of page) {
        const prev = byId.get(r.id);
        if (!prev || (r.updatedAt ?? "") >= (prev.updatedAt ?? "")) byId.set(r.id, r);
      }
      if (page.length < PAGE) return;
      if (offset === MAX_OFFSET) { capped = true; return; }
      offset += PAGE;
    }
  };

  try {
    await pull({ orderBy: "created_at", sort: "asc" });
  } catch (e) {
    if ((e as { status?: number })?.status !== 400) throw e;
    byId.clear();
    capped = false;
    await pull({});
  }
  return { rows: [...byId.values()], capped };
}

// ── end pure helpers ──

// ── DOM block collection, selection capture, and mark rendering ──

type DomBlock = {
  el: HTMLElement;
  block: number;
  text: string;
  nodes: { node: Text; start: number; end: number }[];
};

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, dd, dt, td, th, figcaption";

function isFootnoteMarker(node: Node): boolean {
  let cur: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    const el = cur as HTMLElement;
    if (el.tagName === "SUP") {
      if (el.classList.contains("footnote-ref") || el.querySelector('a[href^="#user-content-fn"], a[href^="#fn"]')) return true;
    }
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return true;
    cur = el.parentNode;
  }
  return false;
}

function clearMarks(root: HTMLElement) {
  const marks = Array.from(root.querySelectorAll("mark.lib-mark"));
  const parents = new Set<Node>();
  for (const m of marks) {
    const p = m.parentNode;
    if (!p) continue;
    parents.add(p);
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
  }
  for (const p of parents) p.normalize();
}

function collectReadableBlocks(root: HTMLElement): DomBlock[] {
  const noteEl = root.querySelector<HTMLElement>(".pa-note") ?? root;
  const candidates = Array.from(noteEl.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    .filter((el) => !el.closest("section.footnotes, [data-footnotes]"));

  // each block holds its own words: a list item with a list inside keeps "Rule one", its sub-items are blocks of their own
  const blocks: DomBlock[] = [];
  for (const el of candidates) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number; end: number }[] = [];
    let text = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      if (!t.nodeValue || isFootnoteMarker(t)) continue;
      if (t.parentElement?.closest(BLOCK_SELECTOR) !== el) continue;
      const start = text.length;
      text += t.nodeValue;
      nodes.push({ node: t, start, end: text.length });
    }
    if (!text.trim()) continue;
    const blockNum = blocks.length + 1;
    el.dataset.libBlock = String(blockNum);
    blocks.push({ el, block: blockNum, text, nodes });
  }
  return blocks;
}

function locatorFromSelection(root: HTMLElement, sel: Selection | null): QuoteLocator | null {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const blocks = collectReadableBlocks(root);
  if (!blocks.length) return null;

  let startBlock = 0, startOffset = 0, endBlock = 0, endOffset = 0;
  let foundStart = false;

  for (const blk of blocks) {
    for (const seg of blk.nodes) {
      const len = seg.node.nodeValue?.length ?? 0;
      if (!len) continue;
      let cmpStart = 0;
      let cmpEnd = 0;
      try {
        cmpStart = range.comparePoint(seg.node, 0);
        cmpEnd = range.comparePoint(seg.node, len);
      } catch {
        continue;
      }
      // Entire node before range (both -1) or after range (both 1)
      if (cmpEnd < 0 || cmpStart > 0) continue;

      const localStart = seg.node === range.startContainer ? Math.max(0, Math.min(len, range.startOffset)) : (cmpStart < 0 ? 0 : 0);
      const localEnd = seg.node === range.endContainer ? Math.max(0, Math.min(len, range.endOffset)) : (cmpEnd > 0 ? len : len);
      if (localEnd <= localStart) continue;

      if (!foundStart) {
        startBlock = blk.block;
        startOffset = seg.start + localStart;
        foundStart = true;
      }
      endBlock = blk.block;
      endOffset = seg.start + localEnd;
    }
  }
  if (!foundStart) return null;
  return createQuoteLocator(blocks.map((b) => b.text), { startBlock, startOffset, endBlock, endOffset });
}

function applyMarks(
  root: HTMLElement,
  quotes: readonly ParsedQuote[],
  focusQuoteId: string | null,
): { focusedMark: HTMLElement | null; blocksCount: number } {
  clearMarks(root);
  const blocks = collectReadableBlocks(root);
  if (!blocks.length) return { focusedMark: null, blocksCount: 0 };

  const { byBlock } = buildHighlightRanges(
    blocks.map((b) => b.text),
    quotes.map((q) => ({ id: q.record.id, text: q.text, block: q.block, before: q.before, after: q.after })),
  );

  let focusedMark: HTMLElement | null = null;
  for (const blk of blocks) {
    const slices = byBlock.get(blk.block);
    if (!slices?.length) continue;
    for (const seg of blk.nodes) {
      const overlapping = slices
        .map((s) => ({ start: Math.max(seg.start, s.start) - seg.start, end: Math.min(seg.end, s.end) - seg.start, ids: s.quoteIds }))
        .filter((s) => s.end > s.start)
        .sort((a, b) => b.start - a.start); // reverse order preserves earlier text-node offsets
      if (!overlapping.length) continue;

      const targetNode = seg.node;
      for (const slice of overlapping) {
        if (slice.end < (targetNode.nodeValue?.length ?? 0)) targetNode.splitText(slice.end);
        const markedText = slice.start > 0 ? targetNode.splitText(slice.start) : targetNode;
        const mark = document.createElement("mark");
        const isFocus = focusQuoteId !== null && slice.ids.includes(focusQuoteId);
        mark.className = isFocus ? "lib-mark lib-mark-focus" : "lib-mark";
        mark.dataset.quoteId = isFocus ? focusQuoteId : slice.ids[0];
        mark.dataset.quoteIds = slice.ids.join(",");
        mark.tabIndex = 0;
        mark.setAttribute("role", "button");
        mark.setAttribute("aria-label", "View marked quote");
        markedText.parentNode?.insertBefore(mark, markedText);
        mark.appendChild(markedText);
        if (isFocus && !focusedMark) focusedMark = mark;
      }
    }
  }
  return { focusedMark, blocksCount: blocks.length };
}

// ── UI subcomponents ──

function BookCover({ title, author, url, size = "shelf", want }: {
  title: string; author: string; url?: string; size?: "shelf" | "hero"; want?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wantRef = useRef(want);
  wantRef.current = want;
  const wants = !!want;
  useEffect(() => {
    if (url || !wants || !ref.current) return;
    const ask = () => wantRef.current?.();
    if (typeof IntersectionObserver !== "function") { ask(); return; }
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); ask(); }
    }, { rootMargin: "200px" });
    seen.observe(ref.current);
    return () => seen.disconnect();
  }, [url, wants]);

  const w = size === "hero" ? 136 : 180;
  const h = size === "hero" ? 204 : 270;
  if (url) {
    return (
      <div className={size === "hero" ? "lib-cover lib-cover-hero" : "lib-cover"}>
        <img src={url} alt={`${title} cover`} width={w} height={h} className="lib-cover-img" />
      </div>
    );
  }
  return (
    <div ref={ref} className={size === "hero" ? "lib-cover lib-cover-hero lib-cover-text" : "lib-cover lib-cover-text"} aria-hidden="true">
      <span className="lib-cover-ornament">❧</span>
      <span className="lib-cover-title">{title}</span>
      {author && <span className="lib-cover-author">{author}</span>}
    </div>
  );
}

/** Memoized chapter prose container: keeps <Note> and its DOM <mark>s untouched while typing in drawers. */
const ChapterProse = memo(function ChapterProse({
  chapter,
  quotes,
  focusQuoteId,
  targetBlock,
  onLink,
  onOpenQuote,
  onSelection,
  onActiveBlock,
}: {
  chapter: LibraryRecord;
  quotes: readonly ParsedQuote[];
  focusQuoteId: string | null;
  targetBlock: number | null;
  onLink: (target: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onSelection: (loc: QuoteLocator | null) => void;
  onActiveBlock: (block: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelRef = useRef(onSelection);
  onSelRef.current = onSelection;
  const onBlockRef = useRef(onActiveBlock);
  onBlockRef.current = onActiveBlock;
  const scrolledKey = useRef("");

  const quotesSig = useMemo(
    () => quotes.map((q) => `${q.record.id}:${q.text}:${q.block ?? ""}:${q.before}:${q.after}`).join("\n"),
    [quotes],
  );

  // Mark quotes in the rendered <Note> DOM and scroll to focused quote or saved paragraph
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    let raf = 0;
    const run = () => {
      if (!containerRef.current) return;
      const { focusedMark } = applyMarks(containerRef.current, quotes, focusQuoteId);
      const key = `${chapter.id}|${focusQuoteId ?? ""}|${targetBlock ?? ""}`;
      if (scrolledKey.current !== key) {
        if (focusedMark) {
          scrolledKey.current = key;
          focusedMark.scrollIntoView({ behavior: isStill() ? "auto" : "smooth", block: "center" });
        } else if (targetBlock && targetBlock > 1) {
          const blkEl = containerRef.current.querySelector<HTMLElement>(`[data-lib-block="${targetBlock}"]`);
          if (blkEl) {
            scrolledKey.current = key;
            blkEl.scrollIntoView({ behavior: isStill() ? "auto" : "smooth", block: "start" });
          }
        } else {
          scrolledKey.current = key;
        }
      }
    };
    raf = requestAnimationFrame(run);
    return () => {
      cancelAnimationFrame(raf);
      if (containerRef.current) clearMarks(containerRef.current);
    };
  }, [chapter.id, chapter.body, quotesSig, focusQuoteId, targetBlock]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track user text selection cleanly via rAF so selection feels instant
  useEffect(() => {
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const root = containerRef.current;
        if (!root) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          onSelRef.current(null);
          return;
        }
        if (!root.contains(sel.anchorNode) && !root.contains(sel.focusNode)) return;
        onSelRef.current(locatorFromSelection(root, sel));
      });
    };
    document.addEventListener("selectionchange", check);
    document.addEventListener("mouseup", check);
    document.addEventListener("touchend", check);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", check);
      document.removeEventListener("mouseup", check);
      document.removeEventListener("touchend", check);
    };
  }, []);

  // Track which paragraph is near the top of the viewport as the reader scrolls (zero React renders)
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const root = containerRef.current;
      if (!root) return;
      const els = Array.from(root.querySelectorAll<HTMLElement>("[data-lib-block]"));
      if (!els.length) return;
      let current = 1;
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > 72) {
          current = Number(el.dataset.libBlock) || 1;
          break;
        }
        current = Number(el.dataset.libBlock) || current;
      }
      onBlockRef.current(current);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [chapter.id]);

  const handleMarkClick = (target: EventTarget | null) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
    const mark = (target as HTMLElement | null)?.closest?.("mark.lib-mark") as HTMLElement | null;
    if (mark?.dataset.quoteId) onOpenQuote(mark.dataset.quoteId);
  };

  return (
    <div
      ref={containerRef}
      className="lib-reader"
      onClick={(e) => handleMarkClick(e.target)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          const mark = (e.target as HTMLElement | null)?.closest?.("mark.lib-mark") as HTMLElement | null;
          if (mark?.dataset.quoteId) {
            e.preventDefault();
            onOpenQuote(mark.dataset.quoteId);
          }
        }
      }}
    >
      <Note
        key={`${chapter.id}|${chapter.updatedAt ?? ""}|${(chapter.body ?? "").length}`}
        id={chapter.id}
        body={chapter.body ?? ""}
        path={chapter.path}
        tags={chapter.tags}
        fields={chapter.fields}
        onLink={onLink}
      />
    </div>
  );
});

// ── Styles (strictly on the theme's tokens and scale) ──

const STYLES = `
.lib-reading-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 440px));
  gap: var(--gap);
  align-items: start;
}
.lib-reading-grid > * {
  margin-bottom: 0;
}
.lib-reading-card {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: var(--gap);
  align-items: start;
}
.lib-reading-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lib-reading-title {
  margin: 0;
  font-family: var(--serif);
  font-size: var(--fs-head);
  font-weight: var(--title-weight);
  line-height: 1.2;
}
.lib-muted {
  margin: 0;
  font-size: var(--fs-small);
  color: var(--muted);
}
.lib-shelf-section {
  margin: 0 0 calc(var(--gap) * 1.4);
}
.lib-section-label {
  margin: 0 0 10px;
  font-family: var(--serif);
  font-style: italic;
  font-size: var(--fs-body);
  color: var(--muted);
  padding-bottom: 6px;
  border-bottom: var(--line-head);
}
.lib-shelf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 152px), 1fr));
  gap: calc(var(--gap) * 1.25) var(--gap);
  align-items: start;
}
.lib-book-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  padding: 6px;
  margin: -6px;
  border-radius: var(--radius-card);
  transition: transform var(--t-press) var(--ease-out), opacity var(--t-state) var(--ease-out);
}
.lib-book-card:active {
  transform: scale(0.98);
}
.lib-book-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@media (hover: hover) and (pointer: fine) {
  .lib-book-card:hover {
    background: var(--tint);
  }
}
.lib-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: var(--radius);
  border: var(--line-card);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}
.lib-cover-hero {
  width: 112px;
  flex: none;
}
.lib-cover-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lib-cover-text {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-sizing: border-box;
  padding: 14px 12px;
  background: var(--card-fill);
  border-left: 3px solid var(--accent);
}
.lib-cover-ornament {
  font-family: var(--serif);
  font-size: var(--fs-body);
  color: var(--accent);
}
.lib-cover-title {
  font-family: var(--serif);
  font-size: var(--fs-lead);
  font-weight: var(--title-weight);
  line-height: 1.2;
  color: var(--text);
  overflow-wrap: anywhere;
}
.lib-cover-author {
  font-family: var(--sans);
  font-size: var(--fs-label);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.lib-book-card-title {
  font-family: var(--serif);
  font-size: var(--fs-body);
  font-weight: 600;
  line-height: 1.25;
  color: var(--text);
  overflow-wrap: anywhere;
}
.lib-book-card-author {
  font-size: var(--fs-small);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.lib-book-card-status {
  font-size: var(--fs-label);
  color: var(--label-ink);
  font-variant-numeric: tabular-nums;
}
.lib-book-hero {
  display: flex;
  gap: var(--gap);
  align-items: start;
  margin: 0 0 calc(var(--gap) * 1.2);
}
.lib-book-hero-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lib-book-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: var(--fs-small);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.lib-reader .pa-note {
  font-family: var(--serif);
  font-size: var(--fs-lead);
  line-height: 1.72;
}
.lib-reader .pa-note p {
  margin: 0 0 1.05em;
}
.lib-reader .pa-note img {
  display: block;
  margin: var(--gap) auto;
  border-radius: var(--radius);
}
.lib-mark {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: inherit;
  border-bottom: 1.5px solid color-mix(in srgb, var(--accent) 55%, transparent);
  border-radius: 2px;
  padding: 0 1px;
  cursor: pointer;
}
.lib-mark:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.lib-mark.lib-mark-focus {
  background: color-mix(in srgb, var(--primary) 26%, transparent);
  border-bottom: 2px solid var(--primary);
}
.lib-sel-bar {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 14px);
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(calc(100vw - 24px), 540px);
  padding: 8px 12px 8px 16px;
  background: var(--surface);
  border: var(--line-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}
.lib-sel-preview {
  min-width: 0;
  flex: 1;
  font-family: var(--serif);
  font-style: italic;
  font-size: var(--fs-small);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lib-quote-preview {
  margin: 0 0 var(--gap);
  padding: 8px 14px;
  border-left: var(--line-quote);
  font-family: var(--serif);
  font-size: var(--fs-lead);
  line-height: 1.55;
  color: var(--text);
  background: var(--tint);
  border-radius: 0 var(--radius) var(--radius) 0;
}
.lib-quote-note {
  margin: 0 0 var(--gap);
  font-family: var(--sans);
  font-size: var(--fs-body);
  color: var(--text);
  white-space: pre-wrap;
}
.lib-chapter-nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  margin-top: calc(var(--gap) * 2);
  padding-top: var(--gap);
  border-top: var(--line-head);
}
.lib-summary-meta {
  margin: 0 0 var(--gap);
  font-size: var(--fs-small);
  color: var(--muted);
}
.lib-summary-block {
  margin: 0 0 calc(var(--gap) * 1.4);
  padding-bottom: var(--gap);
  border-bottom: var(--line-row);
}
.lib-summary-block:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.lib-summary-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 6px;
}
.lib-summary-title {
  margin: 0;
  font-family: var(--serif);
  font-size: var(--fs-lead);
  font-weight: 600;
}
`;

// ── Main Applet ──

type HomeTab = "shelf" | "quotes";
type BookTab = "contents" | "summaries" | "quotes";
type Route =
  | { view: "home" }
  | { view: "book"; bookId: string }
  | { view: "read"; bookId: string; chapterId: string; focusQuoteId: string | null; targetBlock: number | null };

export default function Library() {
  const [records, setRecords] = useState<LibraryRecord[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [homeTab, setHomeTab] = useSaved<HomeTab>("homeTab", "shelf");
  const [bookTab, setBookTab] = useSaved<BookTab>("bookTab", "contents");
  const [route, setRoute] = useSaved<Route>("route", { view: "home" });
  const [shelfQuery, setShelfQuery] = useState("");
  const [quotesQuery, setQuotesQuery] = useState("");

  // Loaded full chapter record for Read view (with body)
  const [activeChapter, setActiveChapter] = useState<LibraryRecord | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterError, setChapterError] = useState<unknown>(null);

  // Loaded full summaries (by record id) when viewing summary drawer or Book Summaries tab
  const [summaryBodies, setSummaryBodies] = useState<Record<string, LibraryRecord>>({});
  // more records than one read reaches (5,000 a folder): said, not hidden
  const [capped, setCapped] = useState(false);
  const summaryAsked = useRef<Set<string>>(new Set());

  // Cover blob URL cache (keyed by `${bookId}|${coverSrc}`)
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const coverCache = useRef<Map<string, string>>(new Map());
  const coverInflight = useRef<Set<string>>(new Set());
  const coverFailed = useRef<Map<string, number>>(new Map());
  const coverQueue = useRef<{ key: string; id: string; path: string }[]>([]);
  const coverRunning = useRef(false);

  // Read view UI state: selection bar, mark-quote drawer, quote detail drawer, summary drawer, chapter quotes drawer
  const [pendingSel, setPendingSel] = useState<QuoteLocator | null>(null);
  const [quoteDrawerOpen, setQuoteDrawerOpen] = useState(false);
  const [draftLocator, setDraftLocator] = useState<QuoteLocator | null>(null);
  const [quoteNote, setQuoteNote] = useState("");
  const [savingQuote, setSavingQuote] = useState(false);

  const [viewedQuoteId, setViewedQuoteId] = useState<string | null>(null);
  const [editingQuoteNote, setEditingQuoteNote] = useState<string | null>(null);
  const [savingQuoteEdit, setSavingQuoteEdit] = useState(false);

  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [summaryDrawerIds, setSummaryDrawerIds] = useState<string[]>([]);
  const [summaryDrawerTitle, setSummaryDrawerTitle] = useState("Summary");
  const [chapterQuotesOpen, setChapterQuotesOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);

  // Track active reading position without re-rendering on scroll
  const stoppedBlockRef = useRef<number>(1);
  const activeReadRef = useRef<{ bookId: string; chapterPath: string } | null>(null);
  const versions = useRef<Map<string, string>>(new Map());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    for (const u of coverCache.current.values()) URL.revokeObjectURL(u);
    coverCache.current.clear();
    coverQueue.current = [];
  }, []);

  const drainCovers = useCallback(async () => {
    if (coverRunning.current) return;
    coverRunning.current = true;
    try {
      for (let next = coverQueue.current.shift(); next; next = coverQueue.current.shift()) {
        try {
          const blob = await vault.file!(next.id, next.path);
          if (!mounted.current) return;
          const url = URL.createObjectURL(blob);
          coverCache.current.set(next.key, url);
          setCoverUrls((prev) => ({ ...prev, [next.key]: url }));
        } catch {
          coverFailed.current.set(next.key, Date.now());
        } finally {
          coverInflight.current.delete(next.key);
        }
      }
    } finally {
      coverRunning.current = false;
    }
  }, []);

  const ensureCover = useCallback((bookId: string, coverSrc: string, priority = false) => {
    if (!coverSrc || typeof vault.file !== "function") return;
    const key = `${bookId}|${coverSrc}`;
    if (coverCache.current.has(key) || coverInflight.current.has(key)) return;
    const failedAt = coverFailed.current.get(key);
    if (failedAt !== undefined && Date.now() - failedAt < 60_000) return;
    coverInflight.current.add(key);
    const item = { key, id: bookId, path: coverSrc };
    if (priority) coverQueue.current.unshift(item); else coverQueue.current.push(item);
    void drainCovers();
  }, [drainCovers]);

  // Load Books/ (fields; plus book & summary bodies) and Quotes/ (with bodies so quote text & notes show at once)
  const loadingRef = useRef<Promise<void> | null>(null);
  const againRef = useRef(false);
  const load = useCallback((): Promise<void> => {
    if (loadingRef.current) { againRef.current = true; return loadingRef.current; }
    const run = async () => {
      do {
        againRef.current = false;
        try {
          const q = (params: Record<string, unknown>) => vault.queryRecords(params) as Promise<LibraryRecord[]>;
          // Books/ with fields (books, chapters, parts, summaries); the books again with their bodies (the cover is
          // in the body); Quotes/ with bodies (the quoted words and the note). Summary bodies load per book, on open.
          const [booksRes, quotesRes, bookBodies] = await Promise.all([
            readFolder(q, { pathPrefix: BOOKS_FOLDER, includeFields: true }),
            readFolder(q, { pathPrefix: QUOTES_FOLDER, includeFields: true, includeBody: true }),
            readFolder(q, { pathPrefix: BOOKS_FOLDER, tag: "book", includeFields: true, includeBody: true }),
          ]);
          const merged = new Map<string, LibraryRecord>();
          for (const r of [...booksRes.rows, ...bookBodies.rows, ...quotesRes.rows]) {
            const prev = merged.get(r.id);
            merged.set(r.id, prev ? { ...prev, ...r } : r);
          }
          // a book not typed `book` (a record at Books/<Title>): its body one at a time, for its cover
          const needsCoverBody = [...merged.values()].filter((r) => {
            const clean = stripMd(r.path);
            if (!clean.startsWith(BOOKS_FOLDER) || hasRecordKind(r, "book")) return false;
            const depth = clean.slice(BOOKS_FOLDER.length).split("/").filter(Boolean).length;
            return depth === 1 && r.body === undefined && !str(r.fields?.cover);
          });
          for (let i = 0; i < needsCoverBody.length; i += 6) {
            await Promise.all(needsCoverBody.slice(i, i + 6).map(async (b) => {
              try {
                const full = await vault.getRecord(b.id) as LibraryRecord | null;
                if (full) merged.set(full.id, { ...b, ...full });
              } catch { /* its cover shows as words */ }
            }));
          }
          setCapped(booksRes.capped || quotesRes.capped);
          summaryAsked.current.clear(); // a refresh reads the summaries again too
          if (!mounted.current) return;
          setRecords([...merged.values()]);
          setError(null);
        } catch (e) {
          if (mounted.current) setError(e);
        }
      } while (againRef.current);
      loadingRef.current = null;
    };
    loadingRef.current = run();
    return loadingRef.current;
  }, []);

  const lib = useMemo(() => organizeLibrary(records ?? []), [records]);
  const libRef = useRef(lib);
  libRef.current = lib;

  // Patch book fields cleanly with serialized versions + single conflict retry
  const patchBookFields = useCallback((bookId: string, patch: Record<string, unknown>, quiet = false): Promise<boolean> => {
    const run = async () => {
      const bundle = libRef.current.bookByKey.get(bookId);
      if (!bundle) throw new Error("this book isn't in your library any more");
      const mine = versions.current.get(bookId);
      let base = mine && (!bundle.book.updatedAt || mine > bundle.book.updatedAt) ? mine : bundle.book.updatedAt;
      if (!base) {
        const fresh = await vault.getRecord(bookId) as LibraryRecord | null;
        base = fresh?.updatedAt ?? null;
      }
      if (!base) throw new Error("this book isn't in your library any more");
      const apply = async (ifUpdatedAt: string) =>
        await vault.updateRecord(bookId, { if_updated_at: ifUpdatedAt, fields: patch }) as LibraryRecord;

      let updated: LibraryRecord;
      try {
        updated = await apply(base);
      } catch (e) {
        if ((e as { status?: number })?.status !== 409) throw e;
        const fresh = await vault.getRecord(bookId) as LibraryRecord | null;
        if (!fresh?.updatedAt) throw e;
        updated = await apply(fresh.updatedAt);
      }
      if (updated.updatedAt) versions.current.set(bookId, updated.updatedAt);
      if (mounted.current) setRecords((prev) => (prev ? prev.map((r) => (r.id === bookId ? { ...r, ...updated, fields: { ...r.fields, ...patch } } : r)) : prev));
    };
    const next = saveChain.current.then(run, run);
    saveChain.current = next.catch(() => {});
    return next.then(() => true, (e) => {
      if (!quiet) toast(`Could not save book: ${e instanceof Error ? e.message : String(e)}`, { error: true });
      return false;
    });
  }, []);

  // Write where the reader stopped to `book.fields.at` (and bump "want to read" -> "reading")
  const persistReadingPosition = useCallback((override?: { bookId: string; chapterPath: string; block: number }) => {
    const cur = override ?? (activeReadRef.current ? { ...activeReadRef.current, block: stoppedBlockRef.current } : null);
    if (!cur) return;
    const bundle = libRef.current.bookByKey.get(cur.bookId);
    if (!bundle) return;
    const nextAt = formatReadingAt(cur.chapterPath, cur.block);
    if (!nextAt) return;
    const patch: Record<string, unknown> = {};
    if (bundle.fields.at !== nextAt) patch.at = nextAt;
    if (!bundle.fields.status || bundle.fields.status === "want to read") patch.status = "reading";
    if (!Object.keys(patch).length) return;
    void patchBookFields(bundle.book.id, patch, true);
  }, [patchBookFields]);

  // Open a chapter in Read view
  const chapterLoadSeq = useRef(0);
  const openChapter = useCallback(async (
    bookId: string,
    chapterId: string,
    opts: { focusQuoteId?: string | null; targetBlock?: number | null; fresh?: boolean } = {},
  ) => {
    // leaving a chapter writes where you stopped in it; from here on you are in the new one, even while it loads
    const known = libRef.current.chapterByKey.get(chapterId)?.chapter ?? null;
    if (activeReadRef.current && activeReadRef.current.chapterPath !== known?.path) persistReadingPosition();
    activeReadRef.current = known ? { bookId, chapterPath: known.path } : null;
    const seq = ++chapterLoadSeq.current;
    const initialBlock = opts.targetBlock ?? 1;
    stoppedBlockRef.current = initialBlock;
    setPendingSel(null);
    setQuoteDrawerOpen(false);
    setViewedQuoteId(null);
    setSummaryDrawerOpen(false);
    setChapterQuotesOpen(false);
    setRoute({ view: "read", bookId, chapterId, focusQuoteId: opts.focusQuoteId ?? null, targetBlock: opts.targetBlock ?? null });

    const existing = known;
    if (existing?.body !== undefined && !opts.fresh) {
      setActiveChapter(existing);
      setChapterError(null);
      setChapterLoading(false);
      return;
    }

    setChapterLoading(true);
    setChapterError(null);
    try {
      const full = await vault.getRecord(chapterId) as LibraryRecord | null;
      if (seq !== chapterLoadSeq.current || !mounted.current) return;
      if (!full) {
        setChapterError(new Error("This chapter could not be found."));
        setActiveChapter(null);
      } else {
        activeReadRef.current = { bookId, chapterPath: full.path };
        setActiveChapter(full);
        setRecords((prev) => (prev ? prev.map((r) => (r.id === full.id ? { ...r, ...full } : r)) : prev));
      }
    } catch (e) {
      if (seq === chapterLoadSeq.current && mounted.current) setChapterError(e);
    } finally {
      if (seq === chapterLoadSeq.current && mounted.current) setChapterLoading(false);
    }
  }, [persistReadingPosition, setRoute]);

  const leaveChapter = useCallback((to: Route) => {
    persistReadingPosition();
    activeReadRef.current = null;
    setPendingSel(null);
    setQuoteDrawerOpen(false);
    setViewedQuoteId(null);
    setSummaryDrawerOpen(false);
    setChapterQuotesOpen(false);
    setRoute(to);
  }, [persistReadingPosition, setRoute]);

  // Open a record handed to the applet via `onOpen` (book, chapter, summary, or quote)
  const openExternalRecord = useCallback((note: { id: string; path: string }) => {
    const l = libRef.current;
    const bookHit = l.bookByKey.get(note.id) ?? l.bookByKey.get(stripMd(note.path));
    if (bookHit) {
      leaveChapter({ view: "book", bookId: bookHit.book.id });
      return;
    }
    const chHit = l.chapterByKey.get(note.id) ?? l.chapterByKey.get(stripMd(note.path));
    if (chHit) {
      void openChapter(chHit.book.book.id, chHit.chapter.id);
      return;
    }
    const qHit = l.quoteByKey.get(note.id) ?? l.quoteByKey.get(stripMd(note.path));
    if (qHit) {
      const qCh = l.chapterByKey.get(qHit.chapterRef) ?? l.chapterByKey.get(qHit.chapterRef.toLowerCase());
      if (qCh) {
        void openChapter(qCh.book.book.id, qCh.chapter.id, { focusQuoteId: qHit.record.id, targetBlock: qHit.block ?? 1 });
        return;
      }
    }
    const sumHit = l.summaryByKey.get(note.id) ?? l.summaryByKey.get(stripMd(note.path));
    if (sumHit) {
      leaveChapter({ view: "book", bookId: sumHit.book.book.id });
      setBookTab("summaries");
    }
  }, [leaveChapter, openChapter, setBookTab]);

  // Lifecycle: ready, onOpen, onShown (persist reading stop when hidden), pagehide
  const pendingOpenRef = useRef<{ id: string; path: string } | null>(null);
  useEffect(() => {
    ready().then((ctx) => {
      if (ctx.open?.note) pendingOpenRef.current = ctx.open.note;
      void load();
    });
    const offOpen = onOpen((o: { note: { id: string; path: string } }) => {
      if (libRef.current.books.length) openExternalRecord(o.note);
      else pendingOpenRef.current = o.note;
    });
    const offShown = typeof onShown === "function" ? onShown((isShown: boolean) => {
      if (!isShown) persistReadingPosition();
    }) : undefined;
    const onHide = () => persistReadingPosition();
    window.addEventListener("pagehide", onHide);
    return () => {
      offOpen();
      if (typeof offShown === "function") offShown();
      window.removeEventListener("pagehide", onHide);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Process any deferred `onOpen` or restore saved Read route once library records arrive
  useEffect(() => {
    if (!records) return;
    if (pendingOpenRef.current) {
      const note = pendingOpenRef.current;
      pendingOpenRef.current = null;
      openExternalRecord(note);
      return;
    }
    if (route.view === "read" && (!activeChapter || activeChapter.id !== route.chapterId) && !chapterLoading) {
      const chHit = lib.chapterByKey.get(route.chapterId);
      if (chHit) {
        void openChapter(chHit.book.book.id, chHit.chapter.id, { focusQuoteId: route.focusQuoteId, targetBlock: route.targetBlock });
      }
    }
  }, [records]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hold app Back while inside Book or Read views
  useEffect(() => {
    if (route.view === "home" || typeof onBack !== "function") return;
    return onBack(() => {
      if (route.view === "read") leaveChapter({ view: "book", bookId: route.bookId });
      else setRoute({ view: "home" });
    });
  }, [route.view, route.view === "home" ? "" : route.bookId, leaveChapter, setRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load summary bodies on demand (the summary drawer, a book's contents and Summaries): a book's in one folder read,
  // any left one at a time; each asked once, so one that fails isn't asked again in a loop
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const ensureSummaryBodies = useCallback(async (ids: readonly string[], folder?: string) => {
    const missing = ids.filter((id) => !summaryAsked.current.has(id) && recordsRef.current?.find((r) => r.id === id)?.body === undefined);
    if (!missing.length) return;
    for (const id of missing) summaryAsked.current.add(id);
    const got = new Map<string, LibraryRecord>();
    if (folder && missing.length > 1) {
      try {
        const q = (params: Record<string, unknown>) => vault.queryRecords(params) as Promise<LibraryRecord[]>;
        const res = await readFolder(q, { pathPrefix: folder, tag: "summary", includeFields: true, includeBody: true });
        for (const r of res.rows) got.set(r.id, r);
      } catch { /* one at a time below */ }
    }
    const rest = missing.filter((id) => !got.has(id));
    for (let i = 0; i < rest.length; i += 6) {
      await Promise.all(rest.slice(i, i + 6).map(async (id) => {
        try {
          const r = await vault.getRecord(id) as LibraryRecord | null;
          if (r) got.set(r.id, r);
        } catch { /* stays "Opening summary…"; asked again on the next load */ }
      }));
    }
    if (!mounted.current) return;
    for (const id of missing) if (!got.has(id)) summaryAsked.current.delete(id);
    if (!got.size) return;
    setSummaryBodies((prev) => {
      const next = { ...prev };
      for (const r of got.values()) next[r.id] = r;
      return next;
    });
  }, []);

  const openSummaryDrawer = useCallback((title: string, summaries: readonly LibraryRecord[]) => {
    const ids = summaries.map((s) => s.id);
    setSummaryDrawerTitle(title);
    setSummaryDrawerIds(ids);
    setSummaryDrawerOpen(true);
    void ensureSummaryBodies(ids);
  }, [ensureSummaryBodies]);

  // A book's summaries, for its contents (a line under each chapter) and its Summaries tab
  useEffect(() => {
    if (route.view !== "book") return;
    const bundle = lib.bookByKey.get(route.bookId);
    if (!bundle) return;
    const allIds = [
      ...bundle.bookSummaries.map((s) => s.id),
      ...[...bundle.summariesByChapter.values()].flat().map((s) => s.id),
    ];
    void ensureSummaryBodies(allIds, `${stripMd(bundle.book.path)}/`);
  }, [route, lib, ensureSummaryBodies]);

  // Preload cover for active book view
  useEffect(() => {
    if (route.view !== "book") return;
    const bundle = lib.bookByKey.get(route.bookId);
    if (bundle?.coverSrc) ensureCover(bundle.book.id, bundle.coverSrc, true);
  }, [route, lib, ensureCover]);

  const currentBook = route.view !== "home" ? lib.bookByKey.get(route.bookId) ?? null : null;

  // Handle internal wikilinks inside a chapter (e.g. `[[02 Water|watering]]` or `[[Books/Walden/02 Where I Lived]]`)
  const followLink = useCallback((target: string) => {
    const clean = normalizeRef(target);
    if (!clean) return;
    const l = libRef.current;
    const direct = l.chapterByKey.get(clean) ?? l.chapterByKey.get(clean.toLowerCase());
    if (direct) {
      void openChapter(direct.book.book.id, direct.chapter.id);
      return;
    }
    // Relative wikilink within the same book (e.g. `[[02 Water]]`)
    if (activeReadRef.current) {
      const b = l.bookByKey.get(activeReadRef.current.bookId);
      if (b) {
        const rel = `${stripMd(b.book.path)}/${clean}`;
        const hit = l.chapterByKey.get(rel) ?? l.chapterByKey.get(rel.toLowerCase())
          ?? b.chapters.find((c) => basenameOf(c.path).toLowerCase() === clean.toLowerCase() || chapterDisplayTitle(c).toLowerCase() === clean.toLowerCase());
        if (hit) {
          const ch = "chapter" in hit ? hit.chapter : hit;
          void openChapter(b.book.id, ch.id);
          return;
        }
      }
    }
    const bHit = l.bookByKey.get(clean) ?? l.bookByKey.get(clean.toLowerCase());
    if (bHit) {
      leaveChapter({ view: "book", bookId: bHit.book.id });
      return;
    }
    const sHit = l.summaryByKey.get(clean) ?? l.summaryByKey.get(clean.toLowerCase());
    if (sHit) {
      openSummaryDrawer(chapterDisplayTitle(sHit.summary), [sHit.summary]);
      return;
    }
    toast(`Could not find “${clean}” in your library.`);
  }, [openChapter, leaveChapter, openSummaryDrawer]);
  // the same function for the life of the applet: a Note given a new one draws again, and the chapter's Note holds the
  // quote marks, which React must not redraw under
  const followLinkRef = useRef(followLink);
  followLinkRef.current = followLink;
  const handleChapterLink = useCallback((target: string) => followLinkRef.current(target), []);

  // Save a newly marked quote
  const saveNewQuote = async () => {
    if (!draftLocator || !currentBook || !activeChapter || savingQuote) return;
    setSavingQuote(true);
    try {
      const stamp = when.path(Date.now(), true);
      const path = makeQuotePath(currentBook.title, draftLocator.quote, stamp);
      const body = formatQuoteBody(draftLocator.quote, quoteNote);
      const fields: Record<string, unknown> = {
        from: stripMd(activeChapter.path),
        book: stripMd(currentBook.book.path),
        block: draftLocator.block,
        before: draftLocator.before,
        after: draftLocator.after,
      };
      if (currentBook.fields.author) fields.by = currentBook.fields.author;

      const created = await vault.createRecord({ path, body, fields }) as LibraryRecord;
      const fullRec: LibraryRecord = {
        ...created,
        path: created.path || path,
        tags: created.tags?.length ? created.tags : ["quote"],
        fields: { ...fields, ...(created.fields ?? {}) },
        body,
      };
      if (!mounted.current) return;
      setRecords((prev) => (prev ? [fullRec, ...prev] : [fullRec]));
      setQuoteDrawerOpen(false);
      setDraftLocator(null);
      setQuoteNote("");
      setPendingSel(null);
      window.getSelection()?.removeAllRanges();
      toast("Quote saved.");
    } catch (e) {
      toast(`Could not save quote: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      if (mounted.current) setSavingQuote(false);
    }
  };

  // Save edited note on an existing quote
  const saveQuoteNoteEdit = async (q: ParsedQuote) => {
    if (editingQuoteNote === null || savingQuoteEdit) return;
    const base = q.record.updatedAt;
    if (!base) {
      toast("This quote has no version to save against.", { error: true });
      return;
    }
    setSavingQuoteEdit(true);
    try {
      const nextBody = formatQuoteBody(q.text, editingQuoteNote);
      const updated = await vault.updateRecord(q.record.id, { if_updated_at: base, body: nextBody }) as LibraryRecord;
      if (!mounted.current) return;
      setRecords((prev) => (prev ? prev.map((r) => (r.id === q.record.id ? { ...r, ...updated, body: nextBody } : r)) : prev));
      setEditingQuoteNote(null);
      toast("Quote note saved.");
    } catch (e) {
      const conflict = (e as { status?: number })?.status === 409;
      toast(conflict ? "Someone else changed this quote. Close and open it again." : `Could not save note: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      if (mounted.current) setSavingQuoteEdit(false);
    }
  };

  const openQuoteFromList = useCallback((q: ParsedQuote) => {
    const chHit = q.chapterRef ? (lib.chapterByKey.get(q.chapterRef) ?? lib.chapterByKey.get(q.chapterRef.toLowerCase())) : undefined;
    if (chHit) {
      void openChapter(chHit.book.book.id, chHit.chapter.id, { focusQuoteId: q.record.id, targetBlock: q.block ?? 1 });
      return;
    }
    const bHit = q.bookRef ? (lib.bookByKey.get(q.bookRef) ?? lib.bookByKey.get(q.bookRef.toLowerCase())) : undefined;
    if (bHit) {
      setRoute({ view: "book", bookId: bHit.book.id });
      setBookTab("quotes");
      toast("Could not locate that chapter; opened the book.");
      return;
    }
    toast("Could not find the chapter for this quote.");
  }, [lib, openChapter, setRoute, setBookTab]);

  const shelfFilter = shelfQuery.trim().toLowerCase();
  const visibleBooks = useMemo(() => {
    if (!shelfFilter) return lib.books;
    return lib.books.filter((b) => {
      const hay = [b.title, b.fields.author, b.fields.translator, b.fields.status, b.fields.kind, ...b.chapters.map(chapterDisplayTitle)]
        .join(" ")
        .toLowerCase();
      return hay.includes(shelfFilter);
    });
  }, [lib.books, shelfFilter]);

  const readingNow = useMemo(
    () => visibleBooks.filter((b) => b.fields.status === "reading" || (Boolean(b.fields.at) && b.fields.status !== "read")),
    [visibleBooks],
  );

  const quoteFilter = quotesQuery.trim().toLowerCase();
  const quotesByBookGroups = useMemo(() => {
    const filteredQuotes = !quoteFilter
      ? lib.quotes
      : lib.quotes.filter((q) => {
        const chHit = lib.chapterByKey.get(q.chapterRef) ?? lib.chapterByKey.get(q.chapterRef.toLowerCase());
        const bHit = chHit?.book ?? lib.bookByKey.get(q.bookRef) ?? lib.bookByKey.get(q.bookRef.toLowerCase());
        const hay = [q.text, q.note, q.by, bHit?.title ?? basenameOf(q.bookRef), chHit ? chapterDisplayTitle(chHit.chapter) : basenameOf(q.chapterRef)]
          .join(" ")
          .toLowerCase();
        return hay.includes(quoteFilter);
      });

    const map = new Map<string, { title: string; book: BookBundle | null; quotes: ParsedQuote[] }>();
    for (const q of filteredQuotes) {
      const chHit = lib.chapterByKey.get(q.chapterRef) ?? lib.chapterByKey.get(q.chapterRef.toLowerCase());
      const bHit = chHit?.book ?? lib.bookByKey.get(q.bookRef) ?? lib.bookByKey.get(q.bookRef.toLowerCase()) ?? null;
      const key = bHit?.book.id ?? (q.bookRef.toLowerCase() || "__other__");
      const title = bHit?.title ?? (q.bookRef ? bookTitleOf(q.bookRef) : "Other quotes");
      const entry = map.get(key) ?? { title, book: bHit, quotes: [] };
      entry.quotes.push(q);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [lib, quoteFilter]);

  // ── Render: READ VIEW ──
  if (route.view === "read" && currentBook) {
    const chapter = activeChapter && activeChapter.id === route.chapterId
      ? activeChapter
      : (lib.chapterByKey.get(route.chapterId)?.chapter ?? null);
    const chTitle = chapter ? chapterDisplayTitle(chapter) : "Chapter";

    // Ordered readable chapters for Previous / Next navigation
    const idx = currentBook.chapters.findIndex((c) => c.id === route.chapterId);
    const prevCh = idx > 0 ? currentBook.chapters[idx - 1] : null;
    const nextCh = idx >= 0 && idx + 1 < currentBook.chapters.length ? currentBook.chapters[idx + 1] : null;

    // Summaries for this chapter (or its part / book as fallback)
    const chSummaries = chapter ? (currentBook.summariesByChapter.get(chapter.id) ?? []) : [];
    const partRef = chapter ? normalizeRef(chapter.fields?.part) : "";
    const partHit = partRef ? (lib.chapterByKey.get(partRef) ?? lib.chapterByKey.get(partRef.toLowerCase())) : undefined;
    const partSummaries = partHit ? (currentBook.summariesByChapter.get(partHit.chapter.id) ?? []) : [];
    const availableSummaries = chSummaries.length ? chSummaries : (partSummaries.length ? partSummaries : currentBook.bookSummaries);
    const summaryLabel = chSummaries.length ? "Chapter summary" : (partSummaries.length ? "Part summary" : "Book summary");

    const chapterKey = chapter ? stripMd(chapter.path).toLowerCase() : "";
    const chapterQuotes = currentBook.quotes.filter(
      (q) => q.chapterRef.toLowerCase() === chapterKey || q.chapterRef === chapter?.id,
    );
    const viewedQuote = viewedQuoteId ? lib.quoteByKey.get(viewedQuoteId) ?? null : null;

    return (
      <>
        <style>{STYLES}</style>
        <Page
          title={chTitle}
          kicker={currentBook.title}
          back={{ label: currentBook.title, onPress: () => leaveChapter({ view: "book", bookId: currentBook.book.id }) }}
          aside={(
            <>
              {availableSummaries.length > 0 && (
                <Button small onClick={() => openSummaryDrawer(summaryLabel, availableSummaries)}>Summary</Button>
              )}
              {chapterQuotes.length > 0 && (
                <Button small kind="quiet" onClick={() => setChapterQuotesOpen(true)}>
                  Quotes · {chapterQuotes.length}
                </Button>
              )}
            </>
          )}
          onRefresh={async () => {
            await load();
            await openChapter(currentBook.book.id, route.chapterId, { focusQuoteId: route.focusQuoteId, targetBlock: stoppedBlockRef.current, fresh: true });
          }}
        >
          {chapterError ? (
            <Problem error={chapterError} onRetry={() => void openChapter(currentBook.book.id, route.chapterId)}>
              Could not open this chapter.
            </Problem>
          ) : chapterLoading && !chapter?.body ? (
            <Loading>Opening chapter…</Loading>
          ) : chapter ? (
            <>
              <ChapterProse
                chapter={chapter}
                quotes={chapterQuotes}
                focusQuoteId={route.focusQuoteId}
                targetBlock={route.targetBlock}
                onLink={handleChapterLink}
                onOpenQuote={(qid) => { setEditingQuoteNote(null); setViewedQuoteId(qid); }}
                onSelection={setPendingSel}
                onActiveBlock={(blk) => { stoppedBlockRef.current = blk; }}
              />
              {(prevCh || nextCh) && (
                <div className="lib-chapter-nav">
                  {prevCh ? (
                    <Button small onClick={() => void openChapter(currentBook.book.id, prevCh.id)}>
                      ← {chapterDisplayTitle(prevCh)}
                    </Button>
                  ) : <span />}
                  {nextCh ? (
                    <Button small kind="primary" onClick={() => {
                      // on to the next chapter: that is where you are now, from its start
                      activeReadRef.current = null;
                      persistReadingPosition({ bookId: currentBook.book.id, chapterPath: nextCh.path, block: 1 });
                      void openChapter(currentBook.book.id, nextCh.id);
                    }}>
                      {chapterDisplayTitle(nextCh)} →
                    </Button>
                  ) : <span />}
                </div>
              )}
            </>
          ) : (
            <Empty>This chapter is not in your library.</Empty>
          )}

          {pendingSel && !quoteDrawerOpen && (
            <div className="lib-sel-bar">
              <span className="lib-sel-preview">“{pendingSel.quote}”</span>
              <Button
                kind="primary"
                small
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setDraftLocator(pendingSel);
                  setQuoteNote("");
                  setQuoteDrawerOpen(true);
                }}
              >
                Quote
              </Button>
              <Button
                kind="quiet"
                small
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setPendingSel(null);
                  window.getSelection()?.removeAllRanges();
                }}
              >
                Cancel
              </Button>
            </div>
          )}

          {/* Mark quote drawer */}
          <Drawer
            open={quoteDrawerOpen}
            onClose={() => { setQuoteDrawerOpen(false); setDraftLocator(null); }}
            title="Mark quote"
          >
            {draftLocator && (
              <>
                <p className="lib-summary-meta">{chTitle} · ¶ {draftLocator.block}</p>
                <div className="lib-quote-preview">“{draftLocator.quote}”</div>
                <Write
                  label="Note (optional)"
                  labelled
                  placeholder="Add a note about this passage, or save it as is…"
                  value={quoteNote}
                  onChange={setQuoteNote}
                  onSend={saveNewQuote}
                  send={savingQuote ? "Saving…" : "Save quote"}
                  canSend={!savingQuote}
                  busy={savingQuote}
                >
                  <Button kind="quiet" onClick={() => { setQuoteDrawerOpen(false); setDraftLocator(null); }}>Cancel</Button>
                </Write>
              </>
            )}
          </Drawer>

          {/* View / edit existing marked quote drawer */}
          <Drawer
            open={viewedQuote !== null}
            onClose={() => { setViewedQuoteId(null); setEditingQuoteNote(null); }}
            title="Marked quote"
          >
            {viewedQuote && (
              <>
                <p className="lib-summary-meta">
                  {chTitle}
                  {viewedQuote.block ? ` · ¶ ${viewedQuote.block}` : ""}
                  {viewedQuote.record.createdAt || viewedQuote.record.updatedAt
                    ? ` · ${when.short(viewedQuote.record.createdAt ?? viewedQuote.record.updatedAt)}`
                    : ""}
                </p>
                <div className="lib-quote-preview">“{viewedQuote.text}”</div>
                {editingQuoteNote !== null ? (
                  <Write
                    label="Your note"
                    labelled
                    placeholder="Write a note…"
                    value={editingQuoteNote}
                    onChange={setEditingQuoteNote}
                    onSend={() => saveQuoteNoteEdit(viewedQuote)}
                    send={savingQuoteEdit ? "Saving…" : "Save note"}
                    canSend={!savingQuoteEdit}
                    busy={savingQuoteEdit}
                  >
                    <Button kind="quiet" onClick={() => setEditingQuoteNote(null)}>Cancel</Button>
                  </Write>
                ) : (
                  <>
                    {viewedQuote.note && <p className="lib-quote-note">{viewedQuote.note}</p>}
                    <div className="pa-actions">
                      <Button small onClick={() => setEditingQuoteNote(viewedQuote.note)}>
                        {viewedQuote.note ? "Edit note" : "Add note"}
                      </Button>
                      <Button
                        small
                        kind="quiet"
                        onClick={async () => {
                          const ok = await app.copy(`“${viewedQuote.text}” — ${currentBook.title}${viewedQuote.note ? `\n\n${viewedQuote.note}` : ""}`);
                          toast(ok ? "Copied quote." : "Could not copy.", { error: !ok });
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </Drawer>

          {/* Summary drawer (a tap away while reading) */}
          <Drawer
            open={summaryDrawerOpen}
            onClose={() => setSummaryDrawerOpen(false)}
            title={summaryDrawerTitle}
          >
            {summaryDrawerIds.map((sid) => {
              const rec = summaryBodies[sid] ?? records?.find((r) => r.id === sid);
              if (!rec) return null;
              const by = str(rec.fields?.by);
              const made = str(rec.fields?.made);
              return (
                <div key={sid} className="lib-summary-block">
                  {(by || made) && (
                    <p className="lib-summary-meta">
                      {[by ? `By ${by}` : "", made ? when.short(made) : ""].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {rec.body !== undefined
                    ? <Note id={rec.id} body={rec.body} path={rec.path} tags={rec.tags} fields={rec.fields} onLink={handleChapterLink} />
                    : <Loading>Opening summary…</Loading>}
                </div>
              );
            })}
          </Drawer>

          {/* Quotes in this chapter drawer */}
          <Drawer
            open={chapterQuotesOpen}
            onClose={() => setChapterQuotesOpen(false)}
            title={`Quotes in ${chTitle}`}
          >
            <List
              label={`Quotes in ${chTitle}`}
              hideLabel
              rows={chapterQuotes.map((q) => ({
                key: q.record.id,
                title: `“${q.text.length > 110 ? `${q.text.slice(0, 109).trimEnd()}…` : q.text}”`,
                meta: q.note || undefined,
                aside: q.block ? `¶ ${q.block}` : undefined,
                onPress: () => {
                  setChapterQuotesOpen(false);
                  setRoute({ view: "read", bookId: currentBook.book.id, chapterId: route.chapterId, focusQuoteId: q.record.id, targetBlock: q.block ?? 1 });
                },
              }))}
            />
          </Drawer>
        </Page>
      </>
    );
  }

  // ── Render: BOOK VIEW ──
  if (route.view === "book" && currentBook) {
    const coverUrl = currentBook.coverSrc ? coverUrls[`${currentBook.book.id}|${currentBook.coverSrc}`] : undefined;
    const stopped = parseReadingAt(currentBook.fields.at);
    const stoppedHit = stopped
      ? (lib.chapterByKey.get(stopped.chapterRef) ?? lib.chapterByKey.get(stopped.chapterRef.toLowerCase()))
      : undefined;
    const partIds = new Set(currentBook.groups.map((g) => g.part?.id).filter((id): id is string => Boolean(id)));
    const chapterCount = currentBook.chapters.filter((c) => !partIds.has(c.id)).length || currentBook.chapters.length;
    const firstChapter = currentBook.chapters.find((c) => !partIds.has(c.id)) ?? currentBook.chapters[0] ?? null;
    const resumeTarget = stoppedHit?.chapter ?? firstChapter;
    const totalWords = currentBook.chapters.reduce((sum, c) => sum + (num(c.fields?.words) ?? 0), 0);

    const allSummaries: { summary: LibraryRecord; targetTitle: string; chapter: LibraryRecord | null }[] = [
      ...currentBook.bookSummaries.map((s) => ({ summary: s, targetTitle: chapterDisplayTitle(s) || currentBook.title, chapter: null })),
      ...currentBook.chapters.flatMap((ch) =>
        (currentBook.summariesByChapter.get(ch.id) ?? []).map((s) => ({ summary: s, targetTitle: chapterDisplayTitle(ch), chapter: ch })),
      ),
    ];

    return (
      <>
        <style>{STYLES}</style>
        <Page
          title={currentBook.title}
          kicker={currentBook.fields.author || "Book"}
          back={{ label: "Shelf", onPress: () => setRoute({ view: "home" }) }}
          aside={<Button small onClick={() => setDetailsDrawerOpen(true)}>Details</Button>}
          onRefresh={load}
        >
          <div className="lib-book-hero">
            <BookCover
              title={currentBook.title}
              author={currentBook.fields.author}
              url={coverUrl}
              size="hero"
              want={currentBook.coverSrc ? () => ensureCover(currentBook.book.id, currentBook.coverSrc, true) : undefined}
            />
            <div className="lib-book-hero-body">
              <div className="lib-book-stats">
                <span>{currentBook.fields.status}</span>
                {currentBook.fields.translator && <span>Tr. {currentBook.fields.translator}</span>}
                <span>{chapterCount} {chapterCount === 1 ? "chapter" : "chapters"}</span>
                {totalWords > 0 && <span>{totalWords.toLocaleString()} words</span>}
                {currentBook.quotes.length > 0 && <span>{currentBook.quotes.length} {currentBook.quotes.length === 1 ? "quote" : "quotes"}</span>}
              </div>
              {stoppedHit && (
                <p className="lib-muted">
                  Stopped at {chapterDisplayTitle(stoppedHit.chapter)}{stopped && stopped.block > 1 ? ` · ¶ ${stopped.block}` : ""}
                </p>
              )}
              <div className="pa-actions">
                {resumeTarget && (
                  <Button
                    kind="primary"
                    onClick={() => void openChapter(currentBook.book.id, resumeTarget.id, { targetBlock: stoppedHit ? (stopped?.block ?? 1) : 1 })}
                  >
                    {stoppedHit ? "Continue reading" : "Start reading"}
                  </Button>
                )}
                {currentBook.bookSummaries.length > 0 && (
                  <Button onClick={() => openSummaryDrawer("Book summary", currentBook.bookSummaries)}>
                    Book summary
                  </Button>
                )}
              </div>
            </div>
          </div>

          <Tabs
            label="Book sections"
            current={bookTab}
            onChange={(k) => setBookTab(k as BookTab)}
            tabs={[
              { key: "contents", label: "Contents", count: chapterCount },
              { key: "summaries", label: "Summaries", count: allSummaries.length },
              { key: "quotes", label: "Quotes", count: currentBook.quotes.length },
            ]}
          />

          {bookTab === "contents" && (
            currentBook.chapters.length === 0 ? (
              <Empty>No chapters in this book yet.</Empty>
            ) : (
              currentBook.groups.map((grp, gi) => {
                const groupChapters = grp.part ? [grp.part, ...grp.chapters] : grp.chapters;
                return (
                  <List
                    key={grp.part?.id ?? `g-${gi}`}
                    label={grp.title || "Contents"}
                    hideLabel={!grp.title && currentBook.groups.length === 1}
                    rows={groupChapters.map((ch) => {
                      const isPart = grp.part?.id === ch.id;
                      const chKey = stripMd(ch.path).toLowerCase();
                      const chQuotes = currentBook.quotes.filter((q) => q.chapterRef.toLowerCase() === chKey || q.chapterRef === ch.id);
                      const chSums = currentBook.summariesByChapter.get(ch.id) ?? [];
                      const sumBody = chSums[0] ? (summaryBodies[chSums[0].id]?.body ?? chSums[0].body) : "";
                      const sumPreview = markdownPreview(sumBody, 120);
                      const words = num(ch.fields?.words);
                      const isHere = stoppedHit?.chapter.id === ch.id;
                      return {
                        key: ch.id,
                        title: isPart ? "Part opening" : chapterDisplayTitle(ch),
                        meta: sumPreview || (chSums.length ? "Summary available" : undefined),
                        aside: words ? `${words.toLocaleString()} w` : (chSums.length ? "Summary" : undefined),
                        badge: chQuotes.length > 0 ? chQuotes.length : undefined,
                        strong: isHere,
                        current: isHere,
                        under: isHere ? `Where you stopped${stopped && stopped.block > 1 ? ` · ¶ ${stopped.block}` : ""}` : undefined,
                        onPress: () => void openChapter(currentBook.book.id, ch.id, { targetBlock: isHere ? (stopped?.block ?? 1) : 1 }),
                      };
                    })}
                  />
                );
              })
            )
          )}

          {bookTab === "summaries" && (
            allSummaries.length === 0 ? (
              <Empty>No summaries for this book yet.</Empty>
            ) : (
              allSummaries.map(({ summary, targetTitle, chapter }) => {
                const full = summaryBodies[summary.id] ?? summary;
                const by = str(full.fields?.by);
                const made = str(full.fields?.made);
                return (
                  <div key={summary.id} className="lib-summary-block">
                    <div className="lib-summary-head">
                      <span className="lib-summary-title">{targetTitle}</span>
                      {chapter && (
                        <Button small kind="quiet" onClick={() => void openChapter(currentBook.book.id, chapter.id)}>
                          Read chapter
                        </Button>
                      )}
                    </div>
                    {(by || made) && (
                      <p className="lib-summary-meta">
                        {[by ? `By ${by}` : "", made ? when.short(made) : ""].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {full.body !== undefined
                      ? <Note id={full.id} body={full.body} path={full.path} tags={full.tags} fields={full.fields} onLink={handleChapterLink} />
                      : <Loading>Opening summary…</Loading>}
                  </div>
                );
              })
            )
          )}

          {bookTab === "quotes" && (
            currentBook.quotes.length === 0 ? (
              <Empty>No quotes marked in this book yet. Select text while reading to mark one.</Empty>
            ) : (
              <List
                label={`Quotes · ${currentBook.quotes.length}`}
                hideLabel
                rows={currentBook.quotes.map((q) => {
                  const chHit = lib.chapterByKey.get(q.chapterRef) ?? lib.chapterByKey.get(q.chapterRef.toLowerCase());
                  const place = [
                    chHit ? chapterDisplayTitle(chHit.chapter) : basenameOf(q.chapterRef),
                    q.block ? `¶ ${q.block}` : "",
                  ].filter(Boolean).join(" · ");
                  return {
                    key: q.record.id,
                    title: `“${q.text}”`,
                    meta: [q.note, place].filter(Boolean).join(" — "),
                    aside: when.short(q.record.createdAt ?? q.record.updatedAt),
                    onPress: () => openQuoteFromList(q),
                  };
                })}
              />
            )
          )}

          {/* Book Details Drawer (status, rating, finished, metadata) */}
          <Drawer open={detailsDrawerOpen} onClose={() => setDetailsDrawerOpen(false)} title="Book details">
            <Fields
              label="Book details"
              fields={[
                { name: "status", label: "Status", kind: "choice", choices: BOOK_STATUSES, value: currentBook.fields.status },
                { name: "rating", label: "Rating", kind: "number", value: currentBook.fields.rating },
                { name: "finished", label: "Finished", kind: "date", value: currentBook.fields.finished || null },
                { name: "author", label: "Author", kind: "text", value: currentBook.fields.author, readOnly: true },
                ...(currentBook.fields.translator ? [{ name: "translator", label: "Translator", kind: "text" as const, value: currentBook.fields.translator, readOnly: true }] : []),
                ...(currentBook.fields.language ? [{ name: "language", label: "Language", kind: "text" as const, value: currentBook.fields.language, readOnly: true }] : []),
                ...(currentBook.fields.kind ? [{ name: "kind", label: "Kind", kind: "choice" as const, choices: BOOK_KINDS, value: currentBook.fields.kind, readOnly: true }] : []),
                ...(currentBook.fields.rights ? [{ name: "rights", label: "Rights", kind: "text" as const, value: currentBook.fields.rights, readOnly: true }] : []),
                ...(currentBook.fields.source ? [{ name: "source", label: "Source", kind: "text" as const, value: currentBook.fields.source, readOnly: true }] : []),
              ]}
              onSave={async (name, value) => {
                const patch: Record<string, unknown> = { [name]: value };
                if (name === "status" && value === "read" && !currentBook.fields.finished) {
                  patch.finished = when.stamp(Date.now()).slice(0, 10);
                }
                if (await patchBookFields(currentBook.book.id, patch)) toast("Updated book.");
              }}
            />
          </Drawer>

          {/* Book Summary Drawer */}
          <Drawer open={summaryDrawerOpen} onClose={() => setSummaryDrawerOpen(false)} title={summaryDrawerTitle}>
            {summaryDrawerIds.map((sid) => {
              const rec = summaryBodies[sid] ?? records?.find((r) => r.id === sid);
              if (!rec) return null;
              return (
                <div key={sid} className="lib-summary-block">
                  {rec.body !== undefined
                    ? <Note id={rec.id} body={rec.body} path={rec.path} tags={rec.tags} fields={rec.fields} onLink={handleChapterLink} />
                    : <Loading>Opening summary…</Loading>}
                </div>
              );
            })}
          </Drawer>
        </Page>
      </>
    );
  }

  // ── Render: HOME (SHELF & QUOTES) ──
  return (
    <>
      <style>{STYLES}</style>
      <Page
        title="Library"
        wide={homeTab === "shelf"}
        onRefresh={load}
      >
        <Tabs
          label="Library views"
          current={homeTab}
          onChange={(k) => setHomeTab(k as HomeTab)}
          tabs={[
            { key: "shelf", label: "Shelf", count: lib.books.length },
            { key: "quotes", label: "Quotes", count: lib.quotes.length },
          ]}
        />

        {capped && !error && (
          <p className="lib-summary-meta">Your library has more than 5,000 records in one folder; only the first 5,000 are shown.</p>
        )}
        {error ? (
          <Problem error={error} onRetry={load}>Could not read your library.</Problem>
        ) : records === null ? (
          <Loading>Opening your library…</Loading>
        ) : homeTab === "shelf" ? (
          <>
            {lib.books.length > 0 && (
              <Search
                label="Search books"
                placeholder="Search books, authors, chapters"
                value={shelfQuery}
                onChange={setShelfQuery}
                onSearch={setShelfQuery}
                live={150}
              />
            )}

            {visibleBooks.length === 0 ? (
              <Empty>
                {shelfFilter
                  ? `No books match “${shelfQuery}”.`
                  : "No books in Books/ yet. Import a book into your vault to see it on the shelf."}
              </Empty>
            ) : (
              <>
                {readingNow.length > 0 && !shelfFilter && (
                  <section className="lib-shelf-section" aria-label="Reading now">
                    <p className="lib-section-label">Reading now</p>
                    <div className="lib-reading-grid">
                      {readingNow.map((b) => {
                        const coverUrl = b.coverSrc ? coverUrls[`${b.book.id}|${b.coverSrc}`] : undefined;
                        const stopped = parseReadingAt(b.fields.at);
                        const stoppedCh = stopped
                          ? (lib.chapterByKey.get(stopped.chapterRef) ?? lib.chapterByKey.get(stopped.chapterRef.toLowerCase()))?.chapter
                          : undefined;
                        const firstCh = b.chapters.find((c) => !b.groups.some((g) => g.part?.id === c.id)) ?? b.chapters[0];
                        const resumeCh = stoppedCh ?? firstCh;
                        return (
                          <Card key={b.book.id}>
                            <div className="lib-reading-card">
                              <BookCover
                                title={b.title}
                                author={b.fields.author}
                                url={coverUrl}
                                want={b.coverSrc ? () => ensureCover(b.book.id, b.coverSrc, true) : undefined}
                              />
                              <div className="lib-reading-meta">
                                <p className="lib-reading-title">{b.title}</p>
                                {b.fields.author && <p className="lib-muted">{b.fields.author}</p>}
                                {stoppedCh && (
                                  <p className="lib-muted">
                                    Stopped at {chapterDisplayTitle(stoppedCh)}{stopped && stopped.block > 1 ? ` · ¶ ${stopped.block}` : ""}
                                  </p>
                                )}
                                <div className="pa-actions">
                                  {resumeCh && (
                                    <Button
                                      kind="primary"
                                      small
                                      onClick={() => void openChapter(b.book.id, resumeCh.id, { targetBlock: stoppedCh ? (stopped?.block ?? 1) : 1 })}
                                    >
                                      Continue
                                    </Button>
                                  )}
                                  <Button
                                    small
                                    onClick={() => { setBookTab("contents"); setRoute({ view: "book", bookId: b.book.id }); }}
                                  >
                                    Contents
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="lib-shelf-section" aria-label="All books">
                  <p className="lib-section-label">
                    {shelfFilter ? `Matches · ${visibleBooks.length}` : `Shelf · ${visibleBooks.length}`}
                  </p>
                  <div className="lib-shelf-grid">
                    {visibleBooks.map((b) => {
                      const coverUrl = b.coverSrc ? coverUrls[`${b.book.id}|${b.coverSrc}`] : undefined;
                      const openBook = () => {
                        setBookTab("contents");
                        setRoute({ view: "book", bookId: b.book.id });
                      };
                      return (
                        <div
                          key={b.book.id}
                          role="button"
                          tabIndex={0}
                          className="lib-book-card"
                          aria-label={b.title}
                          onClick={openBook}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBook(); } }}
                        >
                          <BookCover
                            title={b.title}
                            author={b.fields.author}
                            url={coverUrl}
                            want={b.coverSrc ? () => ensureCover(b.book.id, b.coverSrc) : undefined}
                          />
                          <span className="lib-book-card-title">{b.title}</span>
                          {b.fields.author && <span className="lib-book-card-author">{b.fields.author}</span>}
                          <span className="lib-book-card-status">
                            {[
                              b.fields.status,
                              b.quotes.length ? `${b.quotes.length} ${b.quotes.length === 1 ? "quote" : "quotes"}` : "",
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </>
        ) : (
          <>
            {lib.quotes.length > 0 && (
              <Search
                label="Search quotes"
                placeholder="Search quotes, notes, books"
                value={quotesQuery}
                onChange={setQuotesQuery}
                onSearch={setQuotesQuery}
                live={150}
              />
            )}

            {quotesByBookGroups.length === 0 ? (
              <Empty>
                {quoteFilter
                  ? `No quotes match “${quotesQuery}”.`
                  : "No quotes yet. Select any passage while reading a chapter to mark it."}
              </Empty>
            ) : (
              quotesByBookGroups.map((grp) => (
                <List
                  key={grp.book?.book.id ?? grp.title}
                  label={`${grp.title} · ${grp.quotes.length}`}
                  rows={grp.quotes.map((q) => {
                    const chHit = lib.chapterByKey.get(q.chapterRef) ?? lib.chapterByKey.get(q.chapterRef.toLowerCase());
                    const place = [
                      chHit ? chapterDisplayTitle(chHit.chapter) : basenameOf(q.chapterRef),
                      q.block ? `¶ ${q.block}` : "",
                    ].filter(Boolean).join(" · ");
                    return {
                      key: q.record.id,
                      title: `“${q.text}”`,
                      meta: [q.note, place].filter(Boolean).join(" — "),
                      aside: when.short(q.record.createdAt ?? q.record.updatedAt),
                      onPress: () => openQuoteFromList(q),
                    };
                  })}
                />
              ))
            )}
          </>
        )}
      </Page>
    </>
  );
}
