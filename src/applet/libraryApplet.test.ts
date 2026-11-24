// Unit tests for Library applet pure logic (applets/library.tsx):
// quote locator round-trip (exact, repeated phrase disambiguation by context & block, shifted paragraphs,
// multi-paragraph selections, whitespace & curly-quote normalization, overlapping highlights),
// quote body format/parse round-trip, reading-position (`at`) round-trip, library organization,
// strict TypeScript type-checking against applets/parachute.d.ts, and checkAppletRecord (--strict).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transform } from "sucrase";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkAppletRecord, type AppletRecordInput } from "./check";

const src = readFileSync(`${process.cwd()}/applets/library.tsx`, "utf8");
const start = src.indexOf("// ── pure helpers (tested in src/applet/libraryApplet.test.ts) ──");
const end = src.indexOf("// ── end pure helpers ──");
if (start < 0 || end < 0 || end <= start) throw new Error("could not locate pure helpers block in applets/library.tsx");
const block = src.slice(start, end);
const code = transform(block, { transforms: ["typescript"] }).code;

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

type QuoteLocator = { quote: string; block: number; before: string; after: string };
type BlockSelection = { startBlock: number; startOffset: number; endBlock: number; endOffset: number };
type LocatedQuote = BlockSelection & { flatStart: number; flatEnd: number; score: number };
type HighlightSlice = { start: number; end: number; quoteIds: string[] };

const api = new Function(
  `${code}; return {
    extractCoverPath, formatReadingAt, parseReadingAt, formatQuoteBody, parseQuoteBody,
    makeQuotePath, markdownPreview, createQuoteLocator, locateQuote, buildHighlightRanges,
    organizeLibrary, readFolder, chapterDisplayTitle, normalizeRef
  };`,
)() as {
  extractCoverPath: (body?: string, fields?: Record<string, unknown>) => string;
  formatReadingAt: (chapterPath: string, block?: number) => string;
  parseReadingAt: (raw: unknown) => { chapterRef: string; block: number } | null;
  formatQuoteBody: (quoteText: string, note?: string) => string;
  parseQuoteBody: (body?: string) => { text: string; note: string };
  makeQuotePath: (bookTitle: string, quoteText: string, stamp: string) => string;
  markdownPreview: (body?: string, maxLen?: number) => string;
  createQuoteLocator: (blocks: readonly string[], sel: BlockSelection) => QuoteLocator | null;
  locateQuote: (
    blocks: readonly string[],
    locator: { quote: string; block?: number | null; before?: string; after?: string },
  ) => LocatedQuote | null;
  buildHighlightRanges: (
    blocks: readonly string[],
    quotes: readonly { id: string; text: string; block: number | null; before: string; after: string }[],
  ) => { byBlock: Map<number, HighlightSlice[]>; locatedIds: Map<string, LocatedQuote> };
  organizeLibrary: (records: readonly LibraryRecord[]) => {
    books: {
      book: LibraryRecord;
      title: string;
      coverSrc: string;
      chapters: LibraryRecord[];
      groups: { part: LibraryRecord | null; title: string; chapters: LibraryRecord[] }[];
      bookSummaries: LibraryRecord[];
      summariesByChapter: Map<string, LibraryRecord[]>;
      quotes: { record: LibraryRecord; text: string; note: string; chapterRef: string; block: number | null }[];
    }[];
    quotes: { record: LibraryRecord; text: string; note: string; chapterRef: string; block: number | null }[];
  };
  readFolder: (query: (q: Record<string, unknown>) => Promise<LibraryRecord[]>, base: Record<string, unknown>) => Promise<{ rows: LibraryRecord[]; capped: boolean }>;
  chapterDisplayTitle: (rec: Pick<LibraryRecord, "path" | "fields">) => string;
  normalizeRef: (raw: unknown) => string;
};

