// Unit, component, pack, conformance and typecheck tests for the Writing applet (applets/writing.json + writing.tsx).
// Loads applets/writing.tsx through the app's own sucrase transpiler (`transpile`), matching the sealed frame's loader.
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import * as JSXRuntime from "react/jsx-runtime";
import ts from "typescript";
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAppletRecord, type AppletRecordInput } from "./check";
import { transpile } from "./code";
import { applyPack, checkPack, packFromPage, type PackTarget } from "../kit/packs";
import { STARTERS } from "./modules/packs";
import * as KitParts from "../kit/parts";
import * as KitScreen from "../kit/screen";
import * as KitData from "../kit/parts-data";
import { Drawer } from "../kit/drawer";
import { when } from "../kit/when";

// a loaded machine renders slowly: give findBy/waitFor longer than the 1 s default
configure({ asyncUtilTimeout: 5000 });

// ── Mock "parachute" module and execute sucrase-transpiled applets/writing.tsx ──

const savedStore = new Map<string, unknown>();
const toastCalls: { text: string; opts?: { error?: boolean } }[] = [];
const followCalls: { to: string; opts?: unknown }[] = [];
const queryRecords = vi.fn();
const getRecord = vi.fn();
const createRecord = vi.fn();
const updateRecord = vi.fn();
let openCb: ((o: { note: { id: string; path: string }; screen: string }) => void) | null = null;
let backStack: (() => void)[] = [];
const ready = vi.fn(async () => ({
  applet: { id: "writing", name: "Writing" },
  access: [
    { path: "Writing/Pieces/", verbs: ["read", "create", "update"] },
    { path: "References/", verbs: ["read", "create", "update"] },
  ],
  services: [],
}));

const mockState = {
  savedStore,
  toastCalls,
  followCalls,
  queryRecords,
  getRecord,
  createRecord,
  updateRecord,
  ready,
  reset() {
    savedStore.clear();
    toastCalls.length = 0;
    followCalls.length = 0;
    backStack = [];
    openCb = null;
    queryRecords.mockReset();
    getRecord.mockReset();
    createRecord.mockReset();
    updateRecord.mockReset();
    ready.mockClear();
  },
};

const parachuteKit = {
  ...KitParts,
  ...KitScreen,
  ...KitData,
  Drawer,
  when,
  Note: ({ body }: { body: string }) => <div data-testid="note-body">{body}</div>,
  Link: ({ to, children }: { to: string; children?: React.ReactNode }) => (
    <span data-testid="kit-link" data-to={to}>{children ?? to}</span>
  ),
  link: {
    to: vi.fn(async (rec: string | { id: string }) => {
      const id = typeof rec === "string" ? rec : rec.id;
      return `https://hub.example/vault/home/view/${id}`;
    }),
    follow: vi.fn(async (to: string, opts?: unknown) => {
      followCalls.push({ to, opts });
      return true;
    }),
    open: vi.fn(async () => true),
    parse: vi.fn(() => null),
    find: vi.fn(() => []),
  },
  toast: (text: string, opts?: { error?: boolean }) => {
    toastCalls.push({ text, opts });
  },
  saved: {
    get: (k: string) => savedStore.get(k),
    set: (k: string, v: unknown) => {
      if (v === null || v === undefined) savedStore.delete(k);
      else savedStore.set(k, v);
    },
    all: () => Object.fromEntries(savedStore.entries()),
    flush: async () => null,
  },
  ready,
  onOpen: (cb: (o: { note: { id: string; path: string }; screen: string }) => void) => {
    openCb = cb;
    return () => { openCb = null; };
  },
  onBack: (cb: () => void) => {
    backStack.push(cb);
    return () => { backStack = backStack.filter((x) => x !== cb); };
  },
  onShown: () => () => {},
  vault: {
    queryRecords: (...a: unknown[]) => queryRecords(...a),
    getRecord: (...a: unknown[]) => getRecord(...a),
    createRecord: (...a: unknown[]) => createRecord(...a),
    updateRecord: (...a: unknown[]) => updateRecord(...a),
  },
};

// Expose parachute.saved on globalThis so KitParts.useSaved reads/writes the same store as the frame
(globalThis as unknown as { parachute: typeof parachuteKit }).parachute = parachuteKit;

type VaultRec = {
  id: string;
  path: string;
  createdAt?: string | null;
  updatedAt: string | null;
  tags?: string[];
  types?: string[];
  fields?: Record<string, unknown>;
  body?: string;
  links?: { sourceId: string; targetId: string; sourceNote?: { id: string; path: string | null }; targetNote?: { id: string; path: string | null } }[];
};

const writingSrc = readFileSync(join(process.cwd(), "applets", "writing.tsx"), "utf8");
const compiled = await transpile(writingSrc, "tsx");
if (!compiled.ok) throw new Error(`writing.tsx failed to compile: ${compiled.error}`);
const writingExports: Record<string, unknown> = {};
const req = (spec: string) => {
  if (spec === "react") return React;
  if (spec === "react/jsx-runtime") return JSXRuntime;
  if (spec === "parachute") return parachuteKit;
  throw new Error(`unexpected require(${spec})`);
};
new Function("require", "exports", compiled.js)(req, writingExports);

const Writing = writingExports.default as React.ComponentType;
const besideReferences = writingExports.besideReferences as (
  refs: readonly VaultRec[],
  piece: Pick<VaultRec, "id" | "path" | "fields">,
  opts?: { includeLetGo?: boolean; piecesFolder?: string },
) => VaultRec[];
const buildAskRecord = writingExports.buildAskRecord as (
  refsFolder: string,
  piece: Pick<VaultRec, "id" | "path" | "fields">,
  line: string,
  at?: Date,
  piecesFolder?: string,
) => { path: string; body: string; types?: string[]; fields: Record<string, unknown> };
const formatQuoteMarkdown = writingExports.formatQuoteMarkdown as (ref: Pick<VaultRec, "id" | "path" | "fields" | "body">) => string;
const groupPiecesByStage = writingExports.groupPiecesByStage as (pieces: readonly VaultRec[]) => Record<"draft" | "seed" | "ready" | "published", VaultRec[]>;
const insertAtSelection = writingExports.insertAtSelection as (
  body: string,
  insertion: string,
  start?: number,
  end?: number,
) => { text: string; cursor: number };
const matchesPiece = writingExports.matchesPiece as (ref: VaultRec, piece: Pick<VaultRec, "id" | "path" | "fields">, folder?: string) => boolean;
const mergeUsedIn = writingExports.mergeUsedIn as (existing: unknown, pieceId: string) => string[] | null;
const queryBeside = writingExports.queryBeside as (
  vaultApi: { queryRecords(q?: Record<string, unknown>): Promise<VaultRec[]> },
  refsFolder: string,
  piece: Pick<VaultRec, "id" | "path" | "fields">,
) => Promise<{ active: VaultRec[]; letGo: VaultRec[]; all: VaultRec[] }>;
const refQuote = writingExports.refQuote as (ref: Pick<VaultRec, "fields" | "body">) => string;
const refSource = writingExports.refSource as (ref: Pick<VaultRec, "path" | "fields">) => { label: string; author: string; url: string };
const refWhy = writingExports.refWhy as (ref: Pick<VaultRec, "fields">) => string;
const stageOf = writingExports.stageOf as (rec: Pick<VaultRec, "fields">) => "draft" | "seed" | "ready" | "published";

