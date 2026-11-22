// Sessions (applets/sessions.tsx), the second net behind mts's redaction: its copy of the redactor, the label check and
// the step phrases run the same cases as mts's and the Uni app's (redaction-vectors.json, copied from the Uni app's
// scripts/fixtures, T-304), and a steps note's lines read back as mts writes them, every word through the redactor.
import { readFileSync } from "node:fs";
import { transform } from "sucrase";
import { describe, expect, it } from "vitest";

const src = readFileSync(`${process.cwd()}/applets/sessions.tsx`, "utf8");
const block = src.slice(src.indexOf("// ── redact (the Uni app's"), src.indexOf("const HEARD_MS"));
const code = transform(block, { transforms: ["typescript"] }).code;
type Item = { at: string | null; kind: string; text: string; n: number };
type Pages = { first: number; total: number; dropped: number; parts: { id: string; first: number; n: number }[] };
type Held = { items: Item[]; from: number; to: number };
const { redactRaw, labelOk, safeStep, parseFeed, feedPages, withHead, partBefore, withPart, plainTitle, resultWords, plainWord } = new Function(`${code}; return { redactRaw, labelOk, safeStep, parseFeed, feedPages, withHead, partBefore, withPart, plainTitle, resultWords, plainWord };`)() as {
  redactRaw: (t: string) => string; labelOk: (l: string) => boolean; safeStep: (t: string) => string;
  parseFeed: (c: string, first?: number) => Item[]; feedPages: (m: unknown) => Pages | null; withHead: (h: Held | null, head: Item[], p: Pages) => Held;
  partBefore: (p: Pages | null, from: number) => Pages["parts"][number] | null; withPart: (h: Held, part: Pages["parts"][number], lines: Item[]) => Held;
  plainTitle: (t: string) => string; resultWords: (s: string | null) => string | null; plainWord: (v: unknown, re: RegExp) => string | null };
const V = JSON.parse(readFileSync(`${process.cwd()}/src/applet/redaction-vectors.json`, "utf8")) as {
  rules: { name: string; re: string; flags: string; mix: boolean }[]; fold: Record<string, string>; dashes: string;
  cases: { name: string; in: string; out: string }[]; label_cases: { name: string; label: string; ok: boolean }[]; step_lines: { name: string; in: string; out: string }[] };

/** The vectors write a long key as {{a1*12}} (a1 twelve times), so no scanner takes the file for a leak. */
const expand = (t: string) => t.replace(/\{\{(.+?)\*(\d+)\}\}/g, (_m, s: string, n: string) => s.repeat(Number(n)));

describe("Sessions' redactor", () => {
  it("has the shared rules, folds and dashes, as written", () => {
    for (const r of V.rules) expect(src, r.name).toContain(JSON.stringify(r.re).slice(1, -1));
    expect(Object.keys(V.fold).join("")).toBe(JSON.parse(`"${/const FOLD_FROM = "([^"]+)"/.exec(src)![1]}"`));
    expect(Object.values(V.fold).join("")).toBe(/const FOLD_TO = "([^"]+)"/.exec(src)![1]);
  });
  it.each(V.cases.map((c) => [c.name, c]))("hides a secret: %s", (_n, c) => { expect(redactRaw(expand(c.in))).toBe(expand(c.out)); });
  it.each(V.label_cases.map((c) => [c.name, c]))("a label: %s", (_n, c) => { expect(labelOk(expand(c.label))).toBe(c.ok); });
  it.each(V.step_lines.map((c) => [c.name, c]))("a step line: %s", (_n, c) => { expect(safeStep(expand(c.in))).toBe(expand(c.out)); });
});