describe("Quote locator round-trip", () => {
  // Public-domain excerpts from Henry David Thoreau's Walden (1854)
  const waldenBlocks = [
    "Where I Lived, and What I Lived For",
    "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.",
    "I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.",
    "Simplicity, simplicity, simplicity! I say, let your affairs be as two or three, and not a hundred or a thousand; instead of a million count half a dozen, and keep your accounts on your thumb-nail.",
    "Time is but the stream I go a-fishing in. I drink at it; but while I drink I see the sandy bottom and detect how shallow it is. Its thin current slides away, but eternity remains.",
  ];

  it("round-trips a single-paragraph quote back to its exact block and character offsets", () => {
    const phrase = "to front only the essential facts of life";
    const startOffset = waldenBlocks[1].indexOf(phrase);
    const loc = api.createQuoteLocator(waldenBlocks, {
      startBlock: 2,
      startOffset,
      endBlock: 2,
      endOffset: startOffset + phrase.length,
    });
    expect(loc).not.toBeNull();
    expect(loc!.quote).toBe(phrase);
    expect(loc!.block).toBe(2);
    expect(loc!.before).toContain("wished to live deliberately,");
    expect(loc!.after).toContain(", and see if I could not learn");

    const found = api.locateQuote(waldenBlocks, loc!);
    expect(found).not.toBeNull();
    expect(found!.startBlock).toBe(2);
    expect(found!.endBlock).toBe(2);
    expect(found!.startOffset).toBe(startOffset);
    expect(found!.endOffset).toBe(startOffset + phrase.length);
    expect(waldenBlocks[found!.startBlock - 1].slice(found!.startOffset, found!.endOffset)).toBe(phrase);
  });

  it("trims outer whitespace on capture and keeps before/after snug", () => {
    const rawStart = waldenBlocks[4].indexOf(" eternity remains");
    const loc = api.createQuoteLocator(waldenBlocks, {
      startBlock: 5,
      startOffset: rawStart,
      endBlock: 5,
      endOffset: waldenBlocks[4].length,
    });
    expect(loc!.quote).toBe("eternity remains.");
    expect(loc!.before).toContain("thin current slides away, but");
    expect(loc!.after).toBe("");

    const found = api.locateQuote(waldenBlocks, loc!);
    expect(found).toMatchObject({ startBlock: 5, endBlock: 5 });
    expect(waldenBlocks[4].slice(found!.startOffset, found!.endOffset)).toBe("eternity remains.");
  });

  it("disambiguates repeated phrases using before/after context", () => {
    const repeated = [
      "Morning light crosses the water before the wind wakes.",
      "He watched the river from the bank, and the river answered nothing.",
      "Later he returned to the shore where the river turned south toward the meadow.",
      "At dusk the river lay black and still beneath the pines.",
    ];
    // Mark the third occurrence of "the river" (in block 3: "where the river turned south")
    const phrase = "the river";
    const idx = repeated[2].indexOf(phrase);
    const loc = api.createQuoteLocator(repeated, {
      startBlock: 3,
      startOffset: idx,
      endBlock: 3,
      endOffset: idx + phrase.length,
    });
    const found = api.locateQuote(repeated, loc!);
    expect(found).toMatchObject({ startBlock: 3, startOffset: idx, endBlock: 3, endOffset: idx + phrase.length });

    // Even if two paragraphs are inserted above (shifting block 3 -> block 5), context still locates the exact occurrence
    const shifted = ["Preface paragraph.", "Epigraph paragraph.", ...repeated];
    const refound = api.locateQuote(shifted, loc!);
    expect(refound).toMatchObject({ startBlock: 5, startOffset: idx, endBlock: 5, endOffset: idx + phrase.length });
  });

  it("disambiguates identical repeated lines using block proximity", () => {
    const refrain = [
      "First stanza begins with quiet hills.",
      "Walk gently on the earth.",
      "Second stanza speaks of rain and cedar.",
      "Walk gently on the earth.",
      "Third stanza closes in twilight.",
    ];
    const loc = api.createQuoteLocator(refrain, { startBlock: 4, startOffset: 0, endBlock: 4, endOffset: refrain[3].length });
    // Even if before/after were stripped (e.g. a hand-written quote record), block 4 wins over block 2
    const found = api.locateQuote(refrain, { quote: loc!.quote, block: 4 });
    expect(found).toMatchObject({ startBlock: 4, endBlock: 4, startOffset: 0, endOffset: refrain[3].length });
  });

  it("round-trips multi-paragraph (cross-block) quotes", () => {
    const startOffset = waldenBlocks[1].indexOf("discover that I had not lived.");
    const endOffset = waldenBlocks[2].indexOf("marrow of life") + "marrow of life".length;
    const loc = api.createQuoteLocator(waldenBlocks, {
      startBlock: 2,
      startOffset,
      endBlock: 3,
      endOffset,
    });
    expect(loc!.block).toBe(2);
    expect(loc!.quote).toContain("discover that I had not lived.");
    expect(loc!.quote).toContain("marrow of life");

    const found = api.locateQuote(waldenBlocks, loc!);
    expect(found).toMatchObject({ startBlock: 2, startOffset, endBlock: 3, endOffset });
  });

  it("tolerates whitespace normalization and curly-vs-straight punctuation differences", () => {
    const curlyBlocks = [
      "He said, \u201CLive   simply\u2014and watch the morning.\u201D",
    ];
    const found = api.locateQuote(curlyBlocks, {
      quote: '"Live simply-and watch the morning."',
      block: 1,
      before: "He said,",
      after: "",
    });
    expect(found).not.toBeNull();
    expect(curlyBlocks[0].slice(found!.startOffset, found!.endOffset)).toBe("\u201CLive   simply\u2014and watch the morning.\u201D");
  });

  it("returns null cleanly when the quoted text is no longer in the chapter", () => {
    expect(api.locateQuote(waldenBlocks, { quote: "words that never appeared here", block: 2 })).toBeNull();
    expect(api.locateQuote([], { quote: "anything", block: 1 })).toBeNull();
    expect(api.createQuoteLocator(waldenBlocks, { startBlock: 2, startOffset: 5, endBlock: 2, endOffset: 5 })).toBeNull();
  });

  it("splits overlapping quotes into clean non-overlapping per-block highlight slices", () => {
    const blocks = ["I went to the woods because I wished to live deliberately."];
    const q1 = api.createQuoteLocator(blocks, { startBlock: 1, startOffset: 0, endBlock: 1, endOffset: 27 })!;
    const q2 = api.createQuoteLocator(blocks, { startBlock: 1, startOffset: 10, endBlock: 1, endOffset: 44 })!;
    const { byBlock, locatedIds } = api.buildHighlightRanges(blocks, [
      { id: "q1", text: q1.quote, block: q1.block, before: q1.before, after: q1.after },
      { id: "q2", text: q2.quote, block: q2.block, before: q2.before, after: q2.after },
    ]);
    expect(locatedIds.size).toBe(2);
    const slices = byBlock.get(1)!;
    expect(slices).toEqual([
      { start: 0, end: 10, quoteIds: ["q1"] },
      { start: 10, end: 27, quoteIds: ["q1", "q2"] },
      { start: 27, end: 44, quoteIds: ["q2"] },
    ]);
  });
});

