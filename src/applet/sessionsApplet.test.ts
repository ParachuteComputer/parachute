// Sessions (applets/sessions.tsx), the second net behind mts's redaction: its copy of the redactor, the label check and
// the step phrases run the same cases as mts's and the Uni app's (redaction-vectors.json, copied from the Uni app's
// scripts/fixtures, T-304), and a steps note's lines read back as mts writes them, every word through the redactor.
import { readFileSync } from "node:fs";
import { transform } from "sucrase";
import { describe, expect, it } from "vitest";

const src = readFileSync(`${process.cwd()}/applets/sessions.tsx`, "utf8");
const block = src.slice(src.indexOf("// ── redact (the Uni app's"), src.indexOf("const HEARD_MS"));
const code = transform(block, { transforms: ["typescript"] }).code;
const { redactRaw, labelOk, safeStep, parseFeed } = new Function(`${code}; return { redactRaw, labelOk, safeStep, parseFeed };`)() as {
  redactRaw: (t: string) => string; labelOk: (l: string) => boolean; safeStep: (t: string) => string;
  parseFeed: (c: string, first?: number) => { at: string | null; kind: string; text: string; n: number }[] };
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
