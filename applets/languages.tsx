// Languages: flashcards the Fluent Forever way (Gabriel Wyner), starting with Sanskrit and Spanish: a word with a
// picture instead of a translation, its sound, a memory of his own, and spaced repetition.
// The records (WEB.md §1, the Languages pack, src/kit/packs/languages.json):
//   word  Words/<Language>/<word>       language, translit, gloss, grammar, memory, from (the verse, a link), cue,
//                                       picture, sound; the body carries the picture, so Vault draws it
//   card  Cards/<Language>/<word> <ask> word (a link), ask, language, state, due, interval, ease, reps, lapses,
//                                       last_reviewed; the body is one line per review
// A word gets its cards whenever this applet sees it without them: one added here, by Library ("study this word") or
// by Uni. A review writes the schedule (SM-2 as Anki has it) to the card and a line to its body.
// The block between the "pure" markers is tested as written (src/languages/*.test.ts): keep it free of the kit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  app, Button, Card, Days, Drawer, Empty, Field, Fields, Link, List, Loading, onBack, onOpen, Page, Problem,
  ready, Record as VoiceRecord, Search, Tabs, toast, useSaved, vault, when, Write, type AppletRecord,
} from "parachute";

// ── pure ──

export type Rating = "again" | "hard" | "good" | "easy";
export type CardState = "new" | "learning" | "review" | "relearning";
export type Ask = "picture-to-word" | "word-to-meaning" | "script" | "sound";

export interface Sm2Card {
  state: CardState;
  due: string;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewed?: string | null;
}

export interface Sm2Result {
  card: Sm2Card;
  previousInterval: number;
  previousEase: number;
  previousState: CardState;
  rating: Rating;
}

// SM-2 as Anki has it (its v2 scheduler), in whole days. A new card: Again or Hard keep it in today's learning, Good
// graduates it at 1 day, Easy at 4. A card in review: Hard × 1.2, Good × ease, Easy × ease × 1.3, each at least a day
// more than the answer below it, with days overdue counted (half of them for Good); then Hard takes 0.15 from the ease
// and Easy adds 0.15. A lapse (Again in review): −0.20 ease, relearn today, then 1 day (Easy: 2). Ease never falls
// below 1.30. One way it isn't Anki's: learning steps are "again today, a few cards on", not minutes.
export const STARTING_EASE = 2.5;
export const MIN_EASE = 1.3;
const GRADUATING_INTERVAL = 1;
const EASY_INTERVAL = 4;
const HARD_FACTOR = 1.2;
const EASY_BONUS = 1.3;
const MAX_INTERVAL = 36_500;
const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampEase = (e: number) => round2(Math.max(MIN_EASE, Number.isFinite(e) ? e : STARTING_EASE));
const clampInterval = (d: number) => Math.max(0, Math.min(MAX_INTERVAL, Math.round(Number.isFinite(d) ? d : 0)));

export function parseIsoDay(day: string): number {
  const m = ISO_DAY.exec(day.trim());
  if (!m) throw new Error(`Invalid ISO date: ${day}`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new Error(`Invalid calendar date: ${day}`);
  return ms;
}

/** A real calendar day (a hand-edited 2026-02-30 is not). */
const validDay = (day: string) => { try { parseIsoDay(day); return true; } catch { return false; } };

export function addDays(day: string, days: number): string {
  const d = new Date(parseIsoDay(day) + Math.round(days) * DAY_MS);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDay(to) - parseIsoDay(from)) / DAY_MS);
}

export function newSm2Card(today: string): Sm2Card {
  parseIsoDay(today);
  return { state: "new", due: today, interval: 0, ease: STARTING_EASE, reps: 0, lapses: 0, lastReviewed: null };
}

/** A card's schedule from its fields, tolerating a partial or hand-edited record. */
export function sm2FromFields(fields: Record<string, unknown> | undefined, today: string): Sm2Card {
  const f = fields ?? {};
  const num = (k: string) => (typeof f[k] === "number" && Number.isFinite(f[k]) ? (f[k] as number) : typeof f[k] === "string" && (f[k] as string).trim() !== "" && Number.isFinite(Number(f[k])) ? Number(f[k]) : null);
  const interval = Math.max(0, Math.round(num("interval") ?? 0));
  const s = f.state;
  const state: CardState = s === "new" || s === "learning" || s === "review" || s === "relearning" ? s : interval > 0 ? "review" : "new";
  const day = typeof f.due === "string" ? f.due.trim().slice(0, 10) : "";
  const due = validDay(day) ? day : today;
  const ease = num("ease");
  const reps = num("reps");
  const lapses = num("lapses");
  return {
    state, due, interval,
    ease: ease === null ? STARTING_EASE : clampEase(ease),
    reps: reps !== null && reps >= 0 ? Math.floor(reps) : state === "review" ? 1 : 0,
    lapses: lapses !== null && lapses >= 0 ? Math.floor(lapses) : 0,
    lastReviewed: typeof f.last_reviewed === "string" ? f.last_reviewed : null,
  };
}

/** Due on `today` or before; a card in (re)learning with no interval is due at once. */
export function isDue(card: Pick<Sm2Card, "due" | "state" | "interval">, today: string): boolean {
  if ((card.state === "learning" || card.state === "relearning") && card.interval === 0) return true;
  return card.due <= today;
}

export function scheduleCard(card: Sm2Card, rating: Rating, today: string, reviewedAt?: string): Sm2Result {
  parseIsoDay(today);
  const previousInterval = clampInterval(card.interval);
  const previousEase = clampEase(card.ease);
  const previousState = card.state;
  const lastReviewed = reviewedAt ?? today;
  const out = (state: CardState, interval: number, ease: number, reps: number, lapses = card.lapses): Sm2Result =>
    ({ previousInterval, previousEase, previousState, rating, card: { state, due: addDays(today, interval), interval, ease, reps, lapses, lastReviewed } });

  if (previousState === "new" || previousState === "learning") {
    if (rating === "again" || rating === "hard") return out("learning", 0, previousEase, 0);
    if (rating === "good") return out("review", GRADUATING_INTERVAL, previousEase, 1);
    return out("review", EASY_INTERVAL, previousEase, 1);
  }
  if (previousState === "relearning") {
    if (rating === "again" || rating === "hard") return out("relearning", 0, previousEase, 0);
    return out("review", rating === "easy" ? GRADUATING_INTERVAL + 1 : GRADUATING_INTERVAL, previousEase, 1);
  }
  if (rating === "again") return out("relearning", 0, clampEase(previousEase - 0.2), 0, card.lapses + 1);

  // Anki's constrained interval: whole days (truncated), more than `above`, within the cap
  const ivl = Math.max(1, previousInterval);
  const delay = Math.max(0, daysBetween(card.due, today));
  const fit = (days: number, above: number) => clampInterval(Math.max(Math.trunc(days), above + 1));
  const hardIvl = fit(ivl * HARD_FACTOR, ivl);
  const goodIvl = fit((ivl + Math.floor(delay / 2)) * previousEase, hardIvl);
  if (rating === "hard") return out("review", hardIvl, clampEase(previousEase - 0.15), card.reps + 1);
  if (rating === "good") return out("review", goodIvl, previousEase, card.reps + 1);
  return out("review", fit((ivl + delay) * previousEase * EASY_BONUS, goodIvl), clampEase(previousEase + 0.15), card.reps + 1);
}

export function previewIntervals(card: Sm2Card, today: string): Record<Rating, number> {
  const ivl = (r: Rating) => scheduleCard(card, r, today).card.interval;
  return { again: ivl("again"), hard: ivl("hard"), good: ivl("good"), easy: ivl("easy") };
}