describe("Quote body, reading position (`at`), cover extraction, and library organization", () => {
  it("round-trips quote bodies with optional notes, multi-paragraph quotes, and nested markdown", () => {
    const body1 = api.formatQuoteBody("Simplicity, simplicity, simplicity!", "Remember this when planning the quarter.");
    expect(api.parseQuoteBody(body1)).toEqual({
      text: "Simplicity, simplicity, simplicity!",
      note: "Remember this when planning the quarter.",
    });

    const body2 = api.formatQuoteBody("First paragraph.\n\nSecond paragraph.", "");
    expect(api.parseQuoteBody(body2)).toEqual({
      text: "First paragraph.\n\nSecond paragraph.",
      note: "",
    });

    const body3 = api.formatQuoteBody("Main passage.", "My thought\n\n> quoted remark inside note");
    expect(api.parseQuoteBody(body3)).toEqual({
      text: "Main passage.",
      note: "My thought\n\n> quoted remark inside note",
    });

    // Fallback for plain text written without blockquote prefix
    expect(api.parseQuoteBody("Plain text quote")).toEqual({ text: "Plain text quote", note: "" });
  });

  it("round-trips reading position (`book.fields.at`) and accepts legacy formats", () => {
    const at = api.formatReadingAt("Books/Walden/02 Where I Lived.md", 4);
    expect(at).toBe("Books/Walden/02 Where I Lived#p4");
    expect(api.parseReadingAt(at)).toEqual({ chapterRef: "Books/Walden/02 Where I Lived", block: 4 });
    expect(api.parseReadingAt("Books/Walden/02 Where I Lived#7")).toEqual({ chapterRef: "Books/Walden/02 Where I Lived", block: 7 });
    expect(api.parseReadingAt("Books/Walden/02 Where I Lived")).toEqual({ chapterRef: "Books/Walden/02 Where I Lived", block: 1 });
    expect(api.parseReadingAt("")).toBeNull();
  });

  it("extracts cover storage paths from fields.cover or markdown body and builds safe quote paths", () => {
    expect(api.extractCoverPath("![Cover](/api/storage/2026-11-23/cover.png)\n\nBy Thoreau.")).toBe("/api/storage/2026-11-23/cover.png");
    expect(api.extractCoverPath("", { cover: "2026-11-23/cover.jpg" })).toBe("/api/storage/2026-11-23/cover.jpg");
    expect(api.extractCoverPath("![Web](https://example.test/x.png)")).toBe("");

    const path = api.makeQuotePath("Walden: Life in the Woods", "Time is but the stream I go a-fishing in.", "2026/11-23/17-30-05");
    expect(path.startsWith("Quotes/Walden Life in the Woods/")).toBe(true);
    expect(path).not.toMatch(/[:*?"<>|#[\]]/);
  });

  it("organizes books, parts, ordered chapters, summaries per chapter, and quotes from Quotes/ and Books/", () => {
    const recs: LibraryRecord[] = [
      { id: "b1", path: "Books/Walden", updatedAt: "2026-11-23T10:00:00Z", tags: ["book"], fields: { author: "Henry David Thoreau", status: "reading", at: "Books/Walden/02 Where I Lived#p2" }, body: "![Cover](/api/storage/2026-11-23/walden.png)" },
      { id: "b2", path: "Books/Meditations", updatedAt: "2026-11-20T10:00:00Z", tags: ["book"], fields: { author: "Marcus Aurelius", status: "want to read" }, body: "" },
      { id: "p1", path: "Books/Walden/00 Part One - By the Pond", updatedAt: "2026-11-23T09:00:00Z", tags: ["chapter"], fields: { book: "Books/Walden", order: 0 } },
      { id: "c2", path: "Books/Walden/02 Where I Lived", updatedAt: "2026-11-23T09:00:00Z", tags: ["chapter"], fields: { book: "Books/Walden", part: "Books/Walden/00 Part One - By the Pond", order: 2, words: 450 } },
      { id: "c1", path: "Books/Walden/01 Economy", updatedAt: "2026-11-23T09:00:00Z", tags: ["chapter"], fields: { book: "Books/Walden", part: "Books/Walden/00 Part One - By the Pond", order: 1, words: 620 } },
      { id: "s0", path: "Books/Walden/Summaries/Book Summary", updatedAt: "2026-11-23T09:00:00Z", tags: ["summary"], fields: { of: "[[Books/Walden]]", by: "Reader" }, body: "A year of deliberate living by a woodland pond." },
      { id: "s1", path: "Books/Walden/Summaries/01 Economy", updatedAt: "2026-11-23T09:00:00Z", tags: ["summary"], fields: { of: "Books/Walden/01 Economy.md", by: "Reader" }, body: "Shelter, food, and the true cost of what we own." },
      { id: "q1", path: "Quotes/Walden/2026-11-23 deliberately", updatedAt: "2026-11-23T11:00:00Z", tags: ["quote"], fields: { book: "Books/Walden", from: "Books/Walden/02 Where I Lived", block: 2, before: "wished to", after: "to front" }, body: "> live deliberately\n\nCore thesis." },
    ];

    const org = api.organizeLibrary(recs);
    expect(org.books.map((b) => b.title)).toEqual(["Walden", "Meditations"]);
    const walden = org.books[0];
    expect(walden.coverSrc).toBe("/api/storage/2026-11-23/walden.png");
    expect(walden.chapters.map((c) => c.id)).toEqual(["p1", "c1", "c2"]);
    expect(walden.groups).toHaveLength(1);
    expect(walden.groups[0].part?.id).toBe("p1");
    expect(walden.groups[0].chapters.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(walden.bookSummaries.map((s) => s.id)).toEqual(["s0"]);
    expect(walden.summariesByChapter.get("c1")?.map((s) => s.id)).toEqual(["s1"]);
    expect(walden.quotes).toHaveLength(1);
    expect(walden.quotes[0].text).toBe("live deliberately");
    expect(walden.quotes[0].note).toBe("Core thesis.");
    expect(api.markdownPreview("# Heading\n\nShelter, **food**, and [[Books/Walden|cost]].")).toBe("Shelter, food, and cost.");
  });
});

describe("applets/library record validation and TypeScript check", () => {
  it("passes checkAppletRecord cleanly with zero errors, warnings, or kit conformance findings", async () => {
    const meta = JSON.parse(readFileSync(join(process.cwd(), "applets", "library.json"), "utf8")) as Omit<AppletRecordInput, "body">;
    const body = readFileSync(join(process.cwd(), "applets", "library.tsx"), "utf8");
    const res = await checkAppletRecord({ ...meta, body });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.conformance).toEqual([]);
  });

  it("applets/library.tsx type-checks cleanly against applets/parachute.d.ts", () => {
    const root = process.cwd();
    const program = ts.createProgram(
      [join(root, "applets", "parachute.d.ts"), join(root, "applets", "library.tsx")],
      {
        strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
        types: [], typeRoots: [join(root, "node_modules", "@types")],
      },
    );
    const said = ts.getPreEmitDiagnostics(program).map((d) => `${d.file?.fileName.replace(root, "") ?? ""}:${d.start ?? 0}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    expect(said).toEqual([]);
  }, 30_000);
});

// The reading view's DOM side (collectReadableBlocks, locatorFromSelection, applyMarks) on a real DOM (jsdom).
const domStart = src.indexOf("// ── DOM block collection, selection capture, and mark rendering ──");
const domEnd = src.indexOf("// ── UI subcomponents ──");
if (domStart < 0 || domEnd <= domStart) throw new Error("could not locate the DOM block in applets/library.tsx");
const dom = new Function(
  `${transform(block + src.slice(domStart, domEnd), { transforms: ["typescript"] }).code}; return { collectReadableBlocks, applyMarks, clearMarks };`,
)() as {
  collectReadableBlocks: (root: HTMLElement) => { block: number; text: string }[];
  applyMarks: (root: HTMLElement, quotes: readonly unknown[], focus: string | null) => { focusedMark: HTMLElement | null; blocksCount: number };
  clearMarks: (root: HTMLElement) => void;
};

describe("applets/library reading view on a DOM", () => {
  it("counts a list item's own words as a block when it holds a list, and table cells as blocks", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="pa-note"><p>Rules for the morning.</p><ul><li>Rise early<ul><li>before the sun</li></ul></li></ul>`
      + `<table><tr><td>Bread</td><td>one loaf</td></tr></table></div>`;
    expect(dom.collectReadableBlocks(root).map((b) => b.text)).toEqual(["Rules for the morning.", "Rise early", "before the sun", "Bread", "one loaf"]);
  });

  it("marks a saved quote in the outer list item's own words, and clears it again", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="pa-note"><p>Rules for the morning.</p><ul><li>Rise early and walk<ul><li>before the sun</li></ul></li></ul></div>`;
    const quote = { record: { id: "q1" }, text: "early and walk", block: 2, before: "Rise ", after: "", note: "" };
    const { focusedMark } = dom.applyMarks(root, [quote], "q1");
    expect(focusedMark?.textContent).toBe("early and walk");
    dom.clearMarks(root);
    expect(root.querySelector("mark")).toBeNull();
    expect(root.querySelector("li")?.firstChild?.nodeValue).toBe("Rise early and walk");
  });
});