// ── Made-up fixtures ──

const PIECE_DRAFT: VaultRec = {
  id: "01PIECE_DRAFT_0001",
  path: "Writing/Pieces/Tools that stay quiet",
  updatedAt: "2026-11-23T10:00:00Z",
  tags: ["piece"],
  fields: { stage: "draft" },
  body: "Most software asks for attention before you have a sentence down.",
};

const PIECE_SEED: VaultRec = {
  id: "01PIECE_SEED_0002",
  path: "Writing/Pieces/Notes on small ponds",
  updatedAt: "2026-11-21T08:00:00Z",
  tags: ["piece"],
  fields: { stage: "seed" },
  body: "",
};

const PIECE_PUBLISHED: VaultRec = {
  id: "01PIECE_PUB_0003",
  path: "Writing/Pieces/Walking to the creek",
  updatedAt: "2026-11-10T15:00:00Z",
  tags: ["piece"],
  fields: {
    stage: "published",
    slug: "walking-to-the-creek",
    url: "https://unforced.example/walking-to-the-creek",
    published_at: "2026-11-10",
  },
  body: "Published essay body.",
};

const REF_READY: VaultRec = {
  id: "01REF_READY_0001",
  path: "References/Alexander on quiet rooms",
  createdAt: "2026-11-23T09:30:00Z",
  updatedAt: "2026-11-23T09:30:00Z",
  tags: ["reference"],
  fields: {
    piece: "Tools that stay quiet",
    state: "ready",
    quote: "A room that lets you hear yourself think has no more than two things asking for your eyes.",
    source: "Notes on Calm Rooms",
    author: "M. Alvarez",
    source_url: "https://example.org/calm-rooms",
    why: "Directly supports your opening point about interfaces staying out of the way.",
  },
  body: "Additional context from chapter four.",
};

const REF_OLDER: VaultRec = {
  id: "01REF_KEPT_0002",
  path: "References/Notebook margin quote",
  createdAt: "2026-11-22T14:00:00Z",
  updatedAt: "2026-11-22T14:00:00Z",
  tags: ["reference"],
  fields: {
    piece: "Writing/Pieces/Tools that stay quiet",
    state: "kept",
    quote: "Keep the desk clear except for the page and one open book.",
    source: "Fieldcraft Notebook",
    why: "Pairs with the desk metaphor.",
  },
};

const REF_LET_GO: VaultRec = {
  id: "01REF_LETGO_0003",
  path: "References/Off-topic sidebar",
  createdAt: "2026-11-23T11:00:00Z",
  updatedAt: "2026-11-23T11:00:00Z",
  tags: ["reference"],
  fields: {
    piece: PIECE_DRAFT.id,
    state: "let go",
    quote: "Something already set aside.",
    source: "Other essay",
  },
};

const REF_OTHER_PIECE: VaultRec = {
  id: "01REF_OTHER_0004",
  path: "References/Pond hydrology",
  createdAt: "2026-11-23T12:00:00Z",
  updatedAt: "2026-11-23T12:00:00Z",
  tags: ["reference"],
  fields: {
    piece: PIECE_SEED.id,
    state: "ready",
    quote: "Shallow ponds warm early in spring.",
    source: "Meadow Survey",
  },
};

// ── 1. Manifest, conformance --strict, TypeScript types, and Pack ──