export function formatInterval(days: number): string {
  if (days <= 0) return "now";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round((days / 30) * 10) / 10}mo`;
  return `${Math.round((days / 365) * 10) / 10}y`;
}

export const RATING_LABEL: Record<Rating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

/** The line a review adds to the card's body. `stamp`: when.stamp's "YYYY-MM-DD HH-MM", local time. */
export function formatReviewLine(res: Sm2Result, stamp: string): string {
  const from = res.previousInterval > 0 ? `${res.previousInterval}d` : res.previousState;
  const to = res.card.interval > 0 ? `${res.card.interval}d` : res.card.state;
  return `- ${stamp} · ${RATING_LABEL[res.rating]} · ${from} → ${to} · ease ${res.card.ease.toFixed(2)} · due ${res.card.due}`;
}

/** A card's body with one more review line at its end. */
export function appendReviewLine(body: string, line: string): string {
  const clean = body.trimEnd();
  return clean ? `${clean}\n${line}\n` : `${line}\n`;
}

/** The days of a card's reviews, oldest first, from its body's lines. */
export function reviewDays(body: string | undefined): string[] {
  return [...(body ?? "").matchAll(/^- (\d{4}-\d{2}-\d{2})\b/gm)].map((m) => m[1]);
}

// IAST ↔ Devanagari, for display and for typing a word either way.
const VIRAMA = "्";
const ANUSVARA = "ं";
const VISARGA = "ः";
const CANDRABINDU = "ँ";
const AVAGRAHA = "ऽ";
const VOWELS: readonly [string, string, string][] = [
  ["ai", "ऐ", "ै"], ["au", "औ", "ौ"], ["ā", "आ", "ा"], ["ī", "ई", "ी"], ["ū", "ऊ", "ू"],
  ["ṝ", "ॠ", "ॄ"], ["ḹ", "ॡ", "ॣ"], ["ṛ", "ऋ", "ृ"], ["ḷ", "ऌ", "ॢ"],
  ["a", "अ", ""], ["i", "इ", "ि"], ["u", "उ", "ु"], ["e", "ए", "े"], ["o", "ओ", "ो"],
];
const CONSONANTS: readonly [string, string][] = [
  ["kh", "ख"], ["gh", "घ"], ["ch", "छ"], ["jh", "झ"], ["ṭh", "ठ"], ["ḍh", "ढ"], ["th", "थ"], ["dh", "ध"], ["ph", "फ"], ["bh", "भ"],
  ["k", "क"], ["g", "ग"], ["ṅ", "ङ"], ["c", "च"], ["j", "ज"], ["ñ", "ञ"], ["ṭ", "ट"], ["ḍ", "ड"], ["ṇ", "ण"],
  ["t", "त"], ["d", "द"], ["n", "न"], ["p", "प"], ["b", "ब"], ["m", "म"],
  ["y", "य"], ["r", "र"], ["l", "ल"], ["v", "व"], ["ś", "श"], ["ṣ", "ष"], ["s", "स"], ["h", "ह"],
];
const DEVA_INDEP = new Map<string, string>(VOWELS.map(([iast, indep]) => [indep, iast]));
const DEVA_MATRA = new Map<string, string>(VOWELS.filter(([, , m]) => m !== "").map(([iast, , m]) => [m, iast]));
const DEVA_CONS = new Map<string, string>(CONSONANTS.map(([iast, deva]) => [deva, iast]));

export const hasDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);

export function iastToDevanagari(input: string): string {
  const s = input.normalize("NFC").toLowerCase();
  let out = "", i = 0;
  while (i < s.length) {
    if (s.startsWith("||", i)) { out += "॥"; i += 2; continue; }
    if (s[i] === "|") { out += "।"; i += 1; continue; }
    if (s.startsWith("m̐", i)) { out += CANDRABINDU; i += 2; continue; }
    if (s[i] === "ṃ" || s[i] === "ṁ") { out += ANUSVARA; i += 1; continue; }
    if (s[i] === "ḥ") { out += VISARGA; i += 1; continue; }
    if (s[i] === "'" || s[i] === "’") { out += AVAGRAHA; i += 1; continue; }
    const c = CONSONANTS.find(([k]) => s.startsWith(k, i));
    if (c) {
      out += c[1]; i += c[0].length;
      const v = VOWELS.find(([k]) => s.startsWith(k, i));
      if (v) { out += v[2]; i += v[0].length; } else out += VIRAMA;
      continue;
    }
    const v = VOWELS.find(([k]) => s.startsWith(k, i));
    if (v) { out += v[1]; i += v[0].length; continue; }
    out += s[i]; i += 1;
  }
  return out;
}

export function devanagariToIast(input: string): string {
  const s = input.normalize("NFC");
  let out = "", i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "॥") { out += "||"; i += 1; continue; }
    if (ch === "।") { out += "|"; i += 1; continue; }
    if (ch === ANUSVARA) { out += "ṃ"; i += 1; continue; }
    if (ch === VISARGA) { out += "ḥ"; i += 1; continue; }
    if (ch === CANDRABINDU) { out += "m̐"; i += 1; continue; }
    if (ch === AVAGRAHA) { out += "'"; i += 1; continue; }
    const cons = DEVA_CONS.get(ch);
    if (cons !== undefined) {
      out += cons;
      const next = s[i + 1];
      if (next === VIRAMA) i += 2;
      else if (next !== undefined && DEVA_MATRA.has(next)) { out += DEVA_MATRA.get(next)!; i += 2; }
      else { out += "a"; i += 1; }
      continue;
    }
    const indep = DEVA_INDEP.get(ch);
    if (indep !== undefined) { out += indep; i += 1; continue; }
    out += ch; i += 1;
  }
  return out;
}

/** A Sanskrit word in both scripts, from either or both as typed. */
export function sanskritPair(word: string | null | undefined, translit?: string | null): { deva: string; iast: string } {
  const w = (word ?? "").normalize("NFC").trim(), t = (translit ?? "").normalize("NFC").trim();
  if (w && hasDevanagari(w)) return { deva: w, iast: t || devanagariToIast(w) };
  if (t && hasDevanagari(t)) return { deva: t, iast: w || devanagariToIast(t) };
  const iast = (t || w).toLowerCase();
  return { deva: iast ? iastToDevanagari(iast) : "", iast };
}

/** Two answers the same, apart from case, spacing and Unicode form. */
export function answersMatch(attempt: string, expected: string): boolean {
  const norm = (x: string) => x.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  return norm(attempt) !== "" && norm(attempt) === norm(expected);
}

// Words and their cards.
export interface WordData {
  language: string;
  /** The word as written: Devanagari for Sanskrit. It is the record's name. */
  word: string;
  /** IAST for Sanskrit; a pronunciation guide otherwise. */
  translit: string | null;
  gloss: string;
  grammar: string | null;
  /** His own memory for the word (Fluent Forever's personal connection): never written for him. */
  memory: string | null;
  /** A picture idea, until a picture is attached. */
  cue: string | null;
  picture: string | null;
  sound: string | null;
  /** Where he met it: a record's path (Texts/Yoga Sutras/YS 1.2), or a few words. */
  from: string | null;
}

export const WORDS = "Words/";
export const CARDS = "Cards/";
export const ASKS: readonly Ask[] = ["picture-to-word", "word-to-meaning", "script", "sound"];
/** New cards a day, per language (Anki's default). */
export const NEW_PER_DAY = 20;

export const langKey = (lang: string) => lang.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "other";
export const langName = (lang: string) => { const k = langKey(lang); return k.charAt(0).toUpperCase() + k.slice(1).replace(/-/g, " "); };
export const langGlyph = (lang: string) => { const k = langKey(lang); return k === "sanskrit" ? "अ" : k === "spanish" ? "ñ" : langName(k).charAt(0); };
const htmlLang = (lang: string) => (langKey(lang) === "sanskrit" ? "sa-Deva" : langKey(lang) === "spanish" ? "es" : undefined);
/** A name safe in a path: no slashes, brackets or link marks. */
const pathName = (s: string) => s.normalize("NFC").replace(/[/\\[\]#|%^]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export const wordPathFor = (w: Pick<WordData, "language" | "word">) => `${WORDS}${langName(w.language)}/${pathName(w.word)}`;
export const cardPathFor = (wordPath: string, ask: Ask) => {
  const parts = wordPath.slice(WORDS.length).split("/");
  return `${CARDS}${parts.slice(0, -1).join("/") || "Other"}/${parts[parts.length - 1]} ${ask}`;
};
/** What makes two records the same word, whatever their paths (Library may write a Sanskrit word in IAST). */
export const wordKey = (w: Pick<WordData, "language" | "word" | "translit">) =>
  `${langKey(w.language)}\n${(langKey(w.language) === "sanskrit" ? sanskritPair(w.word, w.translit).deva : w.word).normalize("NFC").trim().toLowerCase()}`;
/** A verse or other record he met the word in, when `from` is a path. */
export const fromPath = (from: string | null) => (from && /^[^\s/][^/]*\/.+[^/]$/.test(from.trim()) && !/^https?:/i.test(from.trim()) ? from.trim() : null);
export const fromLabel = (from: string) => { const p = fromPath(from); return p ? p.split("/").pop()! : from; };

export function wordFromRecord(rec: { path: string; fields?: Record<string, unknown> | null }): WordData {
  const f = rec.fields ?? {};
  const str = (k: string) => (typeof f[k] === "string" && (f[k] as string).trim() ? (f[k] as string).trim() : null);
  const parts = rec.path.normalize("NFC").replace(/\.md$/i, "").slice(WORDS.length).split("/");
  const language = langKey(str("language") ?? (parts.length > 1 ? parts[0] : "other"));
  const name = parts[parts.length - 1] ?? "";
  const base = { language, gloss: str("gloss") ?? "", grammar: str("grammar"), memory: str("memory"), cue: str("cue"), picture: str("picture"), sound: str("sound"), from: str("from") };
  if (language === "sanskrit") {
    const p = sanskritPair(name, str("translit"));
    return { ...base, word: p.deva || name, translit: p.iast || null };
  }
  return { ...base, word: name, translit: str("translit") };
}

/** The fields a word record carries (empty ones left out). */
export function wordFields(w: WordData): Record<string, string> {
  const out: Record<string, string> = { language: langKey(w.language) };
  for (const k of ["translit", "gloss", "grammar", "memory", "cue", "picture", "sound", "from"] as const) {
    const v = w[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** A word's body: its picture as its first line, so Vault and any note view draw it; the rest is his. */
export function withPicture(body: string, picture: string, alt: string): string {
  const line = `![${alt.replace(/[[\]\n]/g, " ").trim()}](${picture})`;
  const rest = body.replace(/^!\[[^\]\n]*\]\(\/api\/storage\/[^)\s]+\)\n*/, "");
  return rest.trim() ? `${line}\n\n${rest.trimStart()}` : `${line}\n`;
}

/** The asks a word has (Fluent Forever): picture → word, word → meaning, its spelling (Devanagari for Sanskrit), and its
 *  sound once it has one. */
export const asksFor = (w: Pick<WordData, "sound">): Ask[] => (w.sound ? [...ASKS] : ASKS.filter((a) => a !== "sound"));

export type NewCard = { path: string; ask: Ask; fields: Record<string, string | number>; body: string };

/** The cards a word lacks: `have` is the paths of the cards there are. */
export function missingCards(w: WordData, wordPath: string, today: string, have: ReadonlySet<string>): NewCard[] {
  const s = newSm2Card(today);
  return asksFor(w).map((ask) => ({ ask, path: cardPathFor(wordPath, ask) })).filter((c) => !have.has(c.path)).map(({ ask, path }) => ({
    path, ask, body: "",
    fields: { word: wordPath, ask, language: langKey(w.language), state: s.state, due: s.due, interval: s.interval, ease: s.ease, reps: s.reps, lapses: s.lapses },
  }));
}

export const askLabel = (ask: Ask, language: string) =>
  ask === "picture-to-word" ? "Picture → word" : ask === "word-to-meaning" ? "Word → meaning" : ask === "sound" ? "Sound → word" : langKey(language) === "sanskrit" ? "Devanagari" : "Spelling";

export interface Face {
  label: string;
  prompt: string;
  /** The word large (Devanagari for Sanskrit), with its lang. */
  big?: string;
  bigLang?: string;
  small?: string;
  /** Words in place of a picture not yet attached. */
  cue?: string;
  picture: boolean;
  audio: boolean;
  /** An answer to type and check (the script, the spelling). */
  typed?: { expected: string; placeholder: string; lang?: string };
}

/** What the front of a card shows. The meaning in English stays off the front of picture → word while the word has a
 *  picture or a picture idea; with neither, the meaning is all there is to answer from. */
export function cardFace(ask: Ask, w: WordData): Face {
  const sk = langKey(w.language) === "sanskrit" ? sanskritPair(w.word, w.translit) : null;
  const label = askLabel(ask, w.language);
  if (ask === "picture-to-word") return { label, prompt: "Say the word", picture: !!w.picture, audio: false, cue: w.picture ? undefined : w.cue ?? w.gloss };
  if (ask === "word-to-meaning") return { label, prompt: "What does it mean? Picture it", picture: false, audio: false, big: sk ? sk.deva : w.word, bigLang: htmlLang(w.language), small: sk ? sk.iast : w.translit ?? undefined };
  if (ask === "sound") return { label, prompt: "Listen: which word?", picture: false, audio: true };
  if (sk) return { label, prompt: "Write it in Devanagari", picture: !!w.picture, audio: false, big: sk.iast, typed: { expected: sk.deva, placeholder: "देवनागरी", lang: "sa-Deva" } };
  return { label, prompt: "Spell it, with its article and accents", picture: !!w.picture, audio: false, cue: w.picture ? undefined : w.cue ?? w.gloss, small: spellingHint(w.word), typed: { expected: w.word, placeholder: "Spelling", lang: htmlLang(w.language) } };
}

/** The shape of a word to spell: first and last letters, the rest as blanks. */
export function spellingHint(word: string): string {
  return word.trim().split(/\s+/).map((part, i, all) => {
    if (i < all.length - 1) return part;
    const ch = [...part];
    return ch.length <= 2 ? ch.map(() => "_").join(" ") : [ch[0], ...ch.slice(1, -1).map(() => "_"), ch[ch.length - 1]].join(" ");
  }).join("  ");
}

export type Scheduled = { id: string; word: string; language: string; sm2: Sm2Card; days: string[] };

/** Today's cards, in the order to study them: those relearning and learning, then those due for review (the most
 *  overdue first), then new ones, at most `newPerDay` a language counting those already started today, and one card
 *  of a word a day (its siblings wait: Anki's "bury siblings"), in the order they were made. */
export function dueToday(cards: readonly Scheduled[], today: string, newPerDay = NEW_PER_DAY): Scheduled[] {
  const rank = (s: CardState) => (s === "relearning" ? 0 : s === "learning" ? 1 : 2);
  const old = cards.filter((c) => c.sm2.state !== "new" && isDue(c.sm2, today))
    .sort((a, b) => rank(a.sm2.state) - rank(b.sm2.state) || a.sm2.due.localeCompare(b.sm2.due));
  const touched = new Set(cards.filter((c) => c.days[c.days.length - 1] === today || (c.sm2.state !== "new" && isDue(c.sm2, today))).map((c) => c.word));
  const started = new Map<string, number>();
  for (const c of cards) if (c.days[0] === today) started.set(c.language, (started.get(c.language) ?? 0) + 1);
  const fresh: Scheduled[] = [];
  for (const c of cards) {
    if (c.sm2.state !== "new" || touched.has(c.word) || c.sm2.due > today) continue;
    const n = started.get(c.language) ?? 0;
    if (n >= newPerDay) continue;
    started.set(c.language, n + 1);
    touched.add(c.word);
    fresh.push(c);
  }
  return [...old, ...fresh];
}

// Made-up starter decks: words from the Yoga Sutras 1.1–1.4 (the sutras are public domain; glosses and grammar notes
// are our own) and twenty everyday Spanish words. A picture idea on each, never a memory: that one is his to write.
type StarterRow = readonly [language: "sanskrit" | "spanish", word: string, translit: string, gloss: string, grammar: string, cue: string, from?: string];
const YS = (n: number) => `Texts/Yoga Sutras/YS 1.${n}`;
export const STARTER: readonly StarterRow[] = [
  ["sanskrit", "अथ", "atha", "now, here begins", "indeclinable; opens a teaching", "A notebook opened beside a lamp at dawn", YS(1)],
  ["sanskrit", "योग", "yoga", "yoking, union; disciplined stillness", "masc. a-stem, from √yuj (to yoke)", "A wooden yoke over two oxen", YS(1)],
  ["sanskrit", "अनुशासन", "anuśāsana", "instruction, teaching handed on", "neut. a-stem; anu- (after) + śāsana (teaching)", "A teacher's chalk letters, copied line by line", YS(1)],
  ["sanskrit", "चित्त", "citta", "the mind, the field of thought and feeling", "neut. a-stem, from √cit (to perceive)", "A mountain lake reflecting the pines", YS(2)],
  ["sanskrit", "वृत्ति", "vṛtti", "turning; a movement of the mind", "fem. i-stem, from √vṛt (to turn)", "Rings spreading from one raindrop on a pond", YS(2)],
  ["sanskrit", "निरोध", "nirodha", "stilling, restraint", "masc. a-stem; ni- + √rudh (to hold back)", "River stones damming a pool until the water clears", YS(2)],
  ["sanskrit", "तदा", "tadā", "then, at that time", "adverb; answers yadā (when)", "The moment a bell's ring fades into silence", YS(3)],
  ["sanskrit", "द्रष्टृ", "draṣṭṛ", "the seer, the witness", "masc. agent noun in -tṛ, from √dṛś (to see); gen. sg. draṣṭuḥ", "Someone on a ridge watching clouds cross a valley", YS(3)],
  ["sanskrit", "स्वरूप", "svarūpa", "own form, true nature", "neut. a-stem; sva (own) + rūpa (form); loc. sg. svarūpe", "Pebbles seen clearly through still spring water", YS(3)],
  ["sanskrit", "अवस्थान", "avasthāna", "abiding, resting in place", "neut. a-stem; ava- + √sthā (to stand)", "An old cedar rooted on a granite ledge", YS(3)],
  ["sanskrit", "सारूप्य", "sārūpya", "taking the same form, likeness", "neut. abstract noun from sa-rūpa (same form)", "A clear crystal glowing red beside a red flower", YS(4)],
  ["sanskrit", "इतरत्र", "itaratra", "otherwise, at other times", "adverb; itara (other) + -tra (in)", "A busy street after a quiet morning", YS(4)],
  ["sanskrit", "शासन", "śāsana", "teaching, command", "neut. a-stem, from √śās (to teach); in anuśāsana", "A hand pointing out the way on a map", YS(1)],
  ["sanskrit", "स्व", "sva", "own, one's self", "pronominal adjective; in svarūpa", "Your own reflection in a window", YS(3)],
  ["sanskrit", "रूप", "rūpa", "form, shape, appearance", "neut. a-stem; in svarūpa and sārūpya", "Clay taking shape on a potter's wheel", YS(3)],
  ["sanskrit", "इतर", "itara", "other", "pronominal adjective; in itaratra", "One shoe among a row of others", YS(4)],
  ["sanskrit", "युज्", "yuj", "to yoke, to join", "verbal root √yuj; gives yoga", "Hands buckling a harness", YS(1)],
  ["sanskrit", "वृत्", "vṛt", "to turn, to roll", "verbal root √vṛt; gives vṛtti", "A potter's wheel turning", YS(2)],
  ["sanskrit", "रुध्", "rudh", "to hold back, to obstruct", "verbal root √rudh; gives nirodha", "A gate closing across a stream", YS(2)],
  ["sanskrit", "दृश्", "dṛś", "to see", "verbal root √dṛś; gives draṣṭṛ", "An eye looking through a telescope", YS(3)],
  ["sanskrit", "स्था", "sthā", "to stand, to stay", "verbal root √sthā; gives avasthāna", "A heron standing still in shallow water", YS(3)],
  ["spanish", "el agua", "el A-gwa", "water", "feminine, but el in the singular before a stressed a (las aguas)", "Cold water poured into a glass"],
  ["spanish", "el pan", "el pahn", "bread", "masculine; plural los panes", "A crusty loaf on a wooden board"],
  ["spanish", "la casa", "la KA-sa", "house, home", "feminine; plural las casas", "A small house with its porch light on"],
  ["spanish", "el sol", "el sol", "sun", "masculine; plural los soles", "The sun rising over a meadow"],
  ["spanish", "la luna", "la LOO-na", "moon", "feminine", "A crescent moon in an evening sky"],
  ["spanish", "el árbol", "el AR-bol", "tree", "masculine; plural los árboles", "A wide walnut tree throwing shade"],
  ["spanish", "la mano", "la MA-no", "hand", "feminine, though it ends in -o (las manos)", "Two hands around a warm mug"],
  ["spanish", "el corazón", "el ko-ra-SON", "heart", "masculine; plural los corazones", "A hand over a beating heart"],
  ["spanish", "la montaña", "la mon-TA-nya", "mountain", "feminine; ñ as the ny in canyon", "A snowy peak in evening light"],
  ["spanish", "el perro", "el PE-rro", "dog", "masculine; la perra for a female dog", "A dog waiting by the door"],
  ["spanish", "el libro", "el LEE-bro", "book", "masculine; plural los libros", "An open book on a table"],
  ["spanish", "la mesa", "la ME-sa", "table", "feminine; plural las mesas", "A kitchen table set for two"],
  ["spanish", "la puerta", "la PWER-ta", "door", "feminine; plural las puertas", "A blue door, half open"],
  ["spanish", "el camino", "el ka-MEE-no", "path, way", "masculine; plural los caminos", "A dirt path through tall grass"],
  ["spanish", "comer", "ko-MER", "to eat", "regular -er verb: como, comes, come", "A fork lifting a bite of food"],
  ["spanish", "beber", "be-BER", "to drink", "regular -er verb: bebo, bebes, bebe", "Someone drinking from a water bottle"],
  ["spanish", "caminar", "ka-mee-NAR", "to walk", "regular -ar verb: camino, caminas, camina", "Boots walking down a leafy path"],
  ["spanish", "escuchar", "es-koo-CHAR", "to listen", "regular -ar verb; oír is to hear", "A hand cupped behind an ear"],
  ["spanish", "despacio", "des-PA-syo", "slowly", "adverb; habla despacio, por favor", "A turtle crossing a log"],
  ["spanish", "rojo", "RRO-ho", "red", "adjective: rojo, roja, rojos, rojas", "A red apple on a white plate"],
];

/** The starter words as records: the path, the fields, an empty body. */
export function starterWords(): { path: string; types: string[]; fields: Record<string, string>; body: string }[] {
  return STARTER.map(([language, word, translit, gloss, grammar, cue, from]) => {
    const w: WordData = { language, word, translit, gloss, grammar, memory: null, cue, picture: null, sound: null, from: from ?? null };
    return { path: wordPathFor(w), types: ["word"], fields: wordFields(w), body: "" };
  });
}

// ── end pure ──

const CSS = `
.lang-summary { margin: 0 0 var(--gap); font: var(--fs-body)/1.45 var(--sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.lang-specimen { margin: 0 0 var(--gap); }
.lang-deva { margin: 0; font: var(--title-weight) var(--fs-display)/1.5 var(--serif); color: var(--text); overflow-wrap: anywhere; }
.lang-big { margin: 0; font: var(--title-weight) var(--fs-title)/1.25 var(--serif); color: var(--text); overflow-wrap: anywhere; }
.lang-translit { margin: 2px 0 0; font: italic var(--fs-lead)/1.4 var(--serif); color: var(--muted); overflow-wrap: anywhere; }
.lang-kicker { margin: 0 0 4px; font: 600 var(--fs-label) var(--sans); letter-spacing: var(--label-track); text-transform: var(--label-transform); font-variant-caps: var(--label-caps); color: var(--label-ink); }
.lang-prompt { margin: 0 0 var(--gap); font: italic var(--fs-small)/1.4 var(--serif); color: var(--muted); }
.lang-cue { margin: 0 0 8px; padding: calc(var(--pad) * .8) var(--pad); border-left: var(--line-quote); background: var(--tint); border-radius: var(--radius-field); font: var(--fs-lead)/1.5 var(--serif); color: var(--text); }
.lang-memory { margin: 0; padding: 2px 0 2px 12px; border-left: var(--line-quote); font: italic var(--fs-body)/1.5 var(--serif); color: var(--text); }
.lang-media { margin: 0 0 var(--gap); }
.lang-pic { display: block; width: 100%; max-width: 480px; height: auto; max-height: 220px; object-fit: cover; border-radius: var(--radius-field); background: var(--tint); }
.lang-audio { display: block; width: 100%; max-width: 420px; }
.lang-block { margin: 0 0 var(--gap); }
.lang-text { margin: 0; font: var(--fs-body)/1.5 var(--serif); color: var(--text); overflow-wrap: anywhere; }
.lang-muted { margin: 4px 0 0; font: var(--fs-small)/1.45 var(--sans); color: var(--muted); }
.lang-divider { margin: var(--gap) 0; border: 0; border-top: var(--line-head); }
.lang-rate { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: var(--gap); }
.lang-rate button { width: 100%; min-height: 48px; flex-direction: column; gap: 2px; padding: 6px 4px; }
.lang-ivl { font: var(--fs-label) var(--sans); opacity: .8; font-variant-numeric: tabular-nums; }
.lang-match { margin: 0 0 var(--gap); padding: 6px 10px; border-radius: var(--radius-field); background: var(--tint); font: var(--fs-small)/1.4 var(--sans); color: var(--text); }
.lang-gap { margin-top: var(--gap); }
`;

type WordRec = { rec: AppletRecord; data: WordData };
type CardRec = { rec: AppletRecord; sm2: Sm2Card; word: string; language: string; ask: Ask; days: string[] };
type Media = { name: string; type: string; bytes: ArrayBuffer; url: string };

/** A picture or sound attached to a word, as a blob: URL (vault.file); `local` is one just added on this device. */
function useMedia(id: string | undefined, path: string | null | undefined, local?: string): { url: string | null; missing: boolean } {
  const [got, setGot] = useState<{ url: string | null; missing: boolean }>({ url: local ?? null, missing: false });
  useEffect(() => {
    if (local) { setGot({ url: local, missing: false }); return; }
    if (!id || !path) { setGot({ url: null, missing: false }); return; }
    if (typeof vault.file !== "function") { setGot({ url: null, missing: true }); return; }
    let on = true, url: string | null = null;
    setGot({ url: null, missing: false });
    vault.file(id, path).then((blob: Blob) => { if (!on) return; url = URL.createObjectURL(blob); setGot({ url, missing: false }); }, () => { if (on) setGot({ url: null, missing: true }); });
    return () => { on = false; if (url) URL.revokeObjectURL(url); };
  }, [id, path, local]);
  return got;
}

/** Every record in a folder, oldest first (so new cards come in the order they were made), as far as the kit pages
 *  (5,000 on): `whole` says it read them all. */
async function readAll(pathPrefix: string, includeBody: boolean): Promise<{ rows: AppletRecord[]; whole: boolean }> {
  const all: AppletRecord[] = [];
  let ordered = true;
  for (let offset = 0; offset <= 5000; offset += 50) {
    let page: AppletRecord[];
    try {
      page = await vault.queryRecords({ pathPrefix, includeFields: true, includeBody, limit: 50, offset, ...(ordered ? { orderBy: "created_at", sort: "asc" } : {}) });
    } catch (e) {
      // an older hub can't order by created_at: newest changed first, then
      if (offset > 0 || !ordered) throw e;
      ordered = false;
      page = await vault.queryRecords({ pathPrefix, includeFields: true, includeBody, limit: 50, offset });
    }
    all.push(...page);
    if (page.length < 50) return { rows: all, whole: true };
  }
  return { rows: all, whole: false };
}

const conflict = (e: unknown) => (e as { status?: number })?.status === 409 || /conflict|already exists/i.test(String((e as Error)?.message ?? e));

const today = () => when.stamp(Date.now()).slice(0, 10);
const storage = (p: string) => (p.startsWith("/api/storage/") ? p : `/api/storage/${p.replace(/^\/+/, "")}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The word large, with its transliteration: Devanagari and IAST together for Sanskrit. */
function Specimen({ w }: { w: WordData }) {
  if (langKey(w.language) === "sanskrit") {
    const p = sanskritPair(w.word, w.translit);
    return <div className="lang-specimen"><p className="lang-deva" lang="sa-Deva">{p.deva}</p><p className="lang-translit">{p.iast}</p></div>;
  }
  return <div className="lang-specimen"><p className="lang-big" lang={htmlLang(w.language)}>{w.word}</p>{w.translit && <p className="lang-translit">{w.translit}</p>}</div>;
}

function From({ w, path }: { w: WordData; path: string }) {
  if (!w.from) return null;
  const p = fromPath(w.from);
  return <p className="lang-text">{p ? <Link to={`[[${p}]]`} from={path}>{fromLabel(p)}</Link> : w.from}</p>;
}

export default function Languages() {
  const [words, setWords] = useState<WordRec[] | null>(null);
  const [cards, setCards] = useState<CardRec[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [tab, setTab] = useSaved<"today" | "words">("tab", "today");
  const [langFilter, setLangFilter] = useSaved<string>("lang", "all");
  const [query, setQuery] = useState("");
  const [openWordId, setOpenWordId] = useSaved<string | null>("word", null);
  // a review: the cards left, in order (null: not reviewing)
  const [queue, setQueue] = useState<string[] | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [cardOpen, setCardOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [seeding, setSeeding] = useState(false);
  // pictures and sounds added on this device, shown at once
  const [local, setLocal] = useState<Record<string, string>>({});
  const localRef = useRef(local);
  localRef.current = local;
  useEffect(() => () => { for (const u of Object.values(localRef.current)) URL.revokeObjectURL(u); }, []);
  const day = today();

  const making = useRef(false);
  /** Each word's missing cards, made: for a word added here, by Library or by Uni. */
  const makeCards = useCallback(async (ws: WordRec[], cs: CardRec[]): Promise<number> => {
    if (making.current) return 0;
    making.current = true;
    let made = 0;
    try {
      const have = new Set(cs.map((c) => c.rec.path.normalize("NFC")));
      for (const w of ws) {
        for (const c of missingCards(w.data, w.rec.path.normalize("NFC"), today(), have)) {
          try {
            await vault.createRecord({ path: c.path, types: ["card"], fields: c.fields, body: c.body });
            made++;
          } catch (e) {
            // there already (another device made it): read on the next load. Anything else stops here, said once.
            if (conflict(e)) continue;
            toast(`Cards for ${w.data.word} couldn't be made: ${e instanceof Error ? e.message : String(e)}`, { error: true });
            return made;
          }
        }
      }
    } finally {
      making.current = false;
    }
    return made;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [wr, cr] = await Promise.all([readAll(WORDS, false), readAll(CARDS, true)]);
      const ws = wr.rows.map((rec) => ({ rec, data: wordFromRecord(rec) }));
      const t = today();
      const cs = cr.rows.map((rec): CardRec => {
        const f = rec.fields ?? {};
        const ask = ASKS.includes(f.ask as Ask) ? (f.ask as Ask) : "word-to-meaning";
        const word = typeof f.word === "string" ? f.word.normalize("NFC") : "";
        return { rec, sm2: sm2FromFields(f, t), word, language: langKey(typeof f.language === "string" ? f.language : rec.path.slice(CARDS.length).split("/")[0] ?? ""), ask, days: reviewDays(rec.body) };
      });
      setWords(ws);
      setCards(cs);
      setLoadError(null);
      // with more than the kit reads, a word's cards may be there unread: none are made then
      if (wr.whole && cr.whole && await makeCards(ws, cs)) return load();
    } catch (e) {
      setLoadError(e);
    }
  }, [makeCards]);

  useEffect(() => {
    void ready().then(load);
    return onOpen((o) => {
      if (o.note.path.startsWith(CARDS)) { setOpenWordId(null); setQueue([o.note.id]); setRevealed(false); setTyped(""); }
      else { setQueue(null); setOpenWordId(o.note.id); }
    });
  }, [load, setOpenWordId]);

  const wordById = useMemo(() => new Map((words ?? []).map((w) => [w.rec.id, w])), [words]);
  const wordByPath = useMemo(() => new Map((words ?? []).map((w) => [w.rec.path.normalize("NFC"), w])), [words]);
  const wordByKey = useMemo(() => new Map((words ?? []).map((w) => [wordKey(w.data), w])), [words]);
  const cardById = useMemo(() => new Map((cards ?? []).map((c) => [c.rec.id, c])), [cards]);
  /** Each word's cards, by the word's path: a row of the list asks once, not of every card. */
  const cardsByWord = useMemo(() => {
    const m = new Map<string, CardRec[]>();
    for (const c of cards ?? []) { const l = m.get(c.word); if (l) l.push(c); else m.set(c.word, [c]); }
    return m;
  }, [cards]);
  const due = useMemo(() => dueToday((cards ?? []).filter((c) => wordByPath.has(c.word)).map((c) => ({ id: c.rec.id, word: c.word, language: c.language, sm2: c.sm2, days: c.days })), day), [cards, wordByPath, day]);
  const dueIds = useMemo(() => new Set(due.map((c) => c.id)), [due]);
  const languages = useMemo(() => {
    const set = new Set(["sanskrit", "spanish"]);
    for (const w of words ?? []) set.add(w.data.language);
    return [...set].map((lang) => {
      const d = due.filter((c) => c.language === lang);
      return { lang, words: (words ?? []).filter((w) => w.data.language === lang).length, due: d.length, fresh: d.filter((c) => c.sm2.state === "new").length };
    });
  }, [words, due]);

  const openWord = openWordId ? wordById.get(openWordId) ?? null : null;
  const current = queue?.length ? cardById.get(queue[0]) ?? null : null;
  const currentWord = current ? wordByPath.get(current.word) ?? null : null;
  // once cards and words are read, a card in the queue that isn't there, or whose word isn't, is passed over
  useEffect(() => { if (queue?.length && cards && words && (!current || !currentWord)) setQueue((q) => (q ?? []).slice(1)); }, [queue, cards, words, current, currentWord]);

  const endReview = useCallback(() => { setQueue(null); setRevealed(false); setTyped(""); }, []);
  const closeWord = useCallback(() => setOpenWordId(null), [setOpenWordId]);
  useEffect(() => (queue !== null ? onBack(endReview) : openWordId ? onBack(closeWord) : undefined), [queue, openWordId, endReview, closeWord]);
  useEffect(() => { window.scrollTo(0, 0); }, [queue === null, openWordId, current?.rec.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startReview = (ids: string[]) => {
    if (!ids.length) { toast("Nothing due."); return; }
    setOpenWordId(null);
    setReviewed(0);
    setQueue(ids);
    setRevealed(false);
    setTyped("");
  };

  /** An answer being written: a second tap or key before the screen redraws is not a second answer. */
  const answering = useRef(false);
  const rate = useCallback(async (rating: Rating) => {
    if (!current || answering.current) return;
    answering.current = true;
    setBusy(true);
    try {
      const at = new Date().toISOString(), stamp = when.stamp(Date.now());
      /** This answer on the card as `rec` has it: its schedule, its line, and the write. */
      const answer = async (rec: AppletRecord) => {
        const res = scheduleCard(sm2FromFields(rec.fields ?? {}, today()), rating, today(), at);
        const fields = { state: res.card.state, due: res.card.due, interval: res.card.interval, ease: res.card.ease, reps: res.card.reps, lapses: res.card.lapses, last_reviewed: at };
        const body = appendReviewLine(rec.body ?? "", formatReviewLine(res, stamp));
        const saved = await vault.updateRecord(rec.id, { if_updated_at: rec.updatedAt ?? "", body, fields });
        return { res, rec: { ...rec, updatedAt: saved.updatedAt, body, fields: { ...rec.fields, ...fields } } };
      };
      let done: Awaited<ReturnType<typeof answer>>;
      try {
        done = await answer(current.rec);
      } catch (e) {
        // changed since it was read (another device reviewed it, or Vault): this answer goes on the card as it is now
        if (!conflict(e)) throw e;
        const fresh = await vault.getRecord(current.rec.id);
        if (!fresh?.updatedAt) throw e;
        if ((fresh.fields?.last_reviewed ?? null) !== (current.rec.fields?.last_reviewed ?? null)) {
          // answered on another device since: that answer stands, and this one isn't added on top of it
          const sm2 = sm2FromFields(fresh.fields ?? {}, today());
          setCards((cs) => (cs ?? []).map((c) => (c.rec.id === fresh.id ? { ...c, rec: fresh, sm2, days: reviewDays(fresh.body) } : c)));
          setQueue((q) => (q ?? []).slice(1));
          setRevealed(false);
          setTyped("");
          toast("This card was just answered on another device. On to the next.");
          return;
        }
        done = await answer(fresh);
      }
      const res = done.res;
      const next: CardRec = { ...current, rec: done.rec, sm2: res.card, days: reviewDays(done.rec.body) };
      setCards((cs) => (cs ?? []).map((c) => (c.rec.id === next.rec.id ? next : c)));
      setReviewed((n) => n + 1);
      // again today (Again, or Hard on a new card): a few cards on, as Anki's learning steps
      setQueue((q) => { const rest = (q ?? []).slice(1); return res.card.interval === 0 ? [...rest.slice(0, 3), next.rec.id, ...rest.slice(3)] : rest; });
      setRevealed(false);
      setTyped("");
    } catch (e) {
      toast(`The review wasn't saved: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      answering.current = false;
      setBusy(false);
    }
  }, [current]);

  // Space or Enter shows the answer; 1–4 rate it
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as Element | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      if (!revealed && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setRevealed(true); return; }
      const r = ({ "1": "again", "2": "hard", "3": "good", "4": "easy" } as Record<string, Rating>)[e.key];
      if (revealed && r) { e.preventDefault(); void rate(r); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, revealed, rate]);

  const shown = currentWord ?? openWord;
  const pic = useMedia(shown?.rec.id, shown?.data.picture, shown?.data.picture ? local[shown.data.picture] : undefined);
  const sound = useMedia(shown?.rec.id, shown?.data.sound, shown?.data.sound ? local[shown.data.sound] : undefined);

  /** Attach a file to a word, write its field (and the picture into its body), and keep it on screen at once. */
  const attachTo = async (w: WordRec, kind: "picture" | "sound", m: { bytes: ArrayBuffer; type: string }) => {
    const up = await vault.attach(w.rec.id, m.bytes, m.type, { transcribe: false });
    const at = storage(up.path);
    const fresh = await vault.getRecord(w.rec.id);
    if (!fresh?.updatedAt) throw new Error("the word couldn't be read");
    await vault.updateRecord(w.rec.id, {
      if_updated_at: fresh.updatedAt,
      fields: { [kind]: at },
      ...(kind === "picture" ? { body: withPicture(fresh.body ?? "", at, w.data.cue || w.data.gloss || w.data.word) } : {}),
    });
    setLocal((l) => ({ ...l, [at]: URL.createObjectURL(new Blob([m.bytes], { type: m.type })) }));
  };

  const pickPicture = async (): Promise<Media | null> => {
    const files = await app.pick({ accept: "image/*", multiple: false });
    const f = files[0];
    return f ? { name: f.name, type: f.type, bytes: f.bytes, url: URL.createObjectURL(new Blob([f.bytes], { type: f.type })) } : null;
  };

  const saveField = async (w: WordRec, name: string, value: unknown) => {
    const fresh = await vault.getRecord(w.rec.id);
    if (!fresh?.updatedAt) throw new Error("the word couldn't be read");
    const v = typeof value === "string" ? value.trim() : value;
    const saved = await vault.updateRecord(w.rec.id, { if_updated_at: fresh.updatedAt, fields: { [name]: v === "" ? null : v } });
    const fields: Record<string, unknown> = { ...(fresh.fields ?? {}), [name]: v };
    if (v === "" || v === null) delete fields[name];
    const rec: AppletRecord = { ...fresh, updatedAt: saved.updatedAt, fields };
    setWords((ws) => ws?.map((x) => (x.rec.id === rec.id ? { rec, data: wordFromRecord(rec) } : x)) ?? ws);
  };

  const seed = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      let n = 0;
      for (const r of starterWords()) {
        if (wordByPath.has(r.path) || wordByKey.has(wordKey(wordFromRecord(r)))) continue;
        await vault.createRecord(r);
        n++;
      }
      await load();
      toast(`${plural(n, "word")} added, with their cards.`);
    } catch (e) {
      toast(`The starter words weren't all added: ${e instanceof Error ? e.message : String(e)}`, { error: true });
      await load();
    } finally {
      setSeeding(false);
    }
  };

  // ── Review ──
  if (queue !== null) {
    if (!cards || !words || (queue.length > 0 && (!current || !currentWord))) {
      return <Page title="Review" back={{ label: "Today", onPress: endReview }}><Loading /></Page>;
    }
    if (!current || !currentWord) {
      return (
        <Page title="Review" kicker={when.date(Date.now())} back={{ label: "Today", onPress: endReview }}>
          <style>{CSS}</style>
          <Card title="Done for now">
            <p className="lang-text">{reviewed ? `${plural(reviewed, "card")} reviewed.` : "Nothing left to review."} {due.length ? `${due.length} more due today.` : "Nothing else is due today."}</p>
            <div className="pa-actions lang-gap">
              <Button kind="primary" onClick={endReview}>Back to Today</Button>
              {due.length > 0 && <Button onClick={() => startReview(due.map((c) => c.id))}>Keep going ({due.length})</Button>}
            </div>
          </Card>
        </Page>
      );
    }
    const w = currentWord.data;
    const face = cardFace(current.ask, w);
    const ivl = previewIntervals(current.sm2, day);
    const ok = revealed && face.typed && typed.trim() ? answersMatch(typed, face.typed.expected) : null;
    return (
      <Page title={langName(w.language)} kicker={`${queue.length} left · ${face.label}`} back={{ label: "Today", onPress: endReview }}
        aside={<Button kind="quiet" small onClick={() => { setQueue(null); setOpenWordId(currentWord.rec.id); }}>Open word</Button>}>
        <style>{CSS}</style>
        <Card>
          <p className="lang-prompt">{face.prompt}</p>
          {face.picture && (pic.url ? <div className="lang-media"><img className="lang-pic" width={480} height={300} src={pic.url} alt="" /></div>
            : pic.missing ? <p className="lang-cue">{w.cue ?? w.gloss}</p> : <Loading />)}
          {face.audio && (sound.url ? <div className="lang-media"><audio className="lang-audio" controls autoPlay src={sound.url} /></div> : (sound.missing ? <p className="lang-muted">This Parachute can't play the sound yet.</p> : <Loading />))}
          {face.big && <p className={face.bigLang === "sa-Deva" ? "lang-deva" : "lang-big"} lang={face.bigLang}>{face.big}</p>}
          {face.small && <p className="lang-translit">{face.small}</p>}
          {face.cue && <p className="lang-cue">{face.cue}</p>}
          {!revealed && face.typed && (
            <div className="lang-gap">
              <Field label="Type it (optional)" placeholder={face.typed.placeholder} value={typed} onChange={setTyped} action="Check" onAction={() => setRevealed(true)} clearOnAction={false} />
            </div>
          )}
          {!revealed ? (
            <div className="pa-actions lang-gap"><Button kind="primary" onClick={() => setRevealed(true)}>Show answer</Button></div>
          ) : (
            <>
              <hr className="lang-divider" />
              {ok !== null && <p className="lang-match">{ok ? "Right." : `You wrote “${typed.trim()}”.`}</p>}
              {current.ask !== "word-to-meaning" && <Specimen w={w} />}
              {!face.picture && pic.url && <div className="lang-media"><img className="lang-pic" width={480} height={300} src={pic.url} alt="" /></div>}
              {!face.audio && sound.url && <div className="lang-media"><audio className="lang-audio" controls src={sound.url} /></div>}
              {w.gloss && <div className="lang-block"><p className="lang-kicker">Meaning</p><p className="lang-text">{w.gloss}</p></div>}
              {w.grammar && <div className="lang-block"><p className="lang-kicker">Grammar</p><p className="lang-text">{w.grammar}</p></div>}
              {w.memory && <div className="lang-block"><p className="lang-kicker">My memory</p><p className="lang-memory">{w.memory}</p></div>}
              {w.from && <div className="lang-block"><p className="lang-kicker">Where I met it</p><From w={w} path={currentWord.rec.path} /></div>}
              <div className="lang-rate" role="group" aria-label="How well did you know it?">
                {(["again", "hard", "good", "easy"] as const).map((r) => (
                  <Button key={r} kind={r === "good" ? "primary" : "plain"} disabled={busy} onClick={() => void rate(r)} aria-label={`${RATING_LABEL[r]}, next in ${formatInterval(ivl[r])}`}>
                    <span>{RATING_LABEL[r]}</span><span className="lang-ivl">{formatInterval(ivl[r])}</span>
                  </Button>
                ))}
              </div>
            </>
          )}
        </Card>
      </Page>
    );
  }

  // ── Word ──
  if (openWord) {
    const w = openWord.data;
    const sk = langKey(w.language) === "sanskrit";
    const its = [...(cardsByWord.get(openWord.rec.path.normalize("NFC")) ?? [])].sort((a, b) => ASKS.indexOf(a.ask) - ASKS.indexOf(b.ask));
    const open = cardOpen ? cardById.get(cardOpen) ?? null : null;
    return (
      <Page title={sk ? sanskritPair(w.word, w.translit).deva : w.word} kicker={langName(w.language)} back={{ label: "Words", onPress: closeWord }} onRefresh={load}
        aside={its.some((c) => dueIds.has(c.rec.id)) ? <Button kind="primary" small onClick={() => startReview(its.filter((c) => dueIds.has(c.rec.id)).map((c) => c.rec.id))}>Review</Button> : undefined}>
        <style>{CSS}</style>
        <p className="lang-translit lang-specimen">{sk ? sanskritPair(w.word, w.translit).iast : w.translit}</p>
        {pic.url ? <div className="lang-media"><img className="lang-pic" width={480} height={300} src={pic.url} alt={w.cue ?? ""} /></div>
          : w.picture ? (pic.missing ? <p className="lang-muted">This Parachute can't show the picture yet.</p> : <Loading />)
          : w.cue ? <p className="lang-cue">Picture idea: {w.cue}</p> : <p className="lang-muted">No picture yet: one of your own works best.</p>}
        {sound.url && <div className="lang-media"><audio className="lang-audio" controls src={sound.url} /></div>}
        <div className="pa-actions">
          <Button small onClick={() => void pickPicture().then(async (m) => {
            if (!m) return;
            try { await attachTo(openWord, "picture", m); await load(); toast("Picture attached."); }
            catch (e) { toast(`The picture wasn't attached: ${e instanceof Error ? e.message : String(e)}`, { error: true }); }
            finally { URL.revokeObjectURL(m.url); }
          })}>{w.picture ? "Change picture" : "Add a picture"}</Button>
          <VoiceRecord small max_s={20} label="Record how it sounds" onRecorded={async (r) => {
            try { await attachTo(openWord, "sound", r); await load(); toast("Sound saved."); }
            catch (e) { toast(`The sound wasn't saved: ${e instanceof Error ? e.message : String(e)}`, { error: true }); }
          }}>{w.sound ? "Record again" : "Record its sound"}</VoiceRecord>
        </div>
        {w.from && <div className="lang-block lang-gap"><p className="lang-kicker">Where I met it</p><From w={w} path={openWord.rec.path} /></div>}
        <Fields
          label="The word"
          fields={[
            { name: "translit", label: sk ? "IAST" : "Sounds like", value: w.translit ?? "" },
            { name: "gloss", label: "Meaning", value: w.gloss },
            { name: "grammar", label: "Grammar", kind: "long", value: w.grammar ?? "" },
            { name: "memory", label: "My memory", kind: "long", value: w.memory ?? "" },
            { name: "cue", label: "Picture idea", value: w.cue ?? "" },
            { name: "from", label: "Where I met it", value: w.from ?? "" },
          ]}
          onSave={(name, value) => saveField(openWord, name, value).catch((e) => { toast(`Not saved: ${e instanceof Error ? e.message : String(e)}`, { error: true }); throw e; })}
        />
        <List
          label={`Cards · ${its.length}`}
          rows={its.map((c) => ({
            key: c.rec.id,
            title: askLabel(c.ask, w.language),
            meta: c.sm2.state === "new" ? "new" : `${c.sm2.interval ? `every ${formatInterval(c.sm2.interval)}` : c.sm2.state} · ease ${c.sm2.ease.toFixed(2)}${c.sm2.lapses ? ` · ${plural(c.sm2.lapses, "lapse")}` : ""}`,
            aside: dueIds.has(c.rec.id) ? "due" : c.sm2.state === "new" ? "waiting" : when.short(c.sm2.due),
            onPress: () => setCardOpen(c.rec.id),
          }))}
        />
        <Drawer open={open !== null} onClose={() => setCardOpen(null)} title={open ? askLabel(open.ask, w.language) : undefined}>
          {open && (
            <>
              <p className="lang-text">{open.sm2.state === "new" ? "Not studied yet." : `${open.sm2.state === "review" ? "Due" : open.sm2.state === "learning" ? "Learning, due" : "Relearning, due"} ${when.short(open.sm2.due)}${open.sm2.interval ? ` · every ${formatInterval(open.sm2.interval)}` : ""} · ease ${open.sm2.ease.toFixed(2)} · ${plural(open.sm2.lapses, "lapse")}`}</p>
              <div className="pa-actions lang-gap"><Button kind="primary" onClick={() => { setCardOpen(null); startReview([open.rec.id]); }}>Review this card</Button></div>
              {open.days.length > 0 && <List label="Reviews" rows={(open.rec.body ?? "").split("\n").filter((l) => /^- \d{4}-/.test(l)).reverse().map((l, i) => ({ key: String(i), title: l.slice(2) }))} />}
            </>
          )}
        </Drawer>
      </Page>
    );
  }

  // ── Today and Words ──
  const q = query.trim().toLowerCase();
  const listed = (words ?? []).filter((w) => (langFilter === "all" || w.data.language === langFilter)
    && (!q || [w.data.word, w.data.translit ?? "", w.data.gloss, w.data.from ?? ""].some((s) => s.toLowerCase().includes(q))))
    .sort((a, b) => a.data.language.localeCompare(b.data.language) || (a.data.translit ?? a.data.word).localeCompare(b.data.translit ?? b.data.word));
  const reviewTimes = (cards ?? []).flatMap((c) => c.days);

  return (
    <Page title="Languages" kicker={when.date(Date.now())} onRefresh={load} aside={<Button kind="primary" small onClick={() => setAdding(true)}>Add a word</Button>}>
      <style>{CSS}</style>
      <Tabs label="Sections" tabs={[{ key: "today", label: "Today", count: due.length }, { key: "words", label: "Words", count: words?.length ?? 0 }]} current={tab} onChange={(k) => setTab(k as "today" | "words")} />
      {loadError ? (
        <Problem error={loadError} onRetry={() => void load()}>Your words couldn't be read.</Problem>
      ) : words === null || cards === null ? (
        <Loading>Reading your words…</Loading>
      ) : tab === "today" ? (
        words.length === 0 ? (
          <>
            <Empty>No words yet. Add one you met in your reading, or start with twenty-one words from the Yoga Sutras 1.1–1.4 and twenty everyday Spanish words.</Empty>
            <div className="pa-actions">
              <Button kind="primary" busy={seeding} onClick={() => void seed()}>{seeding ? "Adding…" : "Add the starter words"}</Button>
              <Button onClick={() => setAdding(true)}>Add a word</Button>
            </div>
          </>
        ) : (
          <>
            <Card title={due.length ? `${plural(due.length, "card")} to review today` : "Nothing more today"}>
              <p className="lang-summary">{due.length ? languages.filter((l) => l.due).map((l) => `${langName(l.lang)} ${l.due}`).join(" · ") : "Come back tomorrow, or add a word."}</p>
              {due.length > 0 && <div className="pa-actions"><Button kind="primary" onClick={() => startReview(due.map((c) => c.id))}>Review</Button></div>}
            </Card>
            <List label="By language" rows={languages.filter((l) => l.words).map((l) => ({
              key: l.lang, glyph: langGlyph(l.lang), title: langName(l.lang),
              meta: `${plural(l.words, "word")}${l.fresh ? ` · ${l.fresh} new today` : ""}`,
              aside: l.due ? `${l.due} due` : "done",
              onPress: () => (l.due ? startReview(due.filter((c) => c.language === l.lang).map((c) => c.id)) : (setLangFilter(l.lang), setTab("words"))),
            }))} />
            <Days times={reviewTimes} label="Reviews, the last four weeks" />
          </>
        )
      ) : (
        <>
          <Tabs label="Language" tabs={[{ key: "all", label: "All", count: words.length }, ...languages.filter((l) => l.words).map((l) => ({ key: l.lang, label: langName(l.lang), count: l.words }))]} current={langFilter} onChange={setLangFilter} />
          <div className="lang-gap"><Search label="Search words" placeholder="A word, IAST or meaning" value={query} onChange={setQuery} onSearch={setQuery} live={150} /></div>
          {listed.length === 0 ? <Empty>{q ? `Nothing matches “${query.trim()}”.` : "No words here yet."}</Empty> : (
            <List label={`${langFilter === "all" ? "Words" : langName(langFilter)} · ${listed.length}`} rows={listed.map((w) => {
              const n = (cardsByWord.get(w.rec.path.normalize("NFC")) ?? []).filter((c) => dueIds.has(c.rec.id)).length;
              const sk = w.data.language === "sanskrit" ? sanskritPair(w.data.word, w.data.translit) : null;
              return {
                key: w.rec.id, glyph: langGlyph(w.data.language),
                title: sk ? <><span lang="sa-Deva">{sk.deva}</span> · {sk.iast}</> : <span lang={htmlLang(w.data.language)}>{w.data.word}</span>,
                meta: [w.data.gloss, w.data.from ? fromLabel(w.data.from) : "", w.data.picture ? "picture" : "", w.data.sound ? "sound" : ""].filter(Boolean).join(" · "),
                aside: n ? `${n} due` : undefined,
                onPress: () => setOpenWordId(w.rec.id),
              };
            })} />
          )}
        </>
      )}
      <AddWord open={adding} onClose={() => setAdding(false)} initial={langFilter === "spanish" ? "spanish" : "sanskrit"} pickPicture={pickPicture}
        exists={(w) => wordByPath.get(wordPathFor(w)) ?? wordByKey.get(wordKey(w)) ?? null}
        onAdded={async (id) => { setAdding(false); await load(); setOpenWordId(id); }}
        onLocal={(at, url) => setLocal((l) => ({ ...l, [at]: url }))} />
    </Page>
  );
}

/** The drawer to add a word: the word (IAST or Devanagari for Sanskrit, shown both ways as typed), its meaning, a
 *  picture, its sound, grammar, his memory, and where he met it. Its cards are made once it is saved. */
function AddWord({ open, onClose, initial, pickPicture, exists, onAdded, onLocal }: {
  open: boolean; onClose: () => void; initial: "sanskrit" | "spanish"; pickPicture: () => Promise<Media | null>;
  exists: (w: WordData) => WordRec | null; onAdded: (id: string) => Promise<void>; onLocal: (at: string, url: string) => void;
}) {
  const [lang, setLang] = useState<"sanskrit" | "spanish">(initial);
  const [word, setWord] = useState("");
  const [translit, setTranslit] = useState("");
  const [gloss, setGloss] = useState("");
  const [grammar, setGrammar] = useState("");
  const [memory, setMemory] = useState("");
  const [from, setFrom] = useState("");
  const [picture, setPicture] = useState<Media | null>(null);
  const [sound, setSound] = useState<Media | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setLang(initial); }, [open, initial]);
  const clear = () => {
    for (const m of [picture, sound]) if (m) URL.revokeObjectURL(m.url);
    setWord(""); setTranslit(""); setGloss(""); setGrammar(""); setMemory(""); setFrom(""); setPicture(null); setSound(null);
  };
  const sk = lang === "sanskrit" && word.trim() ? sanskritPair(word) : null;
  const headword = lang === "sanskrit" ? sk?.deva ?? "" : word.trim();

  const save = async () => {
    if (!headword) { toast(lang === "sanskrit" ? "Type the word, in IAST or Devanagari." : "Type the word.", { error: true }); return; }
    const data: WordData = { language: lang, word: headword, translit: (lang === "sanskrit" ? sk?.iast : translit.trim()) || null, gloss: gloss.trim(),
      grammar: grammar.trim() || null, memory: memory.trim() || null, cue: null, picture: null, sound: null, from: from.trim() || null };
    const path = wordPathFor(data);
    const there = exists(data);
    // what was typed, picked and recorded stays in the form: it may be meant for the word that's there
    if (there) { toast(`${headword} is already in your words: open it from Words to add to it.`); return; }
    setSaving(true);
    try {
      const made = await vault.createRecord({ path, types: ["word"], fields: wordFields(data), body: "" });
      try {
        const fields: Record<string, string> = {};
        let body = "";
        for (const [kind, m] of [["picture", picture], ["sound", sound]] as const) {
          if (!m) continue;
          const up = await vault.attach(made.id, m.bytes, m.type, { transcribe: false });
          fields[kind] = storage(up.path);
          onLocal(fields[kind], URL.createObjectURL(new Blob([m.bytes], { type: m.type })));
          if (kind === "picture") body = withPicture("", fields.picture, gloss.trim() || headword);
        }
        if (Object.keys(fields).length) {
          // read again: attaching may have changed the record since it was made
          const fresh = await vault.getRecord(made.id);
          if (!fresh?.updatedAt) throw new Error("the word couldn't be read");
          await vault.updateRecord(made.id, { if_updated_at: fresh.updatedAt, fields, ...(body ? { body } : {}) });
        }
        toast(`${headword} added.`);
      } catch (e) {
        toast(`${headword} was added, but not its picture or sound: ${e instanceof Error ? e.message : String(e)}`, { error: true });
      }
      clear();
      await onAdded(made.id);
    } catch (e) {
      toast(`The word wasn't saved: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Add a word">
      <Tabs label="Language" tabs={[{ key: "sanskrit", label: "Sanskrit" }, { key: "spanish", label: "Spanish" }]} current={lang} onChange={(k) => setLang(k as "sanskrit" | "spanish")} />
      <div className="lang-gap">
        {lang === "sanskrit" ? (
          <>
            <Field label="The word, in IAST or Devanagari" placeholder="citta or चित्त" value={word} onChange={setWord} />
            {sk && <Specimen w={{ language: "sanskrit", word: sk.deva, translit: sk.iast, gloss: "", grammar: null, memory: null, cue: null, picture: null, sound: null, from: null }} />}
          </>
        ) : (
          <>
            <Field label="The word, with its article" placeholder="el agua" value={word} onChange={setWord} />
            <Field label="Sounds like (optional)" placeholder="el A-gwa" value={translit} onChange={setTranslit} />
          </>
        )}
        <Field label="Meaning" placeholder="A few words" value={gloss} onChange={setGloss} />
        <div className="pa-actions">
          <Button small onClick={() => void pickPicture().then((m) => { if (m) { if (picture) URL.revokeObjectURL(picture.url); setPicture(m); } }).catch((e) => toast(String(e), { error: true }))}>{picture ? "Change picture" : "Add a picture"}</Button>
          <VoiceRecord small max_s={20} label="Record how it sounds" onRecorded={(r) => { if (sound) URL.revokeObjectURL(sound.url); setSound({ name: "sound", type: r.type, bytes: r.bytes, url: URL.createObjectURL(new Blob([r.bytes], { type: r.type })) }); }}>{sound ? "Record again" : "Record its sound"}</VoiceRecord>
        </div>
        {picture && <div className="lang-media lang-gap"><img className="lang-pic" width={480} height={300} src={picture.url} alt="" /></div>}
        {sound && <div className="lang-media lang-gap"><audio className="lang-audio" controls src={sound.url} /></div>}
        <Write label="Grammar" labelled placeholder="Gender, stem, root…" value={grammar} onChange={setGrammar} />
        <Write label="My memory" labelled placeholder="A moment or place of your own this word brings back" value={memory} onChange={setMemory} />
        <Field label="Where I met it" placeholder={lang === "sanskrit" ? "Texts/Yoga Sutras/YS 1.2" : "A book, a song, a conversation"} value={from} onChange={setFrom} />
        <div className="pa-actions">
          <Button kind="primary" busy={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save the word"}</Button>
          <Button kind="quiet" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Drawer>
  );
}
