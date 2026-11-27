// The pure parts of Vault's notes list (applets/vault.tsx): a note's first words for its line, the stretch of time it
// is told under, whether its words already say its name, and the list after a save from the note open beside it.
import { readFileSync } from "node:fs";
import { transform } from "sucrase";
import { describe, expect, it } from "vitest";

const src = readFileSync(`${process.cwd()}/applets/vault.tsx`, "utf8");
const start = src.indexOf("// ── pure helpers (tested in src/applet/vaultNotes.test.ts) ──");
const end = src.indexOf("// ── end pure helpers ──");
if (start < 0 || end <= start) throw new Error("could not locate the pure helpers block in applets/vault.tsx");
const code = transform(src.slice(start, end), { transforms: ["typescript"] }).code;
type Row = { id: string; title: string; preview?: string; types: string[]; updatedAt?: string };
const api = new Function(`${code}; return { wordsOf, dayOf, saysItsName, withSaved };`)() as {
  wordsOf(r: { title: string; preview?: string; types: string[] }): string;
  dayOf(at: string | null, now?: number): string;
  saysItsName(r: { id: string; path: string; title: string; body?: string }): boolean;
  withSaved(rows: readonly Row[], n: Row & { body?: string }): Row[];
};

describe("wordsOf: a note's first words in the list", () => {
  const w = (title: string, preview: string, types: string[] = []) => api.wordsOf({ title, preview, types });
  it("leaves out its own title said first, as a heading or as its first line", () => {
    expect(w("Tomato trellis ideas", "# Tomato trellis ideas Cattle panel arch over the path.")).toBe("Cattle panel arch over the path.");
    expect(w("Bee course notes", "Bee course notes Smoke first, then lift the lid.")).toBe("Smoke first, then lift the lid.");
    expect(w("Journal 2026-11-27", "# Journal Frost last night.")).toBe("Frost last night.");
  });
  it("never cuts a title out of the middle of a word", () => {
    expect(w("Plan", "Planning the trip to the coast")).toBe("Planning the trip to the coast");
    expect(w("Plan", "Plan: the coast in May")).toBe("the coast in May");
  });
  it("reads links as their words, drops markdown's marks, and keeps a name's own underscores", () => {
    expect(w("Bees", "With [[People/Hannah Lindqvist]] and [the club](https://bees.example). **Smoke** first, see my_file.md")).toBe("With Hannah Lindqvist and the club. Smoke first, see my_file.md");
    expect(w("Bees", "_gently_ lift the lid")).toBe("gently lift the lid");
  });
  it("says a record's types first, and is empty when there is nothing to say", () => {
    expect(w("Order seedlings", "# Order seedlings Part of the Garden plan.", ["task"])).toBe("task · Part of the Garden plan.");
    expect(w("Untitled", "")).toBe("");
    expect(api.wordsOf({ title: "No preview", types: ["reading_list"] })).toBe("reading list");
  });
});

describe("dayOf: the stretch a note is told under", () => {
  const now = new Date(2026, 10, 27, 15, 0).getTime();   // Friday 27 November 2026, mid-afternoon, device time
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();
  it("today, yesterday, the last seven days, the month, the year, and before", () => {
    expect(api.dayOf(at(2026, 10, 27, 0), now)).toBe("Today");
    expect(api.dayOf(at(2026, 10, 26, 23), now)).toBe("Yesterday");
    expect(api.dayOf(at(2026, 10, 21, 9), now)).toBe("Last 7 days");
    expect(api.dayOf(at(2026, 10, 20, 9), now)).toBe("Earlier this month");
    expect(api.dayOf(at(2026, 9, 30), now)).toBe("Earlier this year");
    expect(api.dayOf(at(2025, 11, 31), now)).toBe("Before this year");
  });
  it("a note with no date, or one that can't be read, is undated", () => {
    expect(api.dayOf(null, now)).toBe("Undated");
    expect(api.dayOf("soon", now)).toBe("Undated");
  });
});

describe("saysItsName", () => {
  it("a note named by its first words (its path ends in an id), or one that opens with its name, isn't titled twice", () => {
    expect(api.saysItsName({ id: "01A", path: "Notes/3f9a2c41d07be6a1b2c3", title: "Bee course notes", body: "Bee course notes\n\nSmoke first." })).toBe(true);
    expect(api.saysItsName({ id: "01A", path: "Garden/Seed swap", title: "Seed swap", body: "\n# Seed swap\n\nMira brings the beans." })).toBe(true);
    expect(api.saysItsName({ id: "", path: "", title: "New note", body: "" })).toBe(true);
  });
  it("a note with a name of its own that its words don't open with keeps its title", () => {
    expect(api.saysItsName({ id: "01A", path: "Garden/Compost log", title: "Compost log", body: "Turned the pile on Sunday." })).toBe(false);
    expect(api.saysItsName({ id: "01A", path: "Garden/Compost log", title: "Compost log", body: "" })).toBe(false);
  });
});

describe("withSaved: the list after a save from the note open beside it", () => {
  const rows: Row[] = [{ id: "a", title: "Alpha", preview: "one", types: [] }, { id: "b", title: "Beta", preview: "two", types: ["task"] }];
  it("that note leads, with its new first words; the others stay as they were; nothing is listed twice", () => {
    const next = api.withSaved(rows, { id: "b", title: "Beta", types: ["task"], body: "Beta\n\nnow  with   more words", updatedAt: "2026-11-27T22:00:00Z" });
    expect(next.map((r) => r.id)).toEqual(["b", "a"]);
    expect(next[0]).toMatchObject({ preview: "Beta now with more words", updatedAt: "2026-11-27T22:00:00Z", types: ["task"] });
    expect("body" in next[0]).toBe(false);
    expect(next[1]).toBe(rows[0]);
  });
  it("a note the list didn't hold yet is added at the top", () => {
    expect(api.withSaved(rows, { id: "c", title: "Gamma", types: [], body: "g" }).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