describe("Writing applet record & pack checks", () => {
  it("passes checkAppletRecord with 0 errors, 0 warnings, and 0 kit conformance findings", async () => {
    const root = process.cwd();
    const meta = JSON.parse(readFileSync(join(root, "applets", "writing.json"), "utf8")) as Omit<AppletRecordInput, "body">;
    const body = readFileSync(join(root, "applets", "writing.tsx"), "utf8");
    const res = await checkAppletRecord({ ...meta, body });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.conformance).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("type-checks cleanly against applets/parachute.d.ts", () => {
    const root = process.cwd();
    const program = ts.createProgram([join(root, "applets", "parachute.d.ts"), join(root, "applets", "writing.tsx")], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      types: [],
      typeRoots: [join(root, "node_modules", "@types")],
    });
    const diags = ts
      .getPreEmitDiagnostics(program)
      .map((d) => `${d.file?.fileName.replace(root, "") ?? ""}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    expect(diags).toEqual([]);
  }, 30_000);

  it("docs/WRITING.md pack is valid and composes cleanly with all starter packs in any order", async () => {
    const doc = readFileSync(join(process.cwd(), "docs", "WRITING.md"), "utf8");
    const writingPack = checkPack(packFromPage(doc));
    expect(writingPack.id).toBe("writing");
    expect(Object.keys(writingPack.types.reference.fields)).toEqual(expect.arrayContaining(["piece", "used_in", "state"]));
    expect(Object.keys(writingPack.types.piece.fields)).toEqual(expect.arrayContaining(["stage", "slug", "url", "published_at"]));

    const all = [...STARTERS, writingPack];
    for (const order of [all, [...all].reverse()]) {
      const types = new Map<string, { name: string; kind: "type"; count: number; fields: Record<string, { type?: string }> }>();
      const target: PackTarget = {
        types: async () => [...types.values()],
        defineType: async (name, def) => {
          const t = types.get(name) ?? { name, kind: "type" as const, count: 0, fields: {} };
          Object.assign(t.fields, def.fields);
          types.set(name, t);
          return "ok";
        },
        create: async (r) => ({ id: r.path, updatedAt: null, existed: false }),
        receipt: async () => null,
        writeReceipt: async () => {},
      };
      for (const p of order) {
        const res = await applyPack(p, target);
        expect(res.notes, `collision applying ${p.id}`).toEqual([]);
      }
      expect(Object.keys(types.get("reference")!.fields)).toEqual(expect.arrayContaining(["piece", "used_in", "state"]));
    }
  });
});

// ── 2. Pure logic: Beside-it query, insert-as-quote, stages, Ask Uni ──

describe("Beside-it query & matching", () => {
  it("matches references targeting a piece by id, path, wikilink, hub URL, short ref, array, or links; not by a shared title", () => {
    const variants: VaultRec[] = [
      { ...REF_READY, id: "v1", fields: { piece: PIECE_DRAFT.id } },
      { ...REF_READY, id: "v2", fields: { piece: "Writing/Pieces/Tools that stay quiet" } },
      { ...REF_READY, id: "v3", fields: { piece: "[[Tools that stay quiet]]" } },
      { ...REF_READY, id: "v4", fields: { piece: `https://hub.example/vault/home/view/${PIECE_DRAFT.id}` } },
      { ...REF_READY, id: "v5", fields: { piece: `home:${PIECE_DRAFT.id}` } },
      { ...REF_READY, id: "v6", fields: { piece: ["other", PIECE_DRAFT.id] } },
      { ...REF_READY, id: "v7", fields: {}, links: [{ sourceId: "v7", targetId: PIECE_DRAFT.id }] },
    ];
    for (const r of variants) expect(matchesPiece(r, PIECE_DRAFT), r.id).toBe(true);
    expect(matchesPiece(REF_OTHER_PIECE, PIECE_DRAFT)).toBe(false);
    // two pieces may share a title; a reference "piece: Intro" is the piece at Writing/Pieces/Intro only
    const intro = { id: "01INTRO", path: "Writing/Pieces/2025/Intro", fields: { title: "Intro" } };
    expect(matchesPiece({ ...REF_READY, fields: { piece: "Intro" } }, intro, "Writing/Pieces/")).toBe(false);
    // as Uni writes the research it prepares: `piece` names the piece, `for` the person it's for (never the piece)
    expect(matchesPiece({ ...REF_READY, fields: { for: "aaron", piece: "Tools that stay quiet" } }, PIECE_DRAFT)).toBe(true);
    expect(matchesPiece({ ...REF_READY, fields: { for: PIECE_DRAFT.id } }, PIECE_DRAFT)).toBe(false);
  });

  it("filters to the piece, excludes let go by default, deduplicates, and sorts newest first", () => {
    const out = besideReferences([REF_OLDER, REF_LET_GO, REF_OTHER_PIECE, REF_READY, REF_READY], PIECE_DRAFT);
    expect(out.map((r) => r.id)).toEqual([REF_READY.id, REF_OLDER.id]);
    const withLetGo = besideReferences([REF_OLDER, REF_LET_GO, REF_READY], PIECE_DRAFT, { includeLetGo: true });
    expect(withLetGo.map((r) => r.id)).toEqual([REF_LET_GO.id, REF_READY.id, REF_OLDER.id]);
  });

  it("queryBeside combines direct fields.piece query and folder query, and falls back gracefully on 400", async () => {
    const calls: Record<string, unknown>[] = [];
    const olderHub = {
      async queryRecords(q: Record<string, unknown> = {}) {
        calls.push(q);
        if (q.orderBy === "created_at") throw Object.assign(new Error("400"), { status: 400 });
        if ((q.fields as { piece?: unknown } | undefined)?.piece === "Tools that stay quiet") return [REF_READY];
        return [REF_OLDER, REF_LET_GO, REF_OTHER_PIECE];
      },
    };
    const res = await queryBeside(olderHub, "References/", PIECE_DRAFT);
    expect(calls.length).toBe(3);
    expect(res.active.map((r) => r.id)).toEqual([REF_READY.id, REF_OLDER.id]);
    expect(res.letGo.map((r) => r.id)).toEqual([REF_LET_GO.id]);
  });
});

