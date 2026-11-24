// Words and cards in applets/languages.tsx: where they live (WEB.md §1), the cards a word gets (Fluent Forever), what a
// card's front shows, which cards are due today (new ones a day, one card of a word a day), and the starter words.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { L } from "./applet";

const { appendReviewLine, cardFace, cardPathFor, dueToday, fromPath, missingCards, newSm2Card, reviewDays, starterWords, STARTER, wordFields, wordFromRecord, wordKey, wordPathFor, withPicture } = L;
type WordData = Parameters<typeof wordFields>[0];
type Scheduled = Parameters<typeof dueToday>[0][number];
const TODAY = "2026-11-23";

const CITTA: WordData = { language: "sanskrit", word: "चित्त", translit: "citta", gloss: "the mind", grammar: "neut. a-stem", memory: null, cue: "A still lake", picture: null, sound: null, from: "Texts/Yoga Sutras/YS 1.2" };
const AGUA: WordData = { language: "spanish", word: "el agua", translit: "el A-gwa", gloss: "water", grammar: null, memory: "The pump at my grandmother's", cue: null, picture: "/api/storage/2026-11-23/water.png", sound: "/api/storage/2026-11-23/agua.webm", from: null };

describe("where words and cards live", () => {
  it("a word at Words/<Language>/<word>, its cards at Cards/<Language>/<word> <ask>", () => {
    expect(wordPathFor(CITTA)).toBe("Words/Sanskrit/चित्त");
    expect(wordPathFor(AGUA)).toBe("Words/Spanish/el agua");
    expect(cardPathFor("Words/Sanskrit/चित्त", "script")).toBe("Cards/Sanskrit/चित्त script");
    // a name can't make a path of its own
    expect(wordPathFor({ language: "spanish", word: "sí/no [[x]]" })).toBe("Words/Spanish/sí no x");
  });

  it("reads a word back from its record, and one Library wrote in IAST", () => {
    const rec = { path: "Words/Sanskrit/चित्त", fields: wordFields(CITTA) };
    expect(wordFromRecord(rec)).toEqual(CITTA);
    expect(wordFromRecord({ path: "Words/Sanskrit/nirodha", fields: { gloss: "stilling" } })).toMatchObject({ language: "sanskrit", word: "निरोध", translit: "nirodha", gloss: "stilling" });
    expect(wordFromRecord({ path: "Words/Spanish/el agua", fields: wordFields(AGUA) })).toEqual(AGUA);
    expect(wordFields({ ...CITTA, grammar: "  ", memory: null })).not.toHaveProperty("grammar");
  });

  it("knows a word is already there, whatever its path: one Library wrote in IAST is the same word in Devanagari", () => {
    const key = (path: string) => wordKey(wordFromRecord({ path, fields: {} }));
    expect(key("Words/Sanskrit/nirodha")).toBe(key("Words/Sanskrit/निरोध"));
    expect(key("Words/Spanish/El agua")).toBe(key("Words/Spanish/el agua"));
    expect(key("Words/Spanish/el agua")).not.toBe(key("Words/Sanskrit/el agua"));
  });

  it("knows a verse's path from a few words", () => {
    expect(fromPath("Texts/Yoga Sutras/YS 1.2")).toBe("Texts/Yoga Sutras/YS 1.2");
    expect(fromPath("a song on the radio")).toBeNull();
    expect(fromPath("https://example.org/a/b")).toBeNull();
  });
});