// mts (mts.py sync_feed): parts of 200 steps; the head note starts at min(parts*200, max(0, n-60)), so with n % 200 < 60
// the head overlaps the last part (review of #162 found "Earlier steps" skipped it)
const lines = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `- 2026-11-22T07:00:00Z · said · line ${from + i}`).join("\n");
describe("a long session, a part at a time", () => {
  it.each([[231], [451], [611], [648], [150]])("every step of a %i-step session is reached once, in order", (n) => {
    const parts = Math.floor(n / 200);
    const first = Math.min(parts * 200, Math.max(0, n - 60));
    const md = { first, total: n, dropped: 0, parts: Array.from({ length: parts }, (_, k) => ({ id: `part${k}`, first: k * 200, n: 200 })) };
    const pages = feedPages(md)!;
    let held = withHead(null, parseFeed(lines(first, n), first), pages);
    // as the button does, at most once per part (a part that reaches nothing new ends it)
    for (let k = 0, p = partBefore(pages, held.from); p && k <= parts; k++, p = partBefore(pages, held.from)) held = withPart(held, p, parseFeed(lines(p.first, p.first + p.n), p.first));
    expect(held.items.map((x) => x.n)).toEqual(Array.from({ length: n }, (_, i) => i));
  });
  it("a part without a whole id or numbers is no part (mts pads with null)", () => {
    expect(feedPages({ first: 200, total: 231, parts: [{ id: null, first: 0, n: 200 }] })!.parts).toEqual([]);
  });
  it("the head read again keeps the earlier steps loaded", () => {
    const pages = { first: 171, total: 231, dropped: 0, parts: [{ id: "p0", first: 0, n: 200 }] };
    const held = withPart(withHead(null, parseFeed(lines(171, 231), 171), pages), pages.parts[0], parseFeed(lines(0, 200), 0));
    const again = withHead(held, parseFeed(lines(180, 240), 180), { ...pages, first: 180, total: 240 });
    expect(again.items.map((x) => x.n)).toEqual(Array.from({ length: 240 }, (_, i) => i));
  });
});

describe("words", () => {
  it("a title and a closing line without task numbers, run ids or the launcher's own words", () => {
    expect(plainTitle("T-476: Sessions applet (resume ab12cd34)")).toBe("Sessions applet");
    expect(resultWords("mts ab12cd34: completed, evidence: file /home/x/Code/wt/PROGRESS.md")).toBe("Left PROGRESS.md.");
    expect(resultWords("mts ab12cd34: blocked")).toBeNull();
  });
  it("a room or a model shows only when it is plainly one", () => {
    expect(plainWord("parachute", /^[a-z0-9][a-z0-9_-]{0,39}$/i)).toBe("parachute");
    expect(plainWord("sk-ant-api03-abcdefabcdef", /^[a-z0-9][a-z0-9_-]{0,39}$/i)).toBeNull();
    expect(plainWord("0123456789abcdef0123456789abcdef", /^[a-z0-9][a-z0-9_-]{0,39}$/i)).toBeNull();
    expect(plainWord("claude-opus-5-5", /^claude-[a-z]+-\d+(?:-\d+)*$/)).toBe("claude-opus-5-5");
  });
});

describe("a steps note", () => {
  it("reads mts's lines, numbered from the note's first, a step as its phrase, words through the redactor", () => {
    const note = ["# Steps", "", "What the session did, newest last. Written by mts while it runs.", "",
      "- 2026-11-22T07:01:00Z · step · Reading README.md",
      "- 2026-11-22T07:01:05Z · said · Looking at the frame first.",
      "- 2026-11-22T07:01:09Z · step · Running curl -H Authorization: Bearer abc",
      "- 2026-11-22T07:02:00Z · said · the token is sk-ant-abcdefabcdef and more",
      "- - · step · something no phrase says"].join("\n");
    expect(parseFeed(note, 40)).toEqual([
      { at: "2026-11-22T07:01:00Z", kind: "step", text: "Reading README.md", n: 40 },
      { at: "2026-11-22T07:01:05Z", kind: "said", text: "Looking at the frame first.", n: 41 },
      { at: "2026-11-22T07:01:09Z", kind: "step", text: "Running a command", n: 42 },
      { at: "2026-11-22T07:02:00Z", kind: "said", text: "the [hidden]", n: 43 },
      { at: null, kind: "step", text: "A step", n: 44 },
    ]);
  });
});