describe("insert-as-quote formatting & cursor splicing", () => {
  it("formats a markdown blockquote with author and markdown link to its source URL", () => {
    const md = formatQuoteMarkdown(REF_READY);
    expect(md).toBe(
      "> A room that lets you hear yourself think has no more than two things asking for your eyes.\n" +
        "> — M. Alvarez, [Notes on Calm Rooms](https://example.org/calm-rooms)",
    );
  });

  it("handles multi-line quotes, and with no web address cites the source in plain words", () => {
    const multi: VaultRec = {
      ...REF_OLDER,
      fields: { ...REF_OLDER.fields, quote: "First line.\n\nSecond line." },
    };
    // never the vault's own address of the reference: a published piece is public, the vault isn't
    expect(formatQuoteMarkdown(multi)).toBe("> First line.\n>\n> Second line.\n> — Fieldcraft Notebook");
  });

  it("extracts quote from body blockquote when fields.quote is absent, and reads source/why fields", () => {
    const fromBody: VaultRec = {
      id: "01BODY",
      path: "References/Clip",
      updatedAt: "2026-11-23T08:00:00Z",
      fields: { source: "[[Books/Pattern]]", why_it_fits: "Sets up section two." },
      body: "> Walk the path before paving it.\n\nExtra note.",
    };
    expect(refQuote(fromBody)).toBe("Walk the path before paving it.");
    expect(refSource(fromBody)).toEqual({ label: "Pattern", author: "", url: "[[Books/Pattern]]" });
    expect(refWhy(fromBody)).toBe("Sets up section two.");
    // unforced.org won't publish a piece with [[links]]: none goes in, from the source or its words
    expect(formatQuoteMarkdown(fromBody)).toBe("> Walk the path before paving it.\n> — Pattern");
    const wordy = { ...fromBody, fields: { source: "Notes from [[Fieldcraft]]", author: "M. [[Alvarez]]" } };
    expect(formatQuoteMarkdown(wordy)).not.toMatch(/\[\[|\]\]/);
    // with no source named, no citation: the reference's own note name stays in the vault
    const bare = { id: "01BARE", path: "References/Quote 3 for Quiet desks", fields: { quote: "Only the words." } };
    expect(formatQuoteMarkdown(bare)).toBe("> Only the words.");
    // a web address with ( ) stays one link
    const paren = { ...bare, fields: { quote: "Q.", source: "Tools", source_url: "https://en.wikipedia.org/wiki/Tools_(book)" } };
    expect(formatQuoteMarkdown(paren)).toBe("> Q.\n> — [Tools](https://en.wikipedia.org/wiki/Tools_%28book%29)");
    // nor a vault's address given as the source: cited in words, or not at all
    const hub = { ...bare, fields: { quote: "Q.", source: "Fieldcraft", source_url: "https://hub.example/vault/home/view/01J8ABCDEFGHJKMNPQRSTVWXYZ" } };
    expect(formatQuoteMarkdown(hub)).toBe("> Q.\n> — Fieldcraft");
    expect(formatQuoteMarkdown({ ...bare, fields: { quote: "Q.", source: "https://hub.example/vault/home/n/01J8ABCDEFGHJKMN" } })).toBe("> Q.");
    // nor any other vault or private address, in the source, its address, or a link in the quote
    for (const fields of [
      { source: "uni:01JABCDEFGHJKMNPQ" },
      { source: "Fieldcraft", source_url: "uni:01JABCDEFGHJKMNPQ" },
      { source: "vault://uni/Notes/X" },
      { source: "Fieldcraft", source_url: "http://uni.tail1234.ts.net:1940/api/notes/x" },
      { source: "Fieldcraft", source_url: "http://192.168.1.5/notes" },
      { source: "Fieldcraft", source_url: "https://hub.example/v/uni/n/legacy-id-abc" },
      { source: `${"a".repeat(45)}:01JABCDEFGHJKMNPQRSTVWXYZ0` },
    ]) expect(formatQuoteMarkdown({ ...bare, fields: { quote: "Q.", ...fields } }), JSON.stringify(fields)).toMatch(/^> Q\.(\n> — Fieldcraft)?$/);
    expect(formatQuoteMarkdown({ ...bare, fields: { quote: "See [the note](https://hub.example/vault/uni/n/01J8ABCDEFGHJKMN) and <http://localhost:1939/x>." } }))
      .toBe("> See the note and .");
    // a [[link]] in the author or source gives its words, an alias first; no folder path
    expect(formatQuoteMarkdown({ ...bare, fields: { quote: "Q.", author: "[[People/Jane Doe]]", source: "[[Books/X|The Book]]" } })).toBe("> Q.\n> — Jane Doe, The Book");
    expect(formatQuoteMarkdown({ ...bare, fields: { quote: "Q.", source: "Fieldcraft", source_url: "https://example.org/a" } })).toBe("> Q.\n> — [Fieldcraft](https://example.org/a)");
    // and a citation's own forms stay cited
    for (const source of ["doi:10.1000/182", "ISBN:9780140449136", "Thoreau:Walden", "Note: chapter 3", "Interview:20261122"])
      expect(formatQuoteMarkdown({ ...bare, fields: { quote: "Q.", source } }), source).toBe(`> Q.\n> — ${source}`);
    expect(formatQuoteMarkdown({ ...bare, fields: { quote: "Q.", source: "Site", source_url: "https://example.com/view/abcdefgh12" } }))
      .toBe("> Q.\n> — [Site](https://example.com/view/abcdefgh12)");
    // nor from the quote's own words
    const linked = { ...bare, fields: { quote: "As [[Notes/Ivan Illich|Illich]] put it, [[Tools for Conviviality]] matter." } };
    expect(formatQuoteMarkdown(linked)).toBe("> As Illich put it, Tools for Conviviality matter.");
  });

  it("splices a quote cleanly into empty, middle, or end of a piece with proper paragraph spacing", () => {
    const q = "> Quiet tools.\n> — [Essay](https://example.org)";
    expect(insertAtSelection("", q)).toEqual({ text: q, cursor: q.length });

    const mid = insertAtSelection("First paragraph.\n\nSecond paragraph.", q, 16, 16);
    expect(mid.text).toBe(`First paragraph.\n\n${q}\n\nSecond paragraph.`);
    expect(mid.cursor).toBe("First paragraph.\n\n".length + q.length);

    const end = insertAtSelection("Opening line.", q);
    expect(end.text).toBe(`Opening line.\n\n${q}`);
  });
});

describe("pieces grouping, Ask Uni payload, and used_in merge", () => {
  it("groups pieces by stage and sorts each stage last touched first", () => {
    const olderDraft: VaultRec = { ...PIECE_DRAFT, id: "01OLD", path: "Writing/Pieces/Older draft", updatedAt: "2026-11-20T09:00:00Z" };
    const grouped = groupPiecesByStage([olderDraft, PIECE_PUBLISHED, PIECE_SEED, PIECE_DRAFT]);
    expect(grouped.draft.map((p) => p.id)).toEqual([PIECE_DRAFT.id, olderDraft.id]);
    expect(grouped.seed.map((p) => p.id)).toEqual([PIECE_SEED.id]);
    expect(grouped.published.map((p) => p.id)).toEqual([PIECE_PUBLISHED.id]);
    expect(stageOf({ fields: {} })).toBe("seed");
  });

  it("buildAskRecord makes a record with state: asked and piece set to the piece's name, and names no type", () => {
    const payload = buildAskRecord("References/", PIECE_DRAFT, "Find the quote about tools staying out of sight", new Date("2026-11-23T12:34:56Z"));
    // the app gives it `reference` as the vault has it (a type, or a plain tag a vault would refuse as a type)
    expect(payload.types).toBeUndefined();
    expect(payload.fields).toEqual({ piece: "Tools that stay quiet", state: "asked" });
    expect(buildAskRecord("References/", { ...PIECE_DRAFT, path: "Essays/Drafts/On margins" }, "x", new Date(), "Essays/").fields.piece).toBe("Drafts/On margins");
    expect(payload.body).toBe("Find the quote about tools staying out of sight");
    // one flat name in References/, not folders by date
    expect(payload.path).toMatch(/^References\/Ask [^/]+$/);
  });

  it("mergeUsedIn appends a piece once without duplicating", () => {
    expect(mergeUsedIn(undefined, "p1")).toEqual(["p1"]);
    expect(mergeUsedIn(["p1"], "p2")).toEqual(["p1", "p2"]);
    expect(mergeUsedIn(["p1", "p2"], "p1")).toBeNull();
  });
});

// ── 3. Interactive component flows & zero parent re-renders per keystroke ──