describe("the cards a word gets", () => {
  it("picture → word, word → meaning and its spelling; a sound card once it has a sound", () => {
    const made = missingCards(CITTA, "Words/Sanskrit/चित्त", TODAY, new Set());
    expect(made.map((c) => c.path)).toEqual(["Cards/Sanskrit/चित्त picture-to-word", "Cards/Sanskrit/चित्त word-to-meaning", "Cards/Sanskrit/चित्त script"]);
    expect(made[0].fields).toEqual({ word: "Words/Sanskrit/चित्त", ask: "picture-to-word", language: "sanskrit", state: "new", due: TODAY, interval: 0, ease: 2.5, reps: 0, lapses: 0 });
    expect(missingCards(AGUA, "Words/Spanish/el agua", TODAY, new Set()).map((c) => c.ask)).toEqual(["picture-to-word", "word-to-meaning", "script", "sound"]);
  });

  it("makes only what is missing: a sound recorded later adds the sound card, and nothing twice", () => {
    const have = new Set(missingCards(CITTA, "Words/Sanskrit/चित्त", TODAY, new Set()).map((c) => c.path));
    expect(missingCards(CITTA, "Words/Sanskrit/चित्त", TODAY, have)).toEqual([]);
    expect(missingCards({ ...CITTA, sound: "/api/storage/x.webm" }, "Words/Sanskrit/चित्त", TODAY, have).map((c) => c.path)).toEqual(["Cards/Sanskrit/चित्त sound"]);
  });

  it("keeps the meaning off the front of picture → word, and asks for Devanagari from IAST", () => {
    expect(cardFace("picture-to-word", { ...AGUA })).toMatchObject({ picture: true, cue: undefined });
    const p2w = cardFace("picture-to-word", CITTA);
    expect(p2w.cue).toBe("A still lake");
    expect(JSON.stringify(p2w)).not.toContain("the mind");
    expect(cardFace("word-to-meaning", CITTA)).toMatchObject({ big: "चित्त", bigLang: "sa-Deva", small: "citta" });
    expect(cardFace("script", CITTA)).toMatchObject({ label: "Devanagari", big: "citta", typed: { expected: "चित्त" } });
    expect(cardFace("script", { ...AGUA, word: "el corazón" })).toMatchObject({ label: "Spelling", small: "el  c _ _ _ _ _ n", typed: { expected: "el corazón" } });
    expect(cardFace("sound", AGUA)).toMatchObject({ audio: true, picture: false });
    expect(cardFace("sound", AGUA)).not.toHaveProperty("big");
  });

  it("puts the picture first in the word's body, replacing the one before, and keeps the rest", () => {
    const one = withPicture("", "/api/storage/a.png", "a lake");
    expect(one).toBe("![a lake](/api/storage/a.png)\n");
    expect(withPicture(`${one}\nMet it on the retreat.\n`, "/api/storage/b.png", "a [lake]")).toBe("![a  lake](/api/storage/b.png)\n\nMet it on the retreat.\n");
  });

  it("logs a line a review, and reads the days back", () => {
    const body = appendReviewLine(appendReviewLine("", "- 2026-11-22 09-00 · Good · new → 1d · ease 2.50 · due 2026-11-23"), "- 2026-11-23 08-10 · Good · 1d → 6d · ease 2.50 · due 2026-11-29");
    expect(body.split("\n").filter(Boolean)).toHaveLength(2);
    expect(reviewDays(body)).toEqual(["2026-11-22", "2026-11-23"]);
  });
});

describe("what is due today", () => {
  const card = (id: string, word: string, over: Partial<Scheduled> = {}, sm2 = {}): Scheduled =>
    ({ id, word, language: "sanskrit", sm2: { ...newSm2Card(TODAY), ...sm2 }, days: [], ...over });

  it("learning first, then reviews (most overdue first), then new cards in the order they were made", () => {
    const got = dueToday([
      card("n1", "w1"), card("r1", "w2", {}, { state: "review", due: "2026-11-20", interval: 3 }), card("l1", "w3", {}, { state: "relearning", interval: 0 }),
      card("r2", "w4", {}, { state: "review", due: "2026-11-10", interval: 9 }), card("later", "w5", {}, { state: "review", due: "2026-11-30", interval: 7 }),
    ], TODAY);
    expect(got.map((c) => c.id)).toEqual(["l1", "r2", "r1", "n1"]);
  });

  it("one card of a word a day: its new siblings wait for another day", () => {
    const got = dueToday([card("a1", "A"), card("a2", "A"), card("b1", "B"), card("c1", "C", { days: ["2026-11-23"] }, { state: "review", due: "2026-11-24", interval: 1 }), card("c2", "C")], TODAY);
    expect(got.map((c) => c.id)).toEqual(["a1", "b1"]);
  });

  it("at most twenty new a language a day, counting those started today", () => {
    const many = Array.from({ length: 30 }, (_, i) => card(`s${i}`, `s${i}`));
    expect(dueToday(many, TODAY)).toHaveLength(20);
    const startedToday = Array.from({ length: 5 }, (_, i) => card(`t${i}`, `t${i}`, { days: [TODAY] }, { state: "review", due: "2026-11-24", interval: 1 }));
    expect(dueToday([...startedToday, ...many], TODAY)).toHaveLength(15);
    // each language has its own twenty
    expect(dueToday([...many, ...many.map((c) => ({ ...c, id: `es${c.id}`, word: `es${c.word}`, language: "spanish" }))], TODAY)).toHaveLength(40);
  });
});

describe("the starter words", () => {
  const words = starterWords();
  it("about twenty Sanskrit words from the Yoga Sutras 1.1–1.4, each linked to its verse, and twenty Spanish", () => {
    const sa = words.filter((w) => w.fields.language === "sanskrit"), es = words.filter((w) => w.fields.language === "spanish");
    expect(sa.length).toBeGreaterThanOrEqual(20);
    expect(es).toHaveLength(20);
    for (const w of sa) expect(w.fields.from).toMatch(/^Texts\/Yoga Sutras\/YS 1\.[1-4]$/);
    expect(new Set(words.map((w) => w.path)).size).toBe(words.length);
    expect(STARTER.length).toBe(words.length);
  });

  it("never writes a memory for him (Fluent Forever's connection is his own), and gives each a picture idea", () => {
    for (const w of words) {
      expect(w.fields).not.toHaveProperty("memory");
      expect(w.fields.cue).toBeTruthy();
    }
  });

  it("are the fixture records, word for word", () => {
    const fixture = JSON.parse(readFileSync(`${process.cwd()}/e2e/fixtures/languages/starter.json`, "utf8"));
    expect(fixture.words).toEqual(words);
  });
});