// these wait on the editor's 850 ms save; a loaded machine stretches that
describe("Writing applet UI flows", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockState.reset();
    // Wide screen by default
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((q: string) => ({
        matches: q.includes("900px"),
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // versions only ever go up, across tests too: the applet remembers the versions it saved, as a hub's are unique
  let tick = 0;
  function setupMockVault() {
    // copies: the mock vault changes its records, and the fixtures stay as written for the next test
    const pieces = [PIECE_DRAFT, PIECE_SEED, PIECE_PUBLISHED].map((r) => structuredClone(r));
    const refs = [REF_READY, REF_OLDER, REF_LET_GO, REF_OTHER_PIECE].map((r) => structuredClone(r));
    mockState.queryRecords.mockImplementation(async (q: Record<string, unknown> = {}) => {
      if (q.pathPrefix === "Writing/Pieces/") return structuredClone(pieces);
      if (q.pathPrefix === "References/") return structuredClone(refs);
      return [];
    });
    mockState.getRecord.mockImplementation(async (id: string) => {
      const found = [...pieces, ...refs].find((r) => r.id === id);
      return found ? structuredClone(found) : null; // a read is a copy, as over the wire
    });

    mockState.updateRecord.mockImplementation(async (id: string, change: { if_updated_at?: string; body?: string; fields?: Record<string, unknown> }) => {
      const target = [...pieces, ...refs].find((r) => r.id === id)!;
      // as a hub does: a change to a version it no longer has is refused
      if (change.if_updated_at !== target.updatedAt) throw Object.assign(new Error("changed since"), { status: 409 });
      if (change.body !== undefined) target.body = change.body;
      if (change.fields) target.fields = { ...(target.fields ?? {}), ...change.fields };
      target.updatedAt = `2026-11-24T00:00:${String(++tick).padStart(2, "0")}Z`; // always newer, always distinct
      return structuredClone(target);
    });
    mockState.createRecord.mockImplementation(async (rec: { path: string; body: string; fields?: Record<string, unknown>; types?: string[] }) => {
      // as a hub does: a name already taken is refused
      if ([...pieces, ...refs].some((r) => r.path === rec.path)) throw Object.assign(new Error("conflict: exists"), { status: 409 });
      const created: VaultRec = {
        id: `01NEW_${refs.length + 1}`,
        path: rec.path,
        body: rec.body,
        fields: rec.fields ?? {},
        types: rec.types,
        createdAt: "2026-11-23T15:00:00Z",
        updatedAt: "2026-11-23T15:00:00Z",
      };
      if (rec.path.startsWith("References/")) refs.unshift(created);
      else pieces.unshift(created);
      return created;
    });
    return { pieces, refs };
  }

  it("opens a piece, inserts a reference quote, asks Uni without modifying piece body, and keeps/lets go on Reference page", async () => {
    const { refs } = setupMockVault();
    render(<Writing />);

    // Pieces grouped by stage
    await screen.findByText("Tools that stay quiet");
    expect(screen.getByText("Walking to the creek")).toBeTruthy();

    // Open draft piece
    fireEvent.click(screen.getByRole("button", { name: /Tools that stay quiet/ }));
    const editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;
    expect(editor.value).toBe(PIECE_DRAFT.body);

    // Beside-it shows references for this piece (newest first), excluding let go and other pieces
    await screen.findByText(/A room that lets you hear yourself think/);
    expect(screen.getByText(/Keep the desk clear/)).toBeTruthy();
    expect(screen.queryByText(/Shallow ponds warm early/)).toBeNull();
    expect(screen.queryByText(/Something already set aside/)).toBeNull();

    // Insert as quote
    const insertButtons = screen.getAllByRole("button", { name: "Insert quote" });
    fireEvent.click(insertButtons[0]);
    await waitFor(() => {
      expect(editor.value).toContain("> A room that lets you hear yourself think");
      expect(editor.value).toContain("> — M. Alvarez, [Notes on Calm Rooms](https://example.org/calm-rooms)");
    });

    // Open source uses kit link.follow
    fireEvent.click(screen.getByRole("button", { name: "Open source" }));
    expect(mockState.followCalls.some((c) => c.to === "https://example.org/calm-rooms")).toBe(true);

    // Ask Uni creates a reference with state: asked and piece: the piece's name, NEVER modifying piece body
    const bodyBeforeAsk = editor.value;
    const askBox = screen.getByLabelText("Ask Uni");
    fireEvent.change(askBox, { target: { value: "Find the passage about quiet tools in workshops" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => {
      const asked = refs.find((r) => r.fields?.state === "asked");
      expect(asked).toBeTruthy();
      expect(asked!.fields?.piece).toBe("Tools that stay quiet");
      expect(asked!.types).toBeUndefined();
      expect(asked!.body).toBe("Find the passage about quiet tools in workshops");
    });
    expect(editor.value).toBe(bodyBeforeAsk);

    // the same ask again within the minute is a second record, not "Could not ask Uni"
    fireEvent.change(askBox, { target: { value: "Find the passage about quiet tools in workshops" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(refs.filter((r) => r.fields?.state === "asked").map((r) => r.path.endsWith(" (2)"))).toEqual([true, false]));
    expect(mockState.toastCalls.some((t) => t.opts?.error)).toBe(false);

    // Open Reference page and Keep it
    const detailsButtons = screen.getAllByRole("button", { name: "Details" });
    // the first two are the new asks; the third is REF_READY
    fireEvent.click(detailsButtons[2]);
    await screen.findByText("Why it fits");
    expect(screen.getByText(/Directly supports your opening point/)).toBeTruthy();
    // Uni sharpened the reference after the list was read
    const hubRef = refs.find((r) => r.id === REF_READY.id)!;
    hubRef.fields = { ...hubRef.fields, why: "Uni sharpened this." };
    hubRef.updatedAt = "2026-11-24T09:00:00Z";
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    // kept in the vault, Uni's change kept too
    await waitFor(() => expect(refs.find((r) => r.id === REF_READY.id)!.fields?.state).toBe("kept"));
    expect(hubRef.fields?.why).toBe("Uni sharpened this.");
    await screen.findByRole("button", { name: "Kept" });
    expect(mockState.toastCalls.some((t) => t.opts?.error)).toBe(false);
  });

  it("shows slug, url, and published_at read-only on a published piece", async () => {
    setupMockVault();
    render(<Writing />);
    await screen.findByText("Walking to the creek");
    fireEvent.click(screen.getByRole("button", { name: /Walking to the creek/ }));

    await screen.findByLabelText("Piece");
    const details = screen.getByLabelText("Piece details");
    expect(details.textContent).toContain("walking-to-the-creek");
    expect(details.textContent).toContain("https://unforced.example/walking-to-the-creek");
    // No editable inputs/selects inside Piece details for a published piece
    expect(details.querySelectorAll("input, select, textarea")).toHaveLength(0);
  });

  it("Insert as quote on the Reference page puts the quote into the piece, where the caret was", async () => {
    setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    let editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;
    await screen.findByText(/A room that lets you hear yourself think/);

    // caret after "Most software", then the box loses focus to the reference's Details
    const firstPara = PIECE_DRAFT.body!.indexOf(" asks");
    editor.focus();
    editor.setSelectionRange(firstPara, firstPara);
    fireEvent.blur(editor);
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    await screen.findByText("Why it fits");
    expect(screen.queryByLabelText("Piece")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Insert as quote" }));
    editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain("> A room that lets you hear yourself think"));
    const at = editor.value.indexOf("> A room");
    expect(editor.value.slice(0, at)).toBe("Most software\n\n");
    expect(editor.value.endsWith("\n\n asks for attention before you have a sentence down.")).toBe(true);
  });

  it("a save that lands after its editor is gone is this applet's own: the next save builds on it", async () => {
    const { pieces } = setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    const editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;
    await screen.findByText(/A room that lets you hear yourself think/);

    // the save Details starts is slow to land
    let land!: () => void;
    const slow = new Promise<void>((r) => { land = r; });
    const plain = mockState.updateRecord.getMockImplementation()!;
    mockState.updateRecord.mockImplementationOnce(async (id: string, change: Record<string, unknown>) => {
      await slow;
      return plain(id, change);
    });
    fireEvent.change(editor, { target: { value: "First words." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Insert as quote" }));
    await waitFor(() => expect((screen.getByLabelText("Piece") as HTMLTextAreaElement).value).toContain("> A room"));
    await act(async () => { land(); await slow; });

    // the quote reaches the hub on the next save, with no conflict
    const hubPiece = pieces.find((p) => p.id === PIECE_DRAFT.id)!;
    await waitFor(() => expect(hubPiece.body).toContain("> A room that lets you hear yourself think"), { timeout: 8000 });
    expect(hubPiece.body!.startsWith("First words.")).toBe(true);
    expect(screen.queryByText(/Changed elsewhere/)).toBeNull();
  });

  it("a save the hub took but answered slowly, then the editor made again: its next save builds on it, no false conflict", async () => {
    const { pieces } = setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    const editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;
    await screen.findByText(/A room that lets you hear yourself think/);

    // the hub takes the save Details starts at once, and answers late: past the next editor's own save
    let land!: () => void;
    const slow = new Promise<void>((r) => { land = r; });
    const plain = mockState.updateRecord.getMockImplementation()!;
    mockState.updateRecord.mockImplementationOnce(async (id: string, change: Record<string, unknown>) => {
      const done = await plain(id, change);
      await slow;
      return done;
    });
    fireEvent.change(editor, { target: { value: "First words." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Insert as quote" }));
    await waitFor(() => expect((screen.getByLabelText("Piece") as HTMLTextAreaElement).value).toContain("> A room"));
    await act(async () => { await new Promise((r) => setTimeout(r, 1300)); }); // the new editor's save comes due
    await act(async () => { land(); await slow; });

    const hubPiece = pieces.find((p) => p.id === PIECE_DRAFT.id)!;
    await waitFor(() => expect(hubPiece.body).toContain("> A room that lets you hear yourself think"), { timeout: 8000 });
    expect(hubPiece.body!.startsWith("First words.")).toBe(true);
    expect(screen.queryByText(/Changed elsewhere/)).toBeNull();
    expect(mockState.toastCalls.some((t) => t.opts?.error)).toBe(false);
  });

  it("a stage change answered slowly, then the editor made again: its next save builds on it, no false conflict", async () => {
    const { pieces } = setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    await screen.findByLabelText("Piece");
    await screen.findByText(/A room that lets you hear yourself think/);
    let land!: () => void;
    const slow = new Promise<void>((r) => { land = r; });
    const plain = mockState.updateRecord.getMockImplementation()!;
    mockState.updateRecord.mockImplementationOnce(async (id: string, change: Record<string, unknown>) => {
      const done = await plain(id, change);
      await slow;
      return done;
    });
    const stage = screen.getByLabelText("Piece details").querySelector("select")!;
    fireEvent.change(stage, { target: { value: "seed" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Insert as quote" }));
    await waitFor(() => expect((screen.getByLabelText("Piece") as HTMLTextAreaElement).value).toContain("> A room"));
    await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });
    await act(async () => { land(); await slow; });

    const hubPiece = pieces.find((p) => p.id === PIECE_DRAFT.id)!;
    await waitFor(() => expect(hubPiece.body).toContain("> A room that lets you hear yourself think"), { timeout: 8000 });
    expect(hubPiece.fields?.stage).toBe("seed");
    expect(screen.queryByText(/Changed elsewhere/)).toBeNull();
  });

  it("an ask that lands after another piece is opened leaves that piece's Beside it its own", async () => {
    setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    await screen.findByText(/A room that lets you hear yourself think/);
    let land!: () => void;
    const slow = new Promise<void>((r) => { land = r; });
    const plain = mockState.createRecord.getMockImplementation()!;
    mockState.createRecord.mockImplementationOnce(async (rec: Parameters<typeof plain>[0]) => { await slow; return plain(rec); });
    fireEvent.change(screen.getByLabelText("Ask Uni"), { target: { value: "Find a passage on margins" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    // back to the list, and into the other piece
    fireEvent.click(screen.getAllByRole("button", { name: /Writing/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Notes on small ponds/ }));
    await screen.findByText(/Shallow ponds warm early/);
    await act(async () => { land(); await slow; await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByText(/Shallow ponds warm early/)).toBeTruthy();
    expect(screen.queryByText(/A room that lets you hear yourself think/)).toBeNull();
    expect(screen.queryByText("Find a passage on margins")).toBeNull();
  });

  it("Reload piece after a conflict shows the piece as the hub has it", async () => {
    const { pieces } = setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    const editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;

    // someone else changed the piece; our save gets a 409
    const hubPiece = pieces.find((p) => p.id === PIECE_DRAFT.id)!;
    hubPiece.body = "Changed on another device.";
    hubPiece.updatedAt = "2026-11-23T17:00:00Z";
    mockState.updateRecord.mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }));
    fireEvent.change(editor, { target: { value: "My local edit." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const reload = await screen.findByRole("button", { name: "Reload piece" });

    fireEvent.click(reload);
    await waitFor(() => expect((screen.getByLabelText("Piece") as HTMLTextAreaElement).value).toBe("Changed on another device."));
    expect(screen.queryByText(/Changed elsewhere/)).toBeNull();
  });

  it("Reload piece gets out of a conflict that a kept draft's older version caused", async () => {
    setupMockVault();
    // the app was closed with unsaved words; the piece changed elsewhere since
    mockState.savedStore.set(`draft:${PIECE_DRAFT.id}`, { body: "Words from before.", base: "2026-11-01T00:00:00Z" });
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    expect(((await screen.findByLabelText("Piece")) as HTMLTextAreaElement).value).toBe("Words from before.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reload piece" }));

    await waitFor(() => expect((screen.getByLabelText("Piece") as HTMLTextAreaElement).value).toBe(PIECE_DRAFT.body));
    expect(screen.queryByText(/Changed elsewhere/)).toBeNull();
    expect(mockState.savedStore.has(`draft:${PIECE_DRAFT.id}`)).toBe(false);
  });

  it("moves a piece only between seed and draft; ready and published are the site's", async () => {
    const { pieces } = setupMockVault();
    const ready: VaultRec = {
      ...structuredClone(PIECE_PUBLISHED),
      id: "01PIECE_READY",
      path: "Writing/Pieces/Almost out",
      fields: { stage: "ready", slug: "almost-out", published_at: "2026-11-30" },
    };
    pieces.push(ready);
    render(<Writing />);
    // a ready piece is its own group, not filed as a seed
    await screen.findByText("Almost out");
    expect(screen.getByRole("button", { name: /^Ready/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Tools that stay quiet/ }));
    await screen.findByLabelText("Piece");
    const stage = screen.getByLabelText("Piece details").querySelector("select")!;
    expect([...stage.options].map((o) => o.value).filter(Boolean)).toEqual(["seed", "draft"]);
    cleanup();
    mockState.savedStore.clear(); // else it reopens the piece it was on

    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Almost out/ }));
    await screen.findByLabelText("Piece");
    const details = screen.getByLabelText("Piece details");
    expect(details.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(details.textContent).toContain("almost-out");
    cleanup();
    mockState.savedStore.clear();

    // a stage the site added that this applet doesn't know is shown as it is, and left alone
    pieces.push({ ...structuredClone(PIECE_SEED), id: "01PIECE_SCHED", path: "Writing/Pieces/Coming soon", fields: { stage: "scheduled" } });
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Coming soon/ }));
    await screen.findByLabelText("Piece");
    const sched = screen.getByLabelText("Piece details");
    expect(sched.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(sched.textContent).toContain("scheduled");
  });

  it("a piece opened from outside opens with no piece open, and the last piece's references don't follow it", async () => {
    setupMockVault();
    render(<Writing />);
    await screen.findByText("Notes on small ponds");
    // a link to a piece, from the pieces list (no editor mounted)
    act(() => openCb!({ note: { id: PIECE_DRAFT.id, path: PIECE_DRAFT.path }, screen: "home" }));
    await screen.findByText(/A room that lets you hear yourself think/);

    // then a link to another piece, while the first is open; its references take a while to come
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    const plain = mockState.queryRecords.getMockImplementation()!;
    mockState.queryRecords.mockImplementation(async (q: Record<string, unknown> = {}) => {
      if (q.pathPrefix === "References/") await slow;
      return plain(q);
    });
    act(() => openCb!({ note: { id: PIECE_SEED.id, path: PIECE_SEED.path }, screen: "home" }));
    await screen.findByRole("heading", { name: "Notes on small ponds" });
    // meanwhile nothing of the first piece's is offered to insert into this one
    expect(screen.queryByText(/A room that lets you hear yourself think/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Insert quote" })).toBeNull();
    await act(async () => release());
    await screen.findByText(/Shallow ponds warm early/);
    expect(screen.getAllByRole("button", { name: "Insert quote" })).toHaveLength(1);
  });

  it("a reference opened from outside, for another piece, closes the open piece and offers no insert", async () => {
    setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    await screen.findByText(/A room that lets you hear yourself think/);

    act(() => openCb!({ note: { id: REF_OTHER_PIECE.id, path: REF_OTHER_PIECE.path }, screen: "home" }));
    await screen.findByText(/Shallow ponds warm early/);
    expect(screen.queryByRole("button", { name: "Insert as quote" })).toBeNull();
    // Back lands on the pieces list, not on a piece that never loads
    fireEvent.click(screen.getByRole("button", { name: /Writing/ }));
    await screen.findByText("Notes on small ponds");
    expect(screen.queryByText("Opening piece…")).toBeNull();
  });

  it("typing just after a stage change saves against the new version, not into a false conflict", async () => {
    const { pieces } = setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    const editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;

    // hold the stage change until the person has typed
    let finish!: () => void;
    const held = new Promise<void>((r) => { finish = r; });
    const plain = mockState.updateRecord.getMockImplementation()!;
    mockState.updateRecord.mockImplementationOnce(async (id: string, change: Record<string, unknown>) => {
      await held;
      return plain(id, change);
    });
    const stage = screen.getByLabelText("Piece details").querySelector("select")!;
    fireEvent.change(stage, { target: { value: "seed" } });
    await waitFor(() => expect(mockState.updateRecord).toHaveBeenCalledTimes(1));
    fireEvent.change(editor, { target: { value: "Typed while the stage changed." } });
    // the save comes due while the stage change is still out
    await act(async () => { await new Promise((r) => setTimeout(r, 1000)); });
    await act(async () => { finish(); await held; });

    // both land: the stage and the words, with no conflict
    const hubPiece = pieces.find((p) => p.id === PIECE_DRAFT.id)!;
    await waitFor(() => expect(hubPiece.body).toBe("Typed while the stage changed."), { timeout: 8000 });
    expect(hubPiece.fields?.stage).toBe("seed");
    expect(mockState.toastCalls.some((t) => t.opts?.error)).toBe(false);
  });

  it("the open piece read again from the hub shows its new words, and never saves the old ones over them", async () => {
    const { pieces } = setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    await screen.findByLabelText("Piece");
    const hubPiece = pieces.find((p) => p.id === PIECE_DRAFT.id)!;

    // changed on another device; a link opens the same piece again
    hubPiece.body = "Rewritten on the phone.";
    hubPiece.updatedAt = "2026-11-23T19:00:00Z";
    act(() => openCb!({ note: { id: PIECE_DRAFT.id, path: PIECE_DRAFT.path }, screen: "home" }));
    await waitFor(() => expect((screen.getByLabelText("Piece") as HTMLTextAreaElement).value).toBe("Rewritten on the phone."));

    // Back saves nothing old over it
    fireEvent.click(screen.getByRole("button", { name: /Writing/ }));
    await screen.findByText("Notes on small ponds");
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(hubPiece.body).toBe("Rewritten on the phone.");

    // with unsaved words here when it changed there, the save is refused rather than overwriting
    fireEvent.click(screen.getByRole("button", { name: /Tools that stay quiet/ }));
    const editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe("Rewritten on the phone."));
    fireEvent.change(editor, { target: { value: "Typed here meanwhile." } });
    hubPiece.body = "Rewritten again on the phone.";
    hubPiece.updatedAt = "2026-11-23T20:00:00Z";
    act(() => openCb!({ note: { id: PIECE_DRAFT.id, path: PIECE_DRAFT.path }, screen: "home" }));
    await screen.findByRole("button", { name: "Reload piece" });
    expect(hubPiece.body).toBe("Rewritten again on the phone.");
  });

  it("an asked reference can be let go but not kept, so a question never goes in as a quote", async () => {
    const { refs } = setupMockVault();
    refs.unshift({ ...structuredClone(REF_OLDER), id: "01ASK", path: "References/Ask 2026 find", createdAt: "2026-11-23T23:00:00Z", body: "Find a passage on margins", fields: { piece: PIECE_DRAFT.id, state: "asked" } });
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    await screen.findByText("Find a passage on margins");
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    await screen.findByRole("button", { name: "Let go" });
    expect(screen.getByText(/Reference · Asked/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });

  it("when References/ can't be read, Beside it says so and offers Retry, not 'nothing yet'", async () => {
    setupMockVault();
    const plain = mockState.queryRecords.getMockImplementation()!;
    mockState.queryRecords.mockImplementation(async (q: Record<string, unknown> = {}) => {
      if (q.pathPrefix === "References/") throw Object.assign(new Error("hub unreachable"), { status: 503 });
      return plain(q);
    });
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    await screen.findByText(/Could not read references/);
    expect(screen.queryByText(/No references for this piece yet/)).toBeNull();
  });

  it("Insert quote notes the piece in the reference's used_in, reading it again once if it changed", async () => {
    const { refs } = setupMockVault();
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    await screen.findByText(/A room that lets you hear yourself think/);
    // Uni changed the reference after the list was read
    const hubRef = refs.find((r) => r.id === REF_READY.id)!;
    hubRef.updatedAt = "2026-11-23T18:00:00Z";
    hubRef.fields = { ...hubRef.fields, used_in: ["01OTHER_PIECE"] };
    fireEvent.click(screen.getAllByRole("button", { name: "Insert quote" })[0]);
    await waitFor(() => expect(hubRef.fields?.used_in).toEqual(["01OTHER_PIECE", "Tools that stay quiet"]));
    expect(mockState.toastCalls.some((t) => t.opts?.error)).toBe(false);
  });

  it("Insert quote into a piece never touched lands at its end, not where an unfocused box's selection says", async () => {
    const { pieces, refs } = setupMockVault();
    // a piece of its own: the caret kept for a piece outlives one test
    pieces.unshift({ ...structuredClone(PIECE_DRAFT), id: "01UNTOUCHED", path: "Writing/Pieces/Untouched" });
    refs.unshift({ ...structuredClone(REF_READY), id: "01REF_UNTOUCHED", fields: { ...REF_READY.fields, piece: "Untouched" } });
    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Untouched/ }));
    const editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;
    await screen.findByText(/A room that lets you hear yourself think/);
    editor.setSelectionRange(0, 0); // as WebKit reports a box never focused
    fireEvent.click(screen.getAllByRole("button", { name: "Insert quote" })[0]);
    await waitFor(() => expect(editor.value.startsWith(PIECE_DRAFT.body!)).toBe(true));
    expect(editor.value).toMatch(/> A room that lets you hear yourself think[\s\S]*$/);
  });

  it("lists every piece, past the hub's page of 50", async () => {
    const many: VaultRec[] = Array.from({ length: 62 }, (_, i) => ({
      ...structuredClone(PIECE_SEED),
      id: `01MANY${String(i).padStart(3, "0")}`,
      path: `Writing/Pieces/Piece ${i}`,
      updatedAt: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}T08:00:00Z`,
    }));
    mockState.queryRecords.mockImplementation(async (q: Record<string, unknown> = {}) => {
      const from = Number(q.offset ?? 0);
      return q.pathPrefix === "Writing/Pieces/" ? many.slice(from, from + Number(q.limit ?? 50)) : [];
    });
    render(<Writing />);
    await screen.findByText("Piece 61");
    expect(screen.getByRole("button", { name: /^All.*62/ })).toBeTruthy();
  });

  it("typing into a long piece does not re-render the Beside-it panel on keystrokes", async () => {
    const longBody = Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1}: quiet tools stay out of the writer's way while ideas form on the page.`).join("\n\n");
    const longPiece: VaultRec = { ...PIECE_DRAFT, id: "01LONG", body: longBody };
    const longRef: VaultRec = { ...REF_READY, fields: { ...REF_READY.fields, piece: longPiece.id } };
    mockState.queryRecords.mockImplementation(async (q: Record<string, unknown> = {}) =>
      q.pathPrefix === "Writing/Pieces/" ? [longPiece] : [longRef, REF_OLDER],
    );
    mockState.getRecord.mockResolvedValue(longPiece);
    mockState.updateRecord.mockResolvedValue({ ...longPiece, updatedAt: "2026-11-23T16:00:00Z" });

    render(<Writing />);
    fireEvent.click(await screen.findByRole("button", { name: /Tools that stay quiet/ }));
    const editor = (await screen.findByLabelText("Piece")) as HTMLTextAreaElement;
    await screen.findByText(/A room that lets you hear yourself think/);

    // Watch DOM mutations on the Beside-it section while typing 30 keystrokes into the long piece
    const besideEl = screen.getByLabelText("Beside it");
    let besideMutations = 0;
    const observer = new MutationObserver(() => { besideMutations++; });
    observer.observe(besideEl, { childList: true, subtree: true, attributes: true, characterData: true });

    let current = editor.value;
    const typed = " Every keystroke lands at once.";
    for (const ch of typed) {
      current += ch;
      await act(async () => {
        fireEvent.change(editor, { target: { value: current } });
      });
    }
    observer.disconnect();

    expect(besideMutations).toBe(0);
    expect(editor.value.endsWith(typed)).toBe(true);
    // Debounced: no vault write has fired synchronously during typing
    expect(mockState.updateRecord).not.toHaveBeenCalled();
  });
});
