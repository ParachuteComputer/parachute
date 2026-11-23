// People: an applet that feels like your phone's Contacts and grows into much more (docs/PEOPLE.md).
// Records live at People/<Name> with type `person` (parent `entity`).
//
// Existing person fields (never renamed or dropped):
//   relation          "friend" | "family" | "collaborator" | "influence"
//   summary           one-line description of who they are
//   email             primary lower-case email address
//   status            "new" | "active" | "past"
//   ways_of_working   string[] of collaboration notes
//   source            where/how you met or where the record came from
//
// Additive person fields (all plain values or string[] for vault & AI compatibility):
//   phones            string[]  e.g. ["mobile: +1 555-0101", "+1 555-0102"]
//   emails            string[]  additional lower-case emails beyond `email`
//   address           string    postal / street address (lines separated by newlines or commas)
//   birthday          string    "YYYY-MM-DD" or "--MM-DD" when year is unknown
//   links             string[]  web URLs (website, GitHub, etc.)
//   tags              string[]  plain words on fields.tags (NOT vault types or record tags)
//   groups            string[]  group names on the person record (simpler than separate group records:
//                               no extra folder permission, no two-record sync, direct vCard CATEGORIES mapping)
//   photo             string    storage path of an image attached to the record via vault.attach
//   favorite          boolean   true when pinned to Favorites at the top of the list
//   keep_in_touch     string    how often to be in touch: "every week" … "every year" (or a number of days)
//   talked            string[]  times you were in touch with no note of their own: "YYYY-MM-DD" or "YYYY-MM-DD: what"
//   how_we_met        string    the story of how you met
//   met               string    when you met: "YYYY-MM-DD" or "YYYY"
//
// Body: markdown (e.g. "## Memories and moments"), editable in place with device-saved drafts.
// Links: reads links from Meetings/, Journal/, Notes/, Organizations/ and People/ for each person's timeline and the
//        last time you were in touch (the newest `talked` entry or linked note, dated by the note's own day).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  app, Button, Card, Drawer, Empty, Field, Fields, Link, link, List, Loading, Note, onBack, onOpen, Page, Problem,
  ready, Search, still as kitStill, Tabs, toast, useSaved, vault, when, Write,
} from "parachute";

const isStill = kitStill ?? (() => typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue("--t-state").trim() === "0ms");

// ── pure helpers (tested in src/applet/peopleApplet.test.ts) ──

type LinkEnd = {
  id: string;
  path: string | null;
  tags?: string[];
  fields?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PersonLink = {
  sourceId: string;
  targetId: string;
  relationship: string | null;
  fields?: Record<string, unknown>;
  createdAt?: string | null;
  sourceNote?: LinkEnd;
  targetNote?: LinkEnd;
};

type PersonRecord = {
  id: string;
  path: string;
  createdAt?: string | null;
  updatedAt: string | null;
  tags?: string[];
  types?: string[];
  fields?: Record<string, unknown>;
  body?: string;
  links?: PersonLink[];
};

type PersonFields = {
  relation: string;
  summary: string;
  email: string;
  emails: string[];
  phones: string[];
  address: string;
  birthday: string;
  links: string[];
  tags: string[];
  groups: string[];
  photo: string;
  favorite: boolean;
  status: string;
  ways_of_working: string[];
  source: string;
};

type VCardPhoto = {
  mimeType: string;
  bytes: Uint8Array;
};

type VCardContact = {
  name: string;
  phones: string[];
  emails: string[];
  address: string;
  birthday: string;
  links: string[];
  groups: string[];
  tags: string[];
  summary: string;
  note: string;
  photo: VCardPhoto | null;
};

type MatchReason = "email" | "phone" | "name";
type VCardMatch = { person: PersonRecord; by: MatchReason };

type MentionItem = {
  id: string;
  path: string;
  title: string;
  kind: string;
  relationship: string | null;
  date: string | null;
  isPerson: boolean;
};

type UpcomingBirthday = {
  person: PersonRecord;
  name: string;
  birthday: string;
  nextDate: string;
  daysUntil: number;
  turning: number | null;
};

type ReconnectItem = {
  person: PersonRecord;
  name: string;
  lastDate: string | null;
  lastTitle: string | null;
  daysSince: number | null;
};

const NAME = "People";
const FOLDER = "People/";
const RELATIONS = ["friend", "family", "collaborator", "influence"] as const;
const STATUSES = ["new", "active", "past"] as const;
const DAY_MS = 86_400_000;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function strList(v: unknown): string[] {
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === "string" && item.trim()) out.push(item.trim());
      else if (typeof item === "number" && Number.isFinite(item)) out.push(String(item));
      else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const val = str(o.value ?? o.number ?? o.email ?? o.url);
        const lbl = str(o.label ?? o.type);
        if (val) out.push(lbl ? `${lbl}: ${val}` : val);
      }
    }
    return out;
  }
  if (typeof v === "string" && v.trim()) return [v.trim()];
  if (typeof v === "number" && Number.isFinite(v)) return [String(v)];
  return [];
}

/** A field the record doesn't hold at all (absent, null or empty): the only kind a merge fills. */
function unset(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && !v.trim());
}

/** A list field as the record holds it, to add to: every entry kept as written (a number, an object with a label, a
 *  near-duplicate), whatever shape it is in; a single value becomes the list's first entry. */
function heldList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === "") return [];
  return [v];
}

function dedupeStrings(items: string[], keyFn: (s: string) => string = (s) => s.toLowerCase()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const clean = raw.trim();
    if (!clean) continue;
    const k = keyFn(clean);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(clean);
  }
  return out;
}

function personName(r: { path: string }): string {
  return r.path.replace(/^People\//, "").replace(/\.md$/i, "").trim() || r.path;
}

function cleanPersonName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return [...words[0]].slice(0, 2).join("").toUpperCase();
  return `${[...words[0]][0] ?? ""}${[...words[words.length - 1]][0] ?? ""}`.toUpperCase();
}

function letterOf(name: string): string {
  const first = ([...name.trim()][0] ?? "").toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

function readPersonFields(fields?: Record<string, unknown>): PersonFields {
  const f = fields ?? {};
  const primaryEmail = str(f.email).toLowerCase();
  const extraEmails = dedupeStrings(
    strList(f.emails).map((e) => e.toLowerCase()).filter((e) => e !== primaryEmail),
  );
  return {
    relation: str(f.relation).toLowerCase(),
    summary: str(f.summary),
    email: primaryEmail,
    emails: extraEmails,
    phones: dedupeStrings(strList(f.phones), (p) => normalizePhoneKey(p) || p.toLowerCase()),
    address: str(f.address),
    birthday: str(f.birthday),
    links: dedupeStrings(strList(f.links)),
    tags: dedupeStrings(strList(f.tags)),
    groups: dedupeStrings(strList(f.groups)),
    photo: str(f.photo),
    favorite: f.favorite === true,
    status: str(f.status).toLowerCase(),
    ways_of_working: dedupeStrings(strList(f.ways_of_working)),
    source: str(f.source),
  };
}

function allEmailsOf(pf: PersonFields): string[] {
  return dedupeStrings([pf.email, ...pf.emails].filter(Boolean).map((e) => e.toLowerCase()));
}

/** Split an optional "label: value" phone entry into { label, number }. */
function parsePhoneEntry(entry: string): { label: string; number: string } {
  const m = /^([A-Za-z][A-Za-z0-9 _-]{0,20}):\s*(.+)$/.exec(entry.trim());
  if (m) return { label: m[1].trim().toLowerCase(), number: m[2].trim() };
  return { label: "", number: entry.trim() };
}

/** Normalize a phone number to a canonical comparison key (digits only; North American 11-digit 1XXXXXXXXXX -> 10 digits). */
function normalizePhoneKey(raw: string): string {
  const { number } = parsePhoneEntry(raw);
  const digits = number.replace(/\D/g, "");
  if (digits.length < 7) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Days in month m (Feb has 29 when the year is unknown or leap). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function parseYmd(s: string): { y: number | null; m: number; d: number } | null {
  const trimmed = s.trim();
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const noYear = full ? null : /^--(\d{2})-(\d{2})$/.exec(trimmed);
  if (!full && !noYear) return null;
  const y = full ? Number(full[1]) : null;
  const m = Number((full ?? noYear)![full ? 2 : 1]), d = Number((full ?? noYear)![full ? 3 : 2]);
  if (m < 1 || m > 12 || d < 1 || d > MONTH_DAYS[m - 1]) return null;
  if (y !== null && m === 2 && d === 29 && !isLeapYear(y)) return null;
  return { y, m, d };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function birthdayOccurrence(year: number, m: number, d: number): { utc: number; ymd: string } {
  const day = m === 2 && d === 29 && !isLeapYear(year) ? 28 : d;
  return { utc: Date.UTC(year, m - 1, day), ymd: `${year}-${pad2(m)}-${pad2(day)}` };
}

function nextBirthdayInfo(birthday: string, todayYmd: string): { nextDate: string; daysUntil: number; turning: number | null } | null {
  const b = parseYmd(birthday);
  const t = parseYmd(todayYmd);
  if (!b || !t || t.y === null) return null;
  const todayUtc = Date.UTC(t.y, t.m - 1, t.d);
  let occ = birthdayOccurrence(t.y, b.m, b.d);
  let targetYear = t.y;
  if (occ.utc < todayUtc) {
    targetYear = t.y + 1;
    occ = birthdayOccurrence(targetYear, b.m, b.d);
  }
  const daysUntil = Math.round((occ.utc - todayUtc) / DAY_MS);
  const turning = b.y !== null && targetYear >= b.y ? targetYear - b.y : null;
  return { nextDate: occ.ymd, daysUntil, turning };
}

function upcomingBirthdays(people: readonly PersonRecord[], todayYmd: string, windowDays = 60): UpcomingBirthday[] {
  const out: UpcomingBirthday[] = [];
  for (const person of people) {
    const pf = readPersonFields(person.fields);
    if (!pf.birthday) continue;
    const info = nextBirthdayInfo(pf.birthday, todayYmd);
    if (!info || info.daysUntil > windowDays) continue;
    out.push({ person, name: personName(person), birthday: pf.birthday, ...info });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}

function folderKind(path: string): string {
  const top = path.split("/")[0]?.toLowerCase() ?? "";
  if (top === "meetings") return "Meeting";
  if (top === "journal") return "Journal";
  if (top === "organizations") return "Organization";
  if (top === "people") return "Person";
  if (top === "notes") return "Note";
  return top ? `${top[0].toUpperCase()}${top.slice(1)}` : "Note";
}

function cleanNoteTitle(path: string): string {
  const noExt = path.replace(/\.md$/i, "");
  const parts = noExt.split("/");
  return parts.length > 1 ? parts.slice(1).join(" / ") : noExt;
}

/** A YYYY-MM-DD at the head of a value, when it is a real day. */
function ymdOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  if (!m) return null;
  const p = parseYmd(m[1]);
  return p && p.y !== null ? m[1] : null;
}

/** An instant (an ISO time) as the day it fell on here; a bare day stays as written. */
function localYmd(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return ymdOf(v);
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The day a note is about, not the day it was last edited (tidying an old meeting note isn't being in touch): its own
 *  date field, else a date in its path (`Journal/2026-11-10`, `Meetings/2026/10-02 Kiln`), else when it was made. */
function noteDay(end: LinkEnd, linkCreated?: string | null): string | null {
  const f = end.fields ?? {};
  for (const k of ["date", "start", "when", "day"]) {
    const d = ymdOf(f[k]);
    if (d) return d;
  }
  const path = end.path ?? "";
  const full = /(\d{4})[-/](\d{2})[-/](\d{2})/.exec(path);
  if (full) { const d = ymdOf(`${full[1]}-${full[2]}-${full[3]}`); if (d) return d; }
  const yearThenDay = /(\d{4})\/(\d{2})-(\d{2})/.exec(path);
  if (yearThenDay) { const d = ymdOf(`${yearThenDay[1]}-${yearThenDay[2]}-${yearThenDay[3]}`); if (d) return d; }
  return localYmd(end.createdAt) ?? localYmd(linkCreated) ?? localYmd(end.updatedAt);
}

/** Whole days from one YYYY-MM-DD to another (negative when `to` is earlier). */
function daysBetween(fromYmd: string, toYmd: string): number {
  const a = parseYmd(fromYmd), b = parseYmd(toYmd);
  if (!a || !b || a.y === null || b.y === null) return 0;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

function addDays(ymd: string, days: number): string {
  const p = parseYmd(ymd);
  if (!p || p.y === null) return ymd;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d) + days * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

type Talk = { date: string; what: string; entry: string };

/** The `talked` log: entries "YYYY-MM-DD" or "YYYY-MM-DD: what", newest first; an entry with no real day is skipped. */
function talksOf(fields?: Record<string, unknown>): Talk[] {
  const out: Talk[] = [];
  for (const entry of strList(fields?.talked)) {
    const date = ymdOf(entry);
    if (!date) continue;
    const what = entry.slice(10).replace(/^\s*[:·—–-]\s*/, "").trim();
    out.push({ date, what, entry });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** A new `talked` log with one more entry, newest first; the same entry twice is kept once. */
function withTalk(fields: Record<string, unknown> | undefined, date: string, what: string): string[] {
  const entry = what.trim() ? `${date}: ${what.trim().replace(/\s+/g, " ")}` : date;
  const held = strList(fields?.talked);
  const all = held.some((e) => e === entry) ? held : [entry, ...held];
  return [...all].sort((a, b) => (ymdOf(b) ?? "").localeCompare(ymdOf(a) ?? ""));
}

/** How often to be in touch, as a person picks it; stored as the words, so a person or an AI reads it as written. */
const CADENCES = ["every week", "every 2 weeks", "every month", "every 3 months", "every 6 months", "every year"] as const;
const CADENCE_DAYS: Record<string, number> = {
  "every week": 7, weekly: 7, "every 2 weeks": 14, fortnightly: 14, biweekly: 14, "every month": 30, monthly: 30,
  "every 3 months": 91, quarterly: 91, "every 6 months": 182, "twice a year": 182, "every year": 365, yearly: 365, annually: 365,
};

/** A cadence in days: one of the words above, or a number of days (`45`, `"45 days"`); else none. */
function cadenceDays(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 1) return Math.round(v);
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (CADENCE_DAYS[s]) return CADENCE_DAYS[s];
  const n = /^(\d{1,4})(\s*days?)?$/.exec(s);
  return n && Number(n[1]) >= 1 ? Number(n[1]) : null;
}

type Connection = { date: string; title: string; kind: string; id: string | null };

/** The last time you were in touch: the newest of a `talked` entry and a meeting, journal entry or note that links them
 *  (dated by its own day). Another person's card linking them isn't contact. */
function lastConnection(person: PersonRecord): Connection | null {
  let best: Connection | null = null;
  const talk = talksOf(person.fields)[0];
  if (talk) best = { date: talk.date, title: talk.what || "Talked", kind: "Talked", id: null };
  for (const m of mentionsOf(person)) {
    if (m.isPerson || !m.date) continue;
    if (!best || m.date > best.date) best = { date: m.date, title: m.title, kind: m.kind, id: m.id };
    break; // mentions are newest first
  }
  return best;
}

type KeepItem = { person: PersonRecord; name: string; cadence: number; last: Connection | null; dueYmd: string | null; daysLeft: number | null };

/** Who to be in touch with: everyone with a cadence (not "past"), due when the last connection plus the cadence is
 *  today or gone; never in touch counts as due. `soon` is due within the next week. Earliest due first. */
function keepInTouch(people: readonly PersonRecord[], todayYmd: string, soonDays = 7): { due: KeepItem[]; soon: KeepItem[] } {
  const due: KeepItem[] = [];
  const soon: KeepItem[] = [];
  for (const person of people) {
    const cadence = cadenceDays(person.fields?.keep_in_touch);
    if (!cadence || readPersonFields(person.fields).status === "past") continue;
    const last = lastConnection(person);
    const dueYmd = last ? addDays(last.date, cadence) : null;
    const daysLeft = dueYmd ? daysBetween(todayYmd, dueYmd) : null;
    const item = { person, name: personName(person), cadence, last, dueYmd, daysLeft };
    if (daysLeft === null || daysLeft <= 0) due.push(item);
    else if (daysLeft <= soonDays) soon.push(item);
  }
  const order = (a: KeepItem, b: KeepItem) => (a.daysLeft ?? -Infinity) - (b.daysLeft ?? -Infinity) || a.name.localeCompare(b.name);
  return { due: due.sort(order), soon: soon.sort(order) };
}

type Moment = { key: string; date: string | null; title: string; kind: string; id: string | null; isPerson: boolean; detail: string };

/** A person's timeline, newest first: talks, the meetings, journal entries and notes that link them, how you met, and
 *  when they were added. Other people's cards that link them aren't moments: they show as linked people. */
function timelineOf(person: PersonRecord): Moment[] {
  const out: Moment[] = [];
  talksOf(person.fields).forEach((t, i) => out.push({ key: `talk-${i}`, date: t.date, title: t.what || "Talked", kind: "Talked", id: null, isPerson: false, detail: "" }));
  for (const m of mentionsOf(person)) {
    if (m.isPerson) continue;
    out.push({ key: m.id, date: m.date, title: m.title, kind: m.kind, id: m.id, isPerson: false, detail: m.relationship && !/^(wiki)?link$/.test(m.relationship) ? m.relationship : "" });
  }
  const met = ymdOf(person.fields?.met) ?? (/^\d{4}(-\d{2})?$/.test(str(person.fields?.met)) ? str(person.fields?.met) : null);
  const how = str(person.fields?.how_we_met);
  if (met || how) out.push({ key: "met", date: met, title: how || "Met", kind: "Met", id: null, isPerson: false, detail: "" });
  const added = localYmd(person.createdAt);
  if (added) out.push({ key: "added", date: added, title: "Added to People", kind: "Added", id: null, isPerson: false, detail: "" });
  // undated moments last; on one day, a talk before a note before how you met before being added
  const rank = (k: string) => (k === "Talked" ? 0 : k === "Met" ? 2 : k === "Added" ? 3 : 1);
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || rank(a.kind) - rank(b.kind) || a.title.localeCompare(b.title));
}

function mentionsOf(person: PersonRecord): MentionItem[] {
  const links = person.links ?? [];
  const seen = new Set<string>();
  const out: MentionItem[] = [];
  for (const l of links) {
    const isOut = l.sourceId === person.id;
    const other = isOut ? l.targetNote : l.sourceNote;
    const otherId = isOut ? l.targetId : l.sourceId;
    if (!other || !other.path || otherId === person.id || seen.has(otherId)) continue;
    seen.add(otherId);
    const date = noteDay(other, l.createdAt);
    out.push({
      id: otherId,
      path: other.path,
      title: cleanNoteTitle(other.path),
      kind: folderKind(other.path),
      relationship: l.relationship ?? null,
      date,
      isPerson: other.path.startsWith(FOLDER),
    });
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title));
}

/** Everyone else to think of (no cadence of their own, not "past" unless asked): in touch `staleDays` or more ago,
 *  longest first; and those with no connection yet. */
function reconnectList(
  people: readonly PersonRecord[],
  todayYmd: string,
  opts: { staleDays?: number; includePast?: boolean } = {},
): { stale: ReconnectItem[]; unlinked: ReconnectItem[] } {
  const staleDays = opts.staleDays ?? 30;
  const includePast = opts.includePast === true;
  const stale: ReconnectItem[] = [];
  const unlinked: ReconnectItem[] = [];
  for (const person of people) {
    const pf = readPersonFields(person.fields);
    if (!includePast && pf.status === "past") continue;
    if (cadenceDays(person.fields?.keep_in_touch)) continue;
    const last = lastConnection(person);
    if (!last) {
      unlinked.push({ person, name: personName(person), lastDate: null, lastTitle: null, daysSince: null });
      continue;
    }
    const daysSince = Math.max(0, daysBetween(last.date, todayYmd));
    if (daysSince >= staleDays) stale.push({ person, name: personName(person), lastDate: last.date, lastTitle: last.title, daysSince });
  }
  stale.sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0) || a.name.localeCompare(b.name));
  unlinked.sort((a, b) => a.name.localeCompare(b.name));
  return { stale, unlinked };
}

/** How long ago you were last in touch, as the list filters it. */
const SINCE = [
  { key: "week", label: "This week", test: (d: number | null) => d !== null && d <= 7 },
  { key: "month", label: "This month", test: (d: number | null) => d !== null && d <= 30 },
  { key: "quarter", label: "3 months", test: (d: number | null) => d !== null && d <= 91 },
  { key: "older", label: "Longer ago", test: (d: number | null) => d !== null && d > 91 },
  { key: "never", label: "Never", test: (d: number | null) => d === null },
] as const;

/** Days since the last connection, or null for none. */
function daysSinceConnection(person: PersonRecord, todayYmd: string): number | null {
  const last = lastConnection(person);
  return last ? Math.max(0, daysBetween(last.date, todayYmd)) : null;
}

function filterPeople(
  people: readonly PersonRecord[],
  opts: { query: string; relation: string; group: string; tag: string; since?: string; sort?: "name" | "recent"; todayYmd?: string },
): PersonRecord[] {
  const q = opts.query.trim().toLowerCase();
  const today = opts.todayYmd ?? "";
  const since = SINCE.find((s) => s.key === opts.since);
  const days = new Map<string, number | null>();
  const daysOf = (p: PersonRecord) => { if (!days.has(p.id)) days.set(p.id, daysSinceConnection(p, today)); return days.get(p.id)!; };
  const byName = (a: PersonRecord, b: PersonRecord) => personName(a).localeCompare(personName(b), undefined, { sensitivity: "base" });
  const qDigits = q.replace(/\D/g, "");
  // a search that is a number (+1 303-555…) finds phones by their digits; words with numbers in them don't
  const qIsNumber = /^[\d\s()+.\-]+$/.test(q);
  return people
    .filter((p) => {
      const pf = readPersonFields(p.fields);
      if (opts.relation && pf.relation !== opts.relation) return false;
      if (opts.group && !pf.groups.some((g) => g.toLowerCase() === opts.group.toLowerCase())) return false;
      if (opts.tag && !pf.tags.some((t) => t.toLowerCase() === opts.tag.toLowerCase())) return false;
      if (since && today && !since.test(daysOf(p))) return false;
      if (!q) return true;
      const hay = [
        personName(p),
        pf.summary,
        pf.relation,
        pf.status,
        pf.address,
        pf.source,
        ...allEmailsOf(pf),
        ...pf.phones,
        ...pf.tags,
        ...pf.groups,
        ...pf.ways_of_working,
        ...pf.links,
        str(p.fields?.how_we_met),
      ].join(" ").toLowerCase();
      if (hay.includes(q)) return true;
      if (qIsNumber && qDigits.length >= 3 && pf.phones.some((ph) => ph.replace(/\D/g, "").includes(qDigits))) return true;
      return false;
    })
    .sort(opts.sort === "recent" && today
      // most recently in touch first; no connection yet at the end, by name
      ? (a, b) => { const da = daysOf(a), db = daysOf(b); return (da ?? Infinity) - (db ?? Infinity) || byName(a, b); }
      : byName);
}

// ── vCard (.vcf) import, matching, merge and export (RFC 2426 v3 & RFC 6350 v4) ──

function decodeQuotedPrintable(input: string, charset = "utf-8"): string {
  const cleaned = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "=" && i + 2 < cleaned.length && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = cleaned.codePointAt(i) ?? 0;
      if (code < 128) bytes.push(code);
      else {
        for (const b of new TextEncoder().encode(String.fromCodePoint(code))) bytes.push(b);
        if (code > 0xffff) i++;
      }
    }
  }
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset || "utf-8", { fatal: false }); } catch { decoder = new TextDecoder("utf-8", { fatal: false }); }
  return decoder.decode(new Uint8Array(bytes));
}

function unescapeVCard(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "n" || next === "N") out += "\n";
      else if (next === "," || next === ";" || next === "\\") out += next;
      else out += next;
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

function splitVCardEscaped(s: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      cur += s[i] + s[i + 1];
      i++;
    } else if (s[i] === sep) {
      parts.push(cur);
      cur = "";
    } else {
      cur += s[i];
    }
  }
  parts.push(cur);
  return parts;
}

function escapeVCard(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function foldVCardLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    if (curBytes + chBytes > limit && cur) {
      out.push(cur);
      cur = ` ${ch}`;
      curBytes = 1 + chBytes;
      limit = 75;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  if (cur) out.push(cur);
  return out.join("\r\n");
}

/** A web address as one line: http(s), no spaces or control characters (a newline in one would end a card on export). */
function webLink(u: string): boolean {
  return /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(u);
}

function base64ToBytes(b64: string): Uint8Array | null {
  const clean = b64.replace(/\s+/g, "");
  if (!clean) return null;
  try {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function normalizeMime(raw: string): string {
  const low = raw.trim().toLowerCase();
  if (!low) return "image/jpeg";
  if (low.includes("/")) return low;
  if (low === "jpg" || low === "jpeg") return "image/jpeg";
  if (low === "png") return "image/png";
  if (low === "gif") return "image/gif";
  if (low === "webp") return "image/webp";
  return `image/${low}`;
}

function parseVCardBirthday(raw: string, params: Record<string, string[]>): string {
  const v = raw.trim();
  if (!v) return "";
  const omitYear = (params["X-APPLE-OMIT-YEAR"] ?? [])[0];
  // --MMDD or --MM-DD (vCard 4.0 yearless birthday)
  const noYear = /^--(\d{2})-?(\d{2})$/.exec(v);
  if (noYear) return `--${noYear[1]}-${noYear[2]}`;
  // YYYY-MM-DD or YYYYMMDD (with optional T... timestamp)
  const full = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/i.exec(v);
  if (full) {
    if (omitYear && full[1] === omitYear) return `--${full[2]}-${full[3]}`;
    return `${full[1]}-${full[2]}-${full[3]}`;
  }
  return "";
}

function phoneLabelFromTypes(types: string[], groupLabel?: string): string {
  if (groupLabel) {
    const cleaned = groupLabel.replace(/^_\$!<(.+?)>!\$_$/, "$1").trim().toLowerCase();
    if (cleaned) return cleaned;
  }
  const flat = types.flatMap((t) => t.split(",")).map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const preferred of ["cell", "mobile", "iphone", "work", "home", "main", "fax"]) {
    if (flat.includes(preferred)) return preferred === "cell" || preferred === "iphone" ? "mobile" : preferred;
  }
  return "";
}

function parseVCardParams(rawParams: string[]): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  for (const part of rawParams) {
    const eq = part.indexOf("=");
    if (eq < 0) {
      // vCard 2.1 bare parameter token e.g. ;CELL;VOICE or ;BASE64
      const tok = part.trim().toUpperCase();
      if (!tok) continue;
      if (tok === "BASE64" || tok === "QUOTED-PRINTABLE") (params.ENCODING ??= []).push(tok);
      else (params.TYPE ??= []).push(tok);
      continue;
    }
    const key = part.slice(0, eq).trim().toUpperCase();
    const val = part.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
    if (!key) continue;
    (params[key] ??= []).push(val);
  }
  return params;
}

function splitParamHeader(header: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (ch === '"') { inQuote = !inQuote; cur += ch; }
    else if (ch === ";" && !inQuote) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function parseVCard(text: string): VCardContact[] {
  // Strip UTF-8 BOM, normalize line endings, and unfold RFC continuation lines
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const unfolded = normalized.replace(/\n[ \t]/g, "");
  const lines: string[] = [];
  const raw = unfolded.split("\n");
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    // vCard 2.1 quoted-printable: a value ending in `=` goes on in the next line, which isn't indented
    if (/QUOTED-PRINTABLE/i.test(line.slice(0, Math.max(0, line.indexOf(":"))))) {
      while (line.trimEnd().endsWith("=") && i + 1 < raw.length) line = line.trimEnd().slice(0, -1) + raw[++i];
    }
    lines.push(line);
  }

  const cards: VCardContact[] = [];
  let inCard = false;
  let props: { group: string; name: string; params: Record<string, string[]>; value: string }[] = [];

  const finalize = () => {
    const groupLabels = new Map<string, string>();
    for (const p of props) {
      if (p.group && p.name === "X-ABLABEL") groupLabels.set(p.group.toLowerCase(), unescapeVCard(p.value).trim());
    }

    let fn = "";
    let structuredName = "";
    let org = "";
    let title = "";
    const phones: string[] = [];
    const emails: string[] = [];
    const addresses: string[] = [];
    const links: string[] = [];
    const groups: string[] = [];
    const tags: string[] = [];
    const notes: string[] = [];
    let birthday = "";
    let photo: VCardPhoto | null = null;

    for (const p of props) {
      const encs = (p.params.ENCODING ?? []).map((e) => e.toUpperCase());
      const val = encs.includes("QUOTED-PRINTABLE") ? decodeQuotedPrintable(p.value, (p.params.CHARSET ?? [])[0]) : p.value;

      if (p.name === "FN") {
        const v = unescapeVCard(val).trim();
        if (v && !fn) fn = v;
      } else if (p.name === "N") {
        const parts = splitVCardEscaped(val, ";").map((x) => unescapeVCard(x).trim());
        // N: Family;Given;Additional;Prefix;Suffix
        const assembled = [parts[3], parts[1], parts[2], parts[0], parts[4]].filter(Boolean).join(" ").trim();
        if (assembled && !structuredName) structuredName = assembled;
      } else if (p.name === "ORG") {
        const parts = splitVCardEscaped(val, ";").map((x) => unescapeVCard(x).trim()).filter(Boolean);
        if (parts.length && !org) org = parts.join(" · ");
      } else if (p.name === "TITLE") {
        const v = unescapeVCard(val).trim();
        if (v && !title) title = v;
      } else if (p.name === "TEL") {
        const cleaned = unescapeVCard(val).replace(/^tel:/i, "").trim();
        if (cleaned) {
          const lbl = phoneLabelFromTypes(p.params.TYPE ?? [], p.group ? groupLabels.get(p.group.toLowerCase()) : undefined);
          phones.push(lbl ? `${lbl}: ${cleaned}` : cleaned);
        }
      } else if (p.name === "EMAIL") {
        const cleaned = unescapeVCard(val).replace(/^mailto:/i, "").trim().toLowerCase();
        if (cleaned) emails.push(cleaned);
      } else if (p.name === "ADR") {
        const parts = splitVCardEscaped(val, ";").map((x) => unescapeVCard(x).trim());
        // ADR: po;ext;street;city;region;postal;country
        const street = [parts[0], parts[1], parts[2]].filter(Boolean).join(", ");
        const cityRegion = [parts[3], parts[4]].filter(Boolean).join(", ");
        const cityLine = [cityRegion, parts[5]].filter(Boolean).join(" ").trim();
        const fullAddr = [street, cityLine, parts[6]].filter(Boolean).join("\n").trim();
        if (fullAddr) addresses.push(fullAddr);
      } else if (p.name === "BDAY") {
        const parsed = parseVCardBirthday(val, p.params);
        if (parsed && !birthday) birthday = parsed;
      } else if (p.name === "URL") {
        const cleaned = unescapeVCard(val).trim();
        if (webLink(cleaned)) links.push(cleaned);
      } else if (p.name === "CATEGORIES") {
        for (const c of splitVCardEscaped(val, ",").map((x) => unescapeVCard(x).trim()).filter(Boolean)) groups.push(c);
      } else if (p.name === "X-PARACHUTE-TAGS") {
        for (const t of splitVCardEscaped(val, ",").map((x) => unescapeVCard(x).trim()).filter(Boolean)) tags.push(t);
      } else if (p.name === "NOTE") {
        const v = unescapeVCard(val).trim();
        if (v) notes.push(v);
      } else if (p.name === "PHOTO" && !photo) {
        const dataUri = /^data:([^;,]+);base64,(.+)$/i.exec(val.trim());
        if (dataUri) {
          const mime = normalizeMime(dataUri[1]);
          const bytes = base64ToBytes(dataUri[2]);
          if (bytes && bytes.length > 0 && mime.startsWith("image/")) photo = { mimeType: mime, bytes };
        } else if (encs.includes("B") || encs.includes("BASE64")) {
          const typeRaw = (p.params.MEDIATYPE ?? p.params.TYPE ?? ["image/jpeg"])[0] ?? "image/jpeg";
          const mime = normalizeMime(typeRaw.split(",")[0] ?? "image/jpeg");
          const bytes = base64ToBytes(val);
          if (bytes && bytes.length > 0 && mime.startsWith("image/")) photo = { mimeType: mime, bytes };
        }
      }
    }

    const dedupedPhones = dedupeStrings(phones, (p) => normalizePhoneKey(p) || p.toLowerCase());
    const dedupedEmails = dedupeStrings(emails);
    const name = cleanPersonName(fn || structuredName || org || dedupedEmails[0] || (dedupedPhones[0] ? parsePhoneEntry(dedupedPhones[0]).number : ""));
    if (!name) return;

    const summary = title && org ? `${title}, ${org}` : title || org;
    cards.push({
      name,
      phones: dedupedPhones,
      emails: dedupedEmails,
      address: addresses[0] ?? "",
      birthday,
      links: dedupeStrings(links),
      groups: dedupeStrings(groups),
      tags: dedupeStrings(tags),
      summary,
      note: notes.join("\n\n"),
      photo,
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") {
      inCard = true;
      props = [];
      continue;
    }
    if (upper === "END:VCARD") {
      if (inCard) finalize();
      inCard = false;
      props = [];
      continue;
    }
    if (!inCard) continue;

    // Split header:value outside double-quoted parameter values
    let colon = -1;
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inQuote = !inQuote;
      else if (line[i] === ":" && !inQuote) { colon = i; break; }
    }
    if (colon < 1) continue;
    const header = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const segs = splitParamHeader(header);
    const propToken = segs[0].trim();
    const dot = propToken.indexOf(".");
    const group = dot > 0 ? propToken.slice(0, dot).trim() : "";
    const name = (dot > 0 ? propToken.slice(dot + 1) : propToken).trim().toUpperCase();
    const params = parseVCardParams(segs.slice(1));
    if (name) props.push({ group, name, params, value });
  }

  return cards;
}

/** People by email, phone and name, built once for many cards: a .vcf of thousands is matched without reading every
 *  person for each card. A key belongs to the first person in the list that has it, so a match is the one a scan of the
 *  list would find. `put` adds a person, or a person's new version in its place (merges only add keys). */
function peopleIndex(people: readonly PersonRecord[]) {
  const list: PersonRecord[] = [];
  const at = new Map<string, number>();
  const keys = { email: new Map<string, number>(), phone: new Map<string, number>(), name: new Map<string, number>() };
  const claim = (m: Map<string, number>, k: string, i: number) => { if (k && !(m.get(k)! <= i)) m.set(k, i); };
  const put = (person: PersonRecord) => {
    let i = at.get(person.id);
    if (i === undefined) { i = list.length; at.set(person.id, i); }
    list[i] = person;
    const pf = readPersonFields(person.fields);
    for (const e of allEmailsOf(pf)) claim(keys.email, e, i);
    for (const ph of pf.phones) claim(keys.phone, normalizePhoneKey(ph), i);
    claim(keys.name, normalizeNameKey(personName(person)), i);
  };
  const first = (m: Map<string, number>, ks: readonly string[]) => {
    let best: number | undefined;
    for (const k of ks) { const i = k ? m.get(k) : undefined; if (i !== undefined && (best === undefined || i < best)) best = i; }
    return best;
  };
  /** By email, then phone, then name. */
  const match = (card: VCardContact): VCardMatch | null => {
    const byEmail = first(keys.email, card.emails.map((e) => e.toLowerCase()));
    if (byEmail !== undefined) return { person: list[byEmail], by: "email" };
    const byPhone = first(keys.phone, card.phones.map(normalizePhoneKey));
    if (byPhone !== undefined) return { person: list[byPhone], by: "phone" };
    const byName = first(keys.name, [normalizeNameKey(card.name)]);
    return byName !== undefined ? { person: list[byName], by: "name" } : null;
  };
  for (const p of people) put(p);
  return { match, put };
}

/** A folder's page: 50, the most the app gives. */
const FOLDER_PAGE = 50;
/** The furthest offset the app pages to. */
const FOLDER_MAX_OFFSET = 5_000;

/** The people as listed, with bodies for those a card's note would merge into: so the preview says truly what will
 *  change without reading every person's notes. Each is read alone, or the folder in pages when that is fewer reads. */
async function withBodiesForCards(
  cards: readonly VCardContact[],
  people: readonly PersonRecord[],
  readOne: (id: string) => Promise<PersonRecord | null>,
  readAll: () => Promise<PersonRecord[]>,
): Promise<PersonRecord[]> {
  const index = peopleIndex(people);
  const want = new Set<string>();
  for (const card of cards) {
    const m = card.note ? index.match(card) : null;
    if (m) want.add(m.person.id);
  }
  if (!want.size) return [...people];
  const bodies = new Map<string, string>();
  if (want.size <= Math.ceil(people.length / FOLDER_PAGE)) {
    // one gone since the list was read: its body stays unknown, and the preview says it will merge
    for (const id of want) { const r = await readOne(id).catch(() => null); if (r) bodies.set(id, r.body ?? ""); }
  } else {
    for (const r of await readAll()) if (want.has(r.id)) bodies.set(r.id, r.body ?? "");
  }
  return people.map((p) => (bodies.has(p.id) ? { ...p, body: bodies.get(p.id) } : p));
}

/** Every record a folder query finds, in pages of a stable order: oldest made first, so a record changed while it reads
 *  moves nowhere and a new one lands at the end. Then one page newest-changed first, so a record changed while it read
 *  comes in its newest version. A hub that can't order by when a record was made (0.8) is read newest-changed first
 *  (where that last page brings in one changed while it read, which moved ahead of where it was). Past the furthest
 *  offset the app pages to, it stops: `capped`.
 *  Each page asks for the offset the last one ended at: the app goes on reading from there (and a record removed
 *  behind it moves none past it), so thousands cost one read a page, not a read of everything before it. */
async function readFolder(query: (q: Record<string, unknown>) => Promise<PersonRecord[]>, base: Record<string, unknown>): Promise<{ rows: PersonRecord[]; capped: boolean }> {
  const byId = new Map<string, PersonRecord>();
  const keep = (r: PersonRecord) => {
    const had = byId.get(r.id);
    if (!had || (r.updatedAt ?? "") >= (had.updatedAt ?? "")) byId.set(r.id, r);
  };
  let stable = true, capped = false;
  for (let offset = 0; ; offset += FOLDER_PAGE) {
    let rows: PersonRecord[];
    try {
      rows = await query({ ...base, ...(stable ? { orderBy: "created_at", sort: "asc" } : {}), limit: FOLDER_PAGE, offset });
    } catch (e) {
      if (offset > 0 || !stable) throw e;
      stable = false;
      rows = await query({ ...base, limit: FOLDER_PAGE, offset });
    }
    for (const r of rows) keep(r);
    if (rows.length < FOLDER_PAGE) break;
    // the app pages no further than this: what it has, and that there are more
    if (offset + FOLDER_PAGE > FOLDER_MAX_OFFSET) { capped = true; break; }
  }
  for (const r of await query({ ...base, limit: FOLDER_PAGE })) keep(r);
  return { rows: [...byId.values()], capped };
}

/** Build an additive patch to merge a vCard into an existing person without dropping or overwriting existing fields. */
function mergeVCardIntoPerson(
  existing: PersonRecord,
  card: VCardContact,
): { changed: boolean; fieldsPatch: Record<string, unknown>; nextBody?: string; attachPhoto: VCardPhoto | null } {
  const pf = readPersonFields(existing.fields);
  const held = existing.fields ?? {};
  const patch: Record<string, unknown> = {};

  // Emails: keep existing primary `email`; append any unseen lower-case emails to `emails`
  const hadEmails = allEmailsOf(pf);
  const hadEmailSet = new Set(hadEmails);
  const newEmails = card.emails.map((e) => e.toLowerCase()).filter((e) => e && !hadEmailSet.has(e));
  if (newEmails.length) {
    // added to what the record holds, as it holds it: nothing it had is rewritten or dropped
    if (unset(held.email)) {
      patch.email = newEmails[0];
      if (newEmails.length > 1) patch.emails = [...heldList(held.emails), ...newEmails.slice(1)];
    } else {
      patch.emails = [...heldList(held.emails), ...newEmails];
    }
  }

  // Phones: append any numbers whose normalized key isn't already present
  const hadPhoneKeys = new Set(pf.phones.map((p) => normalizePhoneKey(p) || p.toLowerCase()));
  const newPhones = card.phones.filter((p) => {
    const k = normalizePhoneKey(p) || p.toLowerCase();
    if (!k || hadPhoneKeys.has(k)) return false;
    hadPhoneKeys.add(k);
    return true;
  });
  if (newPhones.length) patch.phones = [...heldList(held.phones), ...newPhones];

  // Single values: only where the record has none (one it holds in a shape this can't read is still kept)
  if (unset(held.address) && card.address) patch.address = card.address;
  if (unset(held.birthday) && card.birthday) patch.birthday = card.birthday;
  if (unset(held.summary) && card.summary) patch.summary = card.summary;

  // List fields: what's new added to what the record holds
  const added = (had: string[], more: string[]) => {
    const keys = new Set(had.map((x) => x.toLowerCase()));
    return dedupeStrings(more).filter((x) => !keys.has(x.toLowerCase()));
  };
  const newGroups = added(pf.groups, card.groups);
  if (newGroups.length) patch.groups = [...heldList(held.groups), ...newGroups];
  const newTags = added(pf.tags, card.tags);
  if (newTags.length) patch.tags = [...heldList(held.tags), ...newTags];
  const newLinks = added(pf.links, card.links);
  if (newLinks.length) patch.links = [...heldList(held.links), ...newLinks];

  // Note: append only if present and not already in the body or the summary (an export writes the summary as NOTE).
  // A list record has no body: then the note is left out here, and the import reads the record before it writes.
  let nextBody: string | undefined;
  const curBody = existing.body ?? "";
  const noteIsSummary = normalizeNameKey(card.note) === normalizeNameKey(pf.summary) || normalizeNameKey(card.note) === normalizeNameKey(String(patch.summary ?? ""));
  if (card.note && existing.body !== undefined && !noteIsSummary && !curBody.includes(card.note)) {
    const base = curBody.trimEnd();
    nextBody = base ? `${base}\n\n${card.note}\n` : `## Memories and moments\n\n${card.note}\n`;
  }

  const attachPhoto = !pf.photo && card.photo ? card.photo : null;
  const changed = Object.keys(patch).length > 0 || nextBody !== undefined || attachPhoto !== null;
  return { changed, fieldsPatch: patch, nextBody, attachPhoto };
}

/** A one-line NOTE on a card with no title or company is its summary (an export writes the summary there); a longer
 *  note goes into the body under "Memories and moments". */
function noteIsOneLine(card: VCardContact): boolean {
  return !card.summary && !!card.note && !/\n/.test(card.note) && card.note.length <= 140;
}

function bodyForNewVCard(card: VCardContact): string {
  return card.note && !noteIsOneLine(card) ? `## Memories and moments\n\n${card.note}\n` : "## Memories and moments\n\n";
}

function fieldsForNewVCard(card: VCardContact): Record<string, unknown> {
  const fields: Record<string, unknown> = { status: "active", source: "vcard-import" };
  if (card.summary) fields.summary = card.summary;
  else if (noteIsOneLine(card)) fields.summary = card.note;
  if (card.emails.length) {
    fields.email = card.emails[0].toLowerCase();
    if (card.emails.length > 1) fields.emails = card.emails.slice(1).map((e) => e.toLowerCase());
  }
  if (card.phones.length) fields.phones = card.phones;
  if (card.address) fields.address = card.address;
  if (card.birthday) fields.birthday = card.birthday;
  if (card.links.length) fields.links = card.links;
  if (card.groups.length) fields.groups = card.groups;
  if (card.tags.length) fields.tags = card.tags;
  return fields;
}

function exportVCard(people: readonly PersonRecord[], photosById?: Map<string, VCardPhoto>): string {
  const blocks: string[] = [];
  for (const person of people) {
    const name = personName(person);
    const pf = readPersonFields(person.fields);
    const parts = name.split(/\s+/).filter(Boolean);
    const family = parts.length > 1 ? parts[parts.length - 1] : "";
    const given = parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] ?? name);

    const lines: string[] = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      `FN:${escapeVCard(name)}`,
      `N:${escapeVCard(family)};${escapeVCard(given)};;;`,
    ];

    for (const entry of pf.phones) {
      const { label, number } = parsePhoneEntry(entry);
      const typeParam = label && /^[a-z0-9-]+$/i.test(label) ? `;TYPE=${label === "mobile" ? "cell" : label}` : "";
      lines.push(`TEL${typeParam}:${escapeVCard(number)}`);
    }

    const emails = allEmailsOf(pf);
    emails.forEach((email, idx) => {
      lines.push(`EMAIL${idx === 0 ? ";PREF=1" : ""}:${escapeVCard(email)}`);
    });

    if (pf.address) {
      const street = pf.address.replace(/\r\n|\r|\n/g, ", ");
      lines.push(`ADR:;;${escapeVCard(street)};;;;`);
    }

    if (parseYmd(pf.birthday)) {
      lines.push(`BDAY:${pf.birthday.replace(/(\d)-(\d)/g, "$1$2")}`);
    }

    for (const u of pf.links) {
      if (webLink(u)) lines.push(`URL:${u}`);
    }

    if (pf.groups.length) {
      lines.push(`CATEGORIES:${pf.groups.map(escapeVCard).join(",")}`);
    }

    if (pf.tags.length) {
      lines.push(`X-PARACHUTE-TAGS:${pf.tags.map(escapeVCard).join(",")}`);
    }

    if (pf.summary) {
      lines.push(`NOTE:${escapeVCard(pf.summary)}`);
    }

    const photo = photosById?.get(person.id);
    if (photo && photo.bytes.length > 0) {
      lines.push(`PHOTO:data:${photo.mimeType};base64,${bytesToBase64(photo.bytes)}`);
    }

    lines.push("END:VCARD");
    blocks.push(lines.map(foldVCardLine).join("\r\n"));
  }
  return blocks.join("\r\n") + (blocks.length ? "\r\n" : "");
}

// ── end pure helpers ──

type Draft = { body: string; base: string | null };
type ViewTab = "all" | "birthdays" | "reconnect";

type VcfPlanRow = {
  card: VCardContact;
  match: VCardMatch | null;
  action: "new" | "merge" | "skip";
  detail: string;
};

type NewPersonDraft = {
  name: string;
  summary: string;
  relation: string;
  status: string;
  email: string;
  phones: string[];
  birthday: string;
  address: string;
  tags: string[];
  groups: string[];
  links: string[];
  favorite: boolean;
};

const EMPTY_NEW: NewPersonDraft = {
  name: "",
  summary: "",
  relation: "",
  status: "active",
  email: "",
  phones: [],
  birthday: "",
  address: "",
  tags: [],
  groups: [],
  links: [],
  favorite: false,
};

function prettyUrl(u: string): string {
  return u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

function relationLabel(r: string): string {
  return r ? `${r[0].toUpperCase()}${r.slice(1)}` : "";
}

function formatDaysSince(days: number | null): string {
  if (days === null) return "No linked notes yet";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function birthdayCountdownText(daysUntil: number, nextDate: string, turning: number | null): string {
  const whenText = daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : `in ${daysUntil} days`;
  const dateText = when.short(nextDate);
  const ageText = turning !== null ? ` · turning ${turning}` : "";
  return daysUntil <= 1 ? `${whenText}${ageText}` : `${dateText} · ${whenText}${ageText}`;
}

function Avatar({ name, url, size, want }: { name: string; url?: string; size: number; want?: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const wantRef = useRef(want);
  wantRef.current = want;
  const wants = !!want;
  useEffect(() => {
    if (url || !wants || !ref.current) return;
    const ask = () => wantRef.current?.();
    if (typeof IntersectionObserver !== "function") { ask(); return; }
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); ask(); } }, { rootMargin: "200px" });
    seen.observe(ref.current);
    return () => seen.disconnect();
  }, [url, wants]);
  if (url) {
    return (
      <span className={size >= 60 ? "pe-avatar pe-avatar-lg" : "pe-avatar"} aria-hidden="true">
        <img src={url} alt={name} width={size} height={size} className="pe-avatar-img" />
      </span>
    );
  }
  return (
    <span ref={ref} className={size >= 60 ? "pe-avatar pe-avatar-lg" : "pe-avatar"} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

export default function People() {
  const [people, setPeople] = useState<PersonRecord[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  /** More people than the app pages to: the list holds the first of them. */
  const [capped, setCapped] = useState(false);
  const [tab, setTab] = useSaved<ViewTab>("tab", "all");
  const [query, setQuery] = useState("");
  const [relationFilter, setRelationFilter] = useSaved<string>("filter.relation", "");
  const [groupFilter, setGroupFilter] = useSaved<string>("filter.group", "");
  const [tagFilter, setTagFilter] = useSaved<string>("filter.tag", "");
  const [sinceFilter, setSinceFilter] = useSaved<string>("filter.since", "");
  const [sortBy, setSortBy] = useSaved<"name" | "recent">("sort", "name");
  const [staleDays, setStaleDays] = useSaved<number>("reconnect.days", 30);
  const [includePast, setIncludePast] = useSaved<boolean>("reconnect.past", false);

  const [selectedId, setSelectedId] = useSaved<string | null>("selected", null);
  const [selected, setSelected] = useState<PersonRecord | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [drafts, setDrafts] = useSaved<Record<string, Draft>>("drafts", {});
  const [savingBody, setSavingBody] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  // Drawers
  const [addOpen, setAddOpen] = useState(false);
  const [newDraft, setNewDraft] = useState<NewPersonDraft>(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [vcfOpen, setVcfOpen] = useState(false);
  const [vcfPlan, setVcfPlan] = useState<{ fileName: string; rows: VcfPlanRow[] } | null>(null);
  const [vcfBusy, setVcfBusy] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [talkDraft, setTalkDraft] = useState<{ date: string; what: string }>({ date: "", what: "" });
  const [talkBusy, setTalkBusy] = useState(false);

  // Photo object URL cache (keyed by `${id}|${photoPath}`)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const photoCache = useRef<Map<string, string>>(new Map());
  const photoFailed = useRef<Map<string, number>>(new Map());
  const photoQueue = useRef<{ key: string; id: string; path: string }[]>([]);
  const photoInflight = useRef<Set<string>>(new Set());
  const photoRunning = useRef(false);

  const setDraft = (id: string, d: Draft | null | ((was: Draft | null) => Draft | null)) => setDrafts((all) => {
    const next = typeof d === "function" ? d(all[id] ?? null) : d;
    const out = { ...all };
    if (next) out[id] = next; else delete out[id];
    return out;
  });
  const draft = selected ? drafts[selected.id] ?? null : null;
  const editingBody = draft !== null;
  const editingRef = useRef(editingBody);
  editingRef.current = editingBody;
  const shown = useRef<string | null>(null);
  shown.current = selected?.id ?? null;

  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
    for (const u of photoCache.current.values()) URL.revokeObjectURL(u);
    photoCache.current.clear();
    photoQueue.current = [];
  }, []);

  // One picture read at a time, so a long list of photos never crowds out opening or saving a person
  const drainPhotos = useCallback(async () => {
    if (photoRunning.current) return;
    photoRunning.current = true;
    try {
      for (let next = photoQueue.current.shift(); next; next = photoQueue.current.shift()) {
        try {
          const blob = await vault.file!(next.id, next.path);
          if (!mounted.current) return;
          const url = URL.createObjectURL(blob);
          photoCache.current.set(next.key, url);
          setPhotoUrls((prev) => ({ ...prev, [next.key]: url }));
        } catch {
          photoFailed.current.set(next.key, Date.now());
        } finally {
          photoInflight.current.delete(next.key);
        }
      }
    } finally {
      photoRunning.current = false;
    }
  }, []);

  const ensurePhoto = useCallback((id: string, photoPath: string, first = false) => {
    if (!photoPath || typeof vault.file !== "function") return;
    const key = `${id}|${photoPath}`;
    if (photoCache.current.has(key) || photoInflight.current.has(key)) return;
    const failedAt = photoFailed.current.get(key);
    if (failedAt !== undefined && Date.now() - failedAt < 60_000) return;
    photoInflight.current.add(key);
    const item = { key, id, path: photoPath };
    if (first) photoQueue.current.unshift(item); else photoQueue.current.push(item);
    void drainPhotos();
  }, [drainPhotos]);

  // Load all people in People/ (paginated, so 118+ people all load cleanly)
  // one load at a time: a load asked for while one runs runs once more after it, and both callers wait for that
  const loading = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const load = useCallback((): Promise<void> => {
    if (loading.current) { again.current = true; return loading.current; }
    const run = async () => {
      do {
        again.current = false;
        try {
          const base = { pathPrefix: FOLDER, includeFields: true };
          const query = (q: Record<string, unknown>) => vault.queryRecords(q) as Promise<PersonRecord[]>;
          // a hub that doesn't hand links with a folder's records: the list still loads, without "last talked"
          let got: { rows: PersonRecord[]; capped: boolean };
          try {
            got = await readFolder(query, { ...base, includeLinks: true });
          } catch {
            got = await readFolder(query, base);
          }
          setPeople(got.rows);
          setCapped(got.capped);
          setError(null);
        } catch (e) {
          setError(e);
        }
      } while (again.current);
      loading.current = null;
    };
    loading.current = run();
    return loading.current;
  }, []);

  const opening = useRef(0);
  const openPerson = useCallback(async (id: string) => {
    const n = ++opening.current;
    setSelectedId(id);
    setEditingDetails(false);
    try {
      let full: PersonRecord | null;
      try {
        full = await vault.getRecord(id, { includeLinks: true }) as PersonRecord | null;
      } catch {
        full = await vault.getRecord(id) as PersonRecord | null;
      }
      if (n !== opening.current) return;
      if (full) {
        versions.current.delete(full.id);
        setSelected(full);
        const pf = readPersonFields(full.fields);
        if (pf.photo) ensurePhoto(full.id, pf.photo, true);
      } else {
        setSelected(null);
        setSelectedId(null);
        toast("That person record is no longer there.");
      }
    } catch (e) {
      if (n !== opening.current) return;
      setSelectedId(shown.current);
      toast(`Could not open person: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    }
  }, [ensurePhoto, setSelectedId]);

  useEffect(() => {
    ready().then(() => {
      void load();
      if (selectedId) void openPerson(selectedId);
    });
    return onOpen((o: { note: { id: string } }) => {
      if (editingRef.current) toast("Save or cancel your edit first.");
      else void openPerson(o.note.id);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closePerson = useCallback(() => {
    opening.current++;
    setSelected(null);
    setSelectedId(null);
    setEditingDetails(false);
  }, [setSelectedId]);

  useEffect(() => (selectedId && typeof onBack === "function" ? onBack(closePerson) : undefined), [selectedId, closePerson]);

  // Derived data
  const todayYmd = when.stamp(Date.now()).slice(0, 10);

  const facets = useMemo(() => {
    const groups = new Map<string, number>();
    const tags = new Map<string, number>();
    const relations = new Map<string, number>();
    for (const p of people ?? []) {
      const pf = readPersonFields(p.fields);
      if (pf.relation) relations.set(pf.relation, (relations.get(pf.relation) ?? 0) + 1);
      for (const g of pf.groups) groups.set(g, (groups.get(g) ?? 0) + 1);
      for (const t of pf.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    }
    return {
      relations: [...relations.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      groups: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      tags: [...tags.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [people]);

  const filtered = useMemo(
    () => filterPeople(people ?? [], { query, relation: relationFilter, group: groupFilter, tag: tagFilter, since: sinceFilter, sort: sortBy, todayYmd }),
    [people, query, relationFilter, groupFilter, tagFilter, sinceFilter, sortBy, todayYmd],
  );

  const favorites = useMemo(() => filtered.filter((p) => readPersonFields(p.fields).favorite), [filtered]);

  const letterGroups = useMemo(() => {
    const map = new Map<string, PersonRecord[]>();
    for (const p of filtered) {
      const l = letterOf(personName(p));
      const arr = map.get(l) ?? [];
      arr.push(p);
      map.set(l, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] === "#" ? 1 : b[0] === "#" ? -1 : a[0].localeCompare(b[0])));
  }, [filtered]);

  const birthdaysSoon = useMemo(() => upcomingBirthdays(people ?? [], todayYmd, 60), [people, todayYmd]);
  const allBirthdays = useMemo(() => upcomingBirthdays(people ?? [], todayYmd, 366), [people, todayYmd]);
  const reconnect = useMemo(
    () => reconnectList(people ?? [], todayYmd, { staleDays, includePast }),
    [people, todayYmd, staleDays, includePast],
  );
  const keep = useMemo(() => keepInTouch(people ?? [], todayYmd), [people, todayYmd]);

  const activeFilterCount = (relationFilter ? 1 : 0) + (groupFilter ? 1 : 0) + (tagFilter ? 1 : 0) + (sinceFilter ? 1 : 0);
  const clearFilters = () => { setRelationFilter(""); setGroupFilter(""); setTagFilter(""); setSinceFilter(""); };

  // Mutations. Field saves go one after another, each on the version the one before left (a quick second edit, or
  // Favorite tapped twice, isn't a conflict with itself); a notes draft begun before our own field change moves on
  // to the new version, since its body didn't change. Only someone else's change is a conflict.
  const versions = useRef(new Map<string, string>());
  /** Each field save of our own, `<id>|<version it began on>` → the version it left: a notes draft follows only these. */
  const ownSaves = useRef(new Map<string, string>());
  const fieldSaves = useRef<Promise<unknown>>(Promise.resolve());
  const patchPersonFields = (person: PersonRecord, fieldsPatch: Record<string, unknown>, message?: string): Promise<PersonRecord> => {
    const run = async () => {
      // the newer of what our own last save left and what this person was last read as (a reload may bring one newer)
      const mine = versions.current.get(person.id);
      const base = mine && (!person.updatedAt || mine > person.updatedAt) ? mine : person.updatedAt;
      if (!base) {
        toast("Refresh this person before editing.", { error: true });
        throw new Error("missing version");
      }
      try {
        const updated = await vault.updateRecord(person.id, { fields: fieldsPatch, if_updated_at: base }) as PersonRecord;
        if (updated.updatedAt) { versions.current.set(person.id, updated.updatedAt); ownSaves.current.set(`${person.id}|${base}`, updated.updatedAt); }
        const merge = (fields?: Record<string, unknown>) => {
          const out: Record<string, unknown> = { ...(fields ?? {}) };
          for (const [k, v] of Object.entries(fieldsPatch)) { if (v === null) delete out[k]; else out[k] = v; }
          return out;
        };
        setSelected((s) => (s?.id === person.id ? { ...s, updatedAt: updated.updatedAt, fields: merge(s.fields) } : s));
        setPeople((list) => (list ? list.map((x) => (x.id === person.id ? { ...x, updatedAt: updated.updatedAt, fields: merge(x.fields) } : x)) : list));
        setDraft(person.id, (d) => (d && d.base === base ? { ...d, base: updated.updatedAt } : d));
        if (message) toast(message);
        return { ...person, updatedAt: updated.updatedAt, fields: merge(person.fields) };
      } catch (e) {
        const conflict = (e as { status?: number })?.status === 409;
        toast(conflict ? "Someone else changed this person. Refresh and try again." : `Not saved: ${e instanceof Error ? e.message : String(e)}`, { error: true });
        throw e;
      }
    };
    const done = fieldSaves.current.then(run, run);
    fieldSaves.current = done.catch(() => {});
    return done;
  };

  const saveFieldInline = async (name: string, value: unknown) => {
    if (!selected) return;
    let clean: unknown = value;
    if (name === "email" && typeof value === "string") clean = value.trim().toLowerCase() || null;
    else if (name === "emails" && Array.isArray(value)) clean = dedupeStrings(value.map((x) => String(x).toLowerCase()));
    else if (name === "favorite") clean = value === true ? true : null;
    else if (name === "birthday") {
      const b = String(value ?? "").trim();
      if (b && !parseYmd(b)) { toast("A birthday is YYYY-MM-DD, or --MM-DD without the year.", { error: true }); return; }
      clean = b || null;
    }
    else if (name === "met") {
      const m = String(value ?? "").trim();
      if (m && !ymdOf(m) && !/^\d{4}(-\d{2})?$/.test(m)) { toast("When you met is YYYY-MM-DD, or just YYYY.", { error: true }); return; }
      clean = m || null;
    }
    else if (Array.isArray(value)) {
      const list = dedupeStrings(value.map((x) => String(x)));
      clean = list.length ? list : null;
    }
    await patchPersonFields(selected, { [name]: clean }, "Saved");
  };

  const openTalk = () => { setTalkDraft({ date: todayYmd, what: "" }); setTalkOpen(true); };
  const logTalk = async () => {
    if (!selected || talkBusy) return;
    const date = talkDraft.date.trim() || todayYmd;
    if (!ymdOf(date)) { toast("A day is YYYY-MM-DD.", { error: true }); return; }
    setTalkBusy(true);
    try {
      await patchPersonFields(selected, { talked: withTalk(selected.fields, date, talkDraft.what) }, date === todayYmd ? "Noted: in touch today." : `Noted: in touch ${when.short(date)}.`);
      setTalkOpen(false);
    } catch { /* patchPersonFields said why */ } finally {
      setTalkBusy(false);
    }
  };

  const saveBody = async () => {
    if (!selected || !draft) return;
    if (!draft.base) return toast("This person has no version to save against. Cancel and reopen.", { error: true });
    const id = selected.id;
    const title = personName(selected);
    const { body } = draft;
    setSavingBody(id);
    try {
      // after any field save of ours still under way; from the draft's version, on along our own field saves only (they
      // don't touch the body): someone else's change in between is still a conflict
      await fieldSaves.current;
      let base = draft.base;
      for (let i = 0, next = ownSaves.current.get(`${id}|${base}`); next && i < 100; i++, next = ownSaves.current.get(`${id}|${base}`)) base = next;
      const updated = await vault.updateRecord(id, { body, if_updated_at: base }) as PersonRecord;
      if (updated.updatedAt) versions.current.set(id, updated.updatedAt);
      setSelected((s) => (s?.id === id ? { ...s, ...updated, body } : s));
      setDraft(id, (d) => (!d || d.body === body ? null : { ...d, base: updated.updatedAt }));
      toast(`Saved ${title}.`);
      void load();
    } catch (e) {
      const conflict = (e as { status?: number })?.status === 409;
      toast(conflict ? `Someone else changed ${title}. Copy your text, Cancel, and edit again.` : `Not saved: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setSavingBody((x) => (x === id ? null : x));
    }
  };

  const pickPhoto = async () => {
    if (!selected || photoBusy) return;
    setPhotoBusy(true);
    try {
      const files = await app.pick({ accept: "image/*", multiple: false });
      const file = files[0];
      if (!file) return;
      const attached = await vault.attach(selected.id, file.bytes, file.type);
      const was = readPersonFields(selected.fields).photo;
      const next = await patchPersonFields(selected, { photo: attached.path }, "Updated photo.");
      const key = `${next.id}|${attached.path}`;
      const blobUrl = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
      photoCache.current.set(key, blobUrl);
      const oldKey = `${next.id}|${was}`;
      const oldUrl = was ? photoCache.current.get(oldKey) : undefined;
      if (oldUrl) { URL.revokeObjectURL(oldUrl); photoCache.current.delete(oldKey); }
      setPhotoUrls((prev) => { const out = { ...prev, [key]: blobUrl }; delete out[oldKey]; return out; });
    } catch (e) {
      toast(`Could not update photo: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setPhotoBusy(false);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      const ok = await app.copy(value);
      if (ok) toast(`Copied ${label}.`);
      else toast(`Could not copy ${label}.`, { error: true });
    } catch {
      toast(`Could not copy ${label}.`, { error: true });
    }
  };

  const createPerson = async () => {
    const clean = cleanPersonName(newDraft.name);
    if (!clean) { toast("Give them a name.", { error: true }); return; }
    setAdding(true);
    try {
      const fields: Record<string, unknown> = {};
      if (newDraft.summary.trim()) fields.summary = newDraft.summary.trim();
      if (newDraft.relation) fields.relation = newDraft.relation;
      if (newDraft.status) fields.status = newDraft.status;
      if (newDraft.email.trim()) fields.email = newDraft.email.trim().toLowerCase();
      if (newDraft.phones.length) fields.phones = dedupeStrings(newDraft.phones);
      if (newDraft.birthday.trim()) fields.birthday = newDraft.birthday.trim();
      if (newDraft.address.trim()) fields.address = newDraft.address.trim();
      if (newDraft.tags.length) fields.tags = dedupeStrings(newDraft.tags);
      if (newDraft.groups.length) fields.groups = dedupeStrings(newDraft.groups);
      if (newDraft.links.length) fields.links = dedupeStrings(newDraft.links);
      if (newDraft.favorite) fields.favorite = true;

      const made = await vault.createRecord({
        path: `${FOLDER}${clean}`,
        body: "## Memories and moments\n\n",
        fields,
      }) as PersonRecord;
      toast(`Added ${clean}.`);
      setAddOpen(false);
      setNewDraft(EMPTY_NEW);
      await load();
      await openPerson(made.id);
    } catch (e) {
      toast(`Could not add ${clean}: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setAdding(false);
    }
  };

  // vCard import & export
  const chooseVcf = async () => {
    try {
      const files = await app.pick({ accept: ".vcf,text/vcard,text/x-vcard", multiple: false });
      const file = files[0];
      if (!file) return;
      setVcfBusy(true);
      const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(file.bytes));
      const parsed = parseVCard(text);
      if (!parsed.length) {
        toast("No contacts found in that .vcf file.", { error: true });
        return;
      }
      // the list has no bodies: read those a card's note would merge into, so the preview says truly what will change
      const existing = await withBodiesForCards(
        parsed,
        people ?? [],
        (id) => vault.getRecord(id) as Promise<PersonRecord | null>,
        async () => (await readFolder((q) => vault.queryRecords(q) as Promise<PersonRecord[]>, { pathPrefix: FOLDER, includeBody: true })).rows,
      );
      const rows: VcfPlanRow[] = [];
      const seenNew: PersonRecord[] = [];
      const index = peopleIndex(existing);
      for (const card of parsed) {
        const match = index.match(card);
        if (match) {
          const merged = mergeVCardIntoPerson(match.person, card);
          rows.push({
            card,
            match,
            action: merged.changed ? "merge" : "skip",
            detail: merged.changed ? `Matches ${personName(match.person)} by ${match.by} · will merge` : `Already up to date (${personName(match.person)})`,
          });
        } else {
          rows.push({
            card,
            match: null,
            action: "new",
            detail: [card.emails[0], card.phones[0], card.photo ? "with photo" : ""].filter(Boolean).join(" · ") || "New person",
          });
          const pending: PersonRecord = { id: `pending:${seenNew.length}`, path: `${FOLDER}${card.name}`, updatedAt: null, fields: fieldsForNewVCard(card), body: bodyForNewVCard(card) };
          seenNew.push(pending);
          index.put(pending);
        }
      }
      setVcfPlan({ fileName: file.name, rows });
    } catch (e) {
      toast(`Could not read .vcf file: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setVcfBusy(false);
    }
  };

  const runVcfImport = async () => {
    if (!vcfPlan || vcfBusy) return;
    setVcfBusy(true);
    let createdCount = 0;
    let mergedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    try {
      // Live list updated as each contact lands so duplicate entries inside one .vcf never duplicate
      const live = peopleIndex(people ?? []);
      const paths = new Set((people ?? []).map((x) => x.path.toLowerCase()));
      for (const row of vcfPlan.rows) {
        const card = row.card;
        try {
          const match = live.match(card);
          if (match) {
            const full = (await vault.getRecord(match.person.id) as PersonRecord | null) ?? match.person;
            const merged = mergeVCardIntoPerson(full, card);
            if (!merged.changed) { skippedCount++; continue; }
            let target = full;
            if (Object.keys(merged.fieldsPatch).length > 0 || merged.nextBody !== undefined) {
              const updated = await vault.updateRecord(target.id, {
                if_updated_at: target.updatedAt ?? "",
                ...(Object.keys(merged.fieldsPatch).length ? { fields: merged.fieldsPatch } : {}),
                ...(merged.nextBody !== undefined ? { body: merged.nextBody } : {}),
              }) as PersonRecord;
              target = {
                ...target,
                ...updated,
                fields: { ...(target.fields ?? {}), ...merged.fieldsPatch },
                body: merged.nextBody ?? target.body,
              };
            }
            if (merged.attachPhoto && target.updatedAt) {
              try {
                const att = await vault.attach(target.id, merged.attachPhoto.bytes.buffer.slice(merged.attachPhoto.bytes.byteOffset, merged.attachPhoto.bytes.byteOffset + merged.attachPhoto.bytes.byteLength), merged.attachPhoto.mimeType);
                const updatedPhoto = await vault.updateRecord(target.id, { if_updated_at: target.updatedAt, fields: { photo: att.path } }) as PersonRecord;
                target = { ...target, ...updatedPhoto, fields: { ...(target.fields ?? {}), photo: att.path } };
              } catch { /* keep the merged contact even if photo upload fails */ }
            }
            live.put(target);
            mergedCount++;
          } else {
            // Avoid path collisions if two distinct people share a sanitized path
            let path = `${FOLDER}${card.name}`;
            let suffix = 2;
            while (paths.has(path.toLowerCase())) path = `${FOLDER}${card.name} ${suffix++}`;
            const fields = fieldsForNewVCard(card);
            const body = bodyForNewVCard(card);
            let made = await vault.createRecord({ path, body, fields }) as PersonRecord;
            made = { ...made, fields, body };
            if (card.photo && made.updatedAt) {
              try {
                const att = await vault.attach(made.id, card.photo.bytes.buffer.slice(card.photo.bytes.byteOffset, card.photo.bytes.byteOffset + card.photo.bytes.byteLength), card.photo.mimeType);
                const updatedPhoto = await vault.updateRecord(made.id, { if_updated_at: made.updatedAt, fields: { photo: att.path } }) as PersonRecord;
                made = { ...made, ...updatedPhoto, fields: { ...fields, photo: att.path } };
              } catch { /* photo attach best-effort */ }
            }
            live.put(made);
            paths.add(made.path.toLowerCase());
            createdCount++;
          }
        } catch {
          failedCount++;
        }
      }
      await load();
      setVcfPlan(null);
      setVcfOpen(false);
      const summary = [
        createdCount ? `${createdCount} added` : "",
        mergedCount ? `${mergedCount} merged` : "",
        skippedCount ? `${skippedCount} unchanged` : "",
        failedCount ? `${failedCount} failed` : "",
      ].filter(Boolean).join(", ");
      toast(`Imported vCard: ${summary || "nothing changed"}.`, { error: failedCount > 0 && createdCount === 0 && mergedCount === 0 });
    } finally {
      setVcfBusy(false);
    }
  };

  const exportVcf = async (subset: readonly PersonRecord[], fileName = "people.vcf") => {
    if (!subset.length) { toast("No people to export.", { error: true }); return; }
    setVcfBusy(true);
    try {
      const photos = new Map<string, VCardPhoto>();
      if (typeof vault.file === "function") {
        // Fetch attached photos (capped to keep exports responsive)
        const withPhotos = subset.filter((p) => readPersonFields(p.fields).photo).slice(0, 100);
        for (const p of withPhotos) {
          const pf = readPersonFields(p.fields);
          try {
            const blob = await vault.file(p.id, pf.photo);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            if (bytes.length) photos.set(p.id, { mimeType: blob.type || "image/jpeg", bytes });
          } catch { /* skip unreadable photo */ }
        }
      }
      const vcf = exportVCard(subset, photos);
      const encoded = new TextEncoder().encode(vcf);
      const saved = await app.save(fileName, encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength), "text/vcard");
      toast(`Saved ${saved.saved}.`);
    } catch (e) {
      toast(`Could not export vCard: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setVcfBusy(false);
    }
  };

  const jumpToLetter = (letter: string) => {
    const el = document.getElementById(`letter-${letter}`);
    if (el) el.scrollIntoView({ behavior: isStill() ? "auto" : "smooth", block: "start" });
  };

  const personRow = (p: PersonRecord, opts: { aside?: string; under?: string; metaOverride?: string } = {}) => {
    const name = personName(p);
    const pf = readPersonFields(p.fields);
    const photoUrl = pf.photo ? photoUrls[`${p.id}|${pf.photo}`] : undefined;
    const aside = opts.aside ?? (drafts[p.id] ? "Unsaved edit" : pf.favorite ? "★" : relationLabel(pf.relation));
    // the relation once: beside the name when it stands there, else under it
    const relationAside = aside === relationLabel(pf.relation);
    const meta = opts.metaOverride ?? (
      [pf.summary || (relationAside ? "" : relationLabel(pf.relation)), pf.groups.length ? pf.groups.join(" · ") : ""].filter(Boolean).join(" · ")
      || pf.email
      || (pf.phones[0] ? parsePhoneEntry(pf.phones[0]).number : "")
    );
    return {
      key: p.id,
      label: name,
      title: (
        <span className="pe-row-head">
          <Avatar name={name} url={photoUrl} size={34} want={pf.photo ? () => ensurePhoto(p.id, pf.photo) : undefined} />
          <span className="pe-row-name">{name}</span>
        </span>
      ),
      meta: meta || undefined,
      aside: aside || undefined,
      under: opts.under,
      onPress: () => void openPerson(p.id),
    };
  };

  // ── Person detail page ──
  if (selected) {
    const name = personName(selected);
    const pf = readPersonFields(selected.fields);
    const photoUrl = pf.photo ? photoUrls[`${selected.id}|${pf.photo}`] : undefined;
    const emails = allEmailsOf(pf);
    const timeline = timelineOf(selected);
    const linkedPeople = mentionsOf(selected).filter((m) => m.isPerson);
    const last = lastConnection(selected);
    const cadence = cadenceDays(selected.fields?.keep_in_touch);
    const howWeMet = str(selected.fields?.how_we_met);
    const met = str(selected.fields?.met);
    const keepText = !cadence ? "" : (() => {
      const every = CADENCES.includes(str(selected.fields?.keep_in_touch).toLowerCase() as typeof CADENCES[number]) ? str(selected.fields?.keep_in_touch).toLowerCase() : `every ${cadence} days`;
      if (!last) return `In touch ${every}`;
      const left = daysBetween(todayYmd, addDays(last.date, cadence));
      return `In touch ${every} · ${left <= 0 ? "time to reach out" : left === 1 ? "next tomorrow" : `next in ${left} days`}`;
    })();
    const bdayInfo = pf.birthday ? nextBirthdayInfo(pf.birthday, todayYmd) : null;
    const busyBody = savingBody !== null && savingBody === selected.id;
    const kicker = [relationLabel(pf.relation), pf.status ? relationLabel(pf.status) : ""].filter(Boolean).join(" · ") || "Person";
    const followNoteLink = (target: string) => {
      const targetPerson = (people ?? []).find((x) => personName(x) === target || x.path === target || x.path === `${FOLDER}${target}`);
      if (targetPerson) void openPerson(targetPerson.id);
      else void link.follow(`[[${target}]]`, { from: selected.path });
    };

    const contactRows = [
      ...pf.phones.map((entry, idx) => {
        const { label, number } = parsePhoneEntry(entry);
        return {
          key: `phone-${idx}`,
          title: number,
          meta: label ? `${label[0].toUpperCase()}${label.slice(1)} phone` : "Phone",
          aside: "Copy",
          onPress: () => void copyText(number, "phone number"),
        };
      }),
      ...emails.map((em, idx) => ({
        key: `email-${idx}`,
        title: <Link to={`mailto:${em}`}>{em}</Link>,
        meta: idx === 0 ? "Primary email" : "Email",
        aside: <Button kind="quiet" small onClick={() => void copyText(em, "email")}>Copy</Button>,
      })),
      ...(pf.address ? [{
        key: "address",
        title: <span className="pe-pre">{pf.address}</span>,
        meta: "Address",
        aside: "Copy",
        onPress: () => void copyText(pf.address, "address"),
      }] : []),
      ...(pf.birthday ? [{
        key: "birthday",
        title: bdayInfo ? birthdayCountdownText(bdayInfo.daysUntil, bdayInfo.nextDate, bdayInfo.turning) : pf.birthday,
        meta: `Birthday · ${pf.birthday}`,
      }] : []),
      ...pf.links.map((u, idx) => ({
        key: `link-${idx}`,
        title: <Link to={u}>{prettyUrl(u)}</Link>,
        meta: "Link",
      })),
    ];

    return (
      <Page
        scroll
        title={name}
        kicker={kicker}
        back={{ label: NAME, onPress: closePerson }}
        aside={
          <>
            <Button
              small
              kind={pf.favorite ? "primary" : "plain"}
              aria-pressed={pf.favorite}
              onClick={() => { patchPersonFields(selected, { favorite: pf.favorite ? null : true }, pf.favorite ? "Removed from favorites." : "Added to favorites.").catch(() => {}); }}
            >
              {pf.favorite ? "★ Favorite" : "☆ Favorite"}
            </Button>
            <Button small onClick={() => setEditingDetails((e) => !e)}>
              {editingDetails ? "Done" : "Edit details"}
            </Button>
          </>
        }
        onRefresh={editingBody ? undefined : () => openPerson(selected.id)}
      >
        <style>{CSS}</style>

        <Card>
          <div className="pe-hero">
            <div className="pe-hero-avatar">
              <Avatar name={name} url={photoUrl} size={68} />
              <Button kind="quiet" small busy={photoBusy} onClick={() => void pickPhoto()}>
                {pf.photo ? "Change photo" : "Add photo"}
              </Button>
            </div>
            <div className="pe-hero-info">
              {pf.summary ? <p className="pe-summary">{pf.summary}</p> : <p className="pe-muted">No summary yet.</p>}
              {howWeMet || met ? <p className="pe-small">How we met: {[howWeMet, met ? (ymdOf(met) ? when.short(met) : met) : ""].filter(Boolean).join(" · ")}</p> : null}
              <p className="pe-small pe-muted">
                {last ? `Last in touch ${formatDaysSince(Math.max(0, daysBetween(last.date, todayYmd))).toLowerCase()} · ${last.title}` : "No connection yet"}
                {keepText ? <><br />{keepText}</> : null}
              </p>
              {pf.source ? <p className="pe-small pe-muted">Came from: {pf.source}</p> : null}
              <div className="pa-actions">
                <Button small kind="primary" onClick={openTalk}>We talked</Button>
                {pf.phones[0] && (
                  <Button small onClick={() => void copyText(parsePhoneEntry(pf.phones[0]).number, "phone number")}>
                    Copy phone
                  </Button>
                )}
                {emails[0] && (
                  <Button small onClick={() => void copyText(emails[0], "email")}>
                    Copy email
                  </Button>
                )}
                <Button small kind="quiet" busy={vcfBusy} onClick={() => void exportVcf([selected], `${cleanPersonName(name).toLowerCase().replace(/\s+/g, "-") || "person"}.vcf`)}>
                  Export vCard
                </Button>
              </div>
            </div>
          </div>

          {(pf.groups.length > 0 || pf.tags.length > 0) && (
            <div className="pe-chips-wrap">
              {pf.groups.length > 0 && (
                <div className="pe-chip-group">
                  <span className="pe-chip-label">Groups</span>
                  <div className="pe-chips">
                    {pf.groups.map((g) => (
                      <Button key={`g-${g}`} small onClick={() => { setGroupFilter(g); setTab("all"); closePerson(); }}>
                        {g}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {pf.tags.length > 0 && (
                <div className="pe-chip-group">
                  <span className="pe-chip-label">Tags</span>
                  <div className="pe-chips">
                    {pf.tags.map((t) => (
                      <Button key={`t-${t}`} small kind="quiet" onClick={() => { setTagFilter(t); setTab("all"); closePerson(); }}>
                        #{t}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {editingDetails ? (
          <Card title="Edit details">
            <Fields
              label="Person details"
              onSave={saveFieldInline}
              fields={[
                { name: "summary", label: "Summary", kind: "text", value: pf.summary },
                { name: "relation", label: "Relation", kind: "choice", choices: RELATIONS, value: pf.relation },
                { name: "status", label: "Status", kind: "choice", choices: STATUSES, value: pf.status },
                { name: "keep_in_touch", label: "Keep in touch", kind: "choice", choices: CADENCES, value: str(selected.fields?.keep_in_touch) },
                { name: "how_we_met", label: "How we met", kind: "long", value: howWeMet },
                { name: "met", label: "When we met (YYYY-MM-DD or YYYY)", kind: "text", value: met },
                { name: "email", label: "Email", kind: "text", value: pf.email },
                { name: "emails", label: "More emails", kind: "list", value: pf.emails },
                { name: "phones", label: "Phones", kind: "list", value: pf.phones },
                { name: "address", label: "Address", kind: "long", value: pf.address },
                pf.birthday.startsWith("--")
                  ? { name: "birthday", label: "Birthday (--MM-DD, no year)", kind: "text", value: pf.birthday }
                  : { name: "birthday", label: "Birthday", kind: "date", value: /^\d{4}-\d{2}-\d{2}$/.test(pf.birthday) ? pf.birthday : "" },
                { name: "links", label: "Links", kind: "list", value: pf.links },
                { name: "tags", label: "Tags", kind: "list", value: pf.tags },
                { name: "groups", label: "Groups", kind: "list", value: pf.groups },
                { name: "ways_of_working", label: "Ways of working", kind: "list", value: pf.ways_of_working },
                { name: "source", label: "Source", kind: "text", value: pf.source },
                { name: "favorite", label: "Favorite", kind: "yesno", value: pf.favorite },
              ]}
            />
            <p className="pe-small pe-muted">Changes save automatically when you press Enter or leave a field. Separate list items with commas.</p>
          </Card>
        ) : contactRows.length > 0 ? (
          <List label="Contact" rows={contactRows} />
        ) : (
          <div className="pa-actions">
            <Button small onClick={() => setEditingDetails(true)}>Add phone, email, birthday or tags</Button>
          </div>
        )}

        {pf.ways_of_working.length > 0 && !editingDetails && (
          <List
            label="Ways of working"
            rows={pf.ways_of_working.map((w, i) => ({ key: `wow-${i}`, title: w }))}
          />
        )}

        <section className="pe-section-block" aria-label="Memories and moments">
          <div className="pe-section-head">
            <h2 className="pe-h2">Notes & memories</h2>
            {!editingBody && (
              <Button small onClick={() => setDraft(selected.id, { body: selected.body ?? "", base: selected.updatedAt })}>
                Edit notes
              </Button>
            )}
          </div>
          {editingBody ? (
            <Write
              label="Notes and memories"
              labelled
              value={draft?.body ?? ""}
              onChange={(body: string) => setDraft(selected.id, (d) => (d ? { ...d, body } : d))}
              onSend={saveBody}
              send={busyBody ? "Saving…" : "Save"}
              busy={busyBody}
            >
              <Button kind="quiet" onClick={() => setDraft(selected.id, null)}>Cancel</Button>
            </Write>
          ) : selected.body?.trim() ? (
            <Note body={selected.body} path={selected.path} tags={selected.tags} fields={selected.fields} onLink={followNoteLink} />
          ) : (
            <Empty>No memories or notes yet. Tap Edit notes to start.</Empty>
          )}
        </section>

        {/* the list names itself as a region; only the empty state needs a heading */}
        <div className="pe-section-block">
          {timeline.length > 0 ? (
            <List
              label={`Timeline · ${timeline.length}`}
              rows={timeline.map((m) => ({
                key: m.key,
                title: m.title,
                meta: [m.kind, m.detail].filter(Boolean).join(" · "),
                aside: m.date ? (ymdOf(m.date) ? when.short(m.date) : m.date) : undefined,
                onPress: m.id ? () => void link.open(m.id!) : undefined,
              }))}
            />
          ) : (
            <>
              <h2 className="pe-h2">Timeline</h2>
              <p className="pe-small pe-muted">Nothing yet. Tap We talked, or link [[{name}]] from a meeting or journal entry.</p>
            </>
          )}
        </div>

        {linkedPeople.length > 0 && (
          <List
            label={`People linked · ${linkedPeople.length}`}
            rows={linkedPeople.map((m) => ({ key: m.id, title: m.title, meta: m.relationship && !/^(wiki)?link$/.test(m.relationship) ? m.relationship : undefined, onPress: () => void openPerson(m.id) }))}
          />
        )}

        <Drawer open={talkOpen} onClose={() => { if (!talkBusy) setTalkOpen(false); }} title={`In touch with ${name}`}>
          <Fields
            label="When"
            onSave={(k, v) => setTalkDraft((d) => ({ ...d, [k]: typeof v === "string" ? v : "" }))}
            fields={[{ name: "date", label: "Day", kind: "date", value: talkDraft.date }]}
          />
          <Field
            label="What about (optional)"
            placeholder="Coffee at the Kiln; she'll send the draft"
            value={talkDraft.what}
            onChange={(what) => setTalkDraft((d) => ({ ...d, what }))}
          />
          <p className="pe-small pe-muted">Kept on {name}'s card in People, with the day.</p>
          <div className="pa-actions">
            <Button kind="primary" busy={talkBusy} onClick={() => void logTalk()}>Save</Button>
            <Button kind="quiet" disabled={talkBusy} onClick={() => setTalkOpen(false)}>Cancel</Button>
          </div>
        </Drawer>
      </Page>
    );
  }

  // ── Contacts list screen ──
  const totalCount = people?.length ?? 0;
  const kicker = people === null ? undefined
    : query || activeFilterCount > 0 ? `${filtered.length} of ${totalCount} people`
      : capped ? `${totalCount}+ people` : `${totalCount} ${totalCount === 1 ? "person" : "people"}`;

  const soonTwoWeeks = birthdaysSoon.filter((b) => b.daysUntil <= 14);

  return (
    <Page
      scroll
      title={NAME}
      kicker={kicker}
      aside={
        <>
          {/* contacts in and out match against everyone: only once everyone is listed */}
          <Button small disabled={people === null || !!error || capped} onClick={() => setVcfOpen(true)}>vCard</Button>
          <Button kind="primary" small onClick={() => { setNewDraft(EMPTY_NEW); setAddOpen(true); }}>Add</Button>
        </>
      }
      onRefresh={() => load()}
    >
      <style>{CSS}</style>

      <Search
        label="Search people"
        placeholder="Search name, phone, email, tag, group…"
        value={query}
        onChange={setQuery}
        onSearch={setQuery}
        live={150}
      />

      <Tabs
        label="Views"
        current={tab}
        onChange={(k) => setTab(k as ViewTab)}
        tabs={[
          { key: "all", label: "Contacts", count: filtered.length },
          { key: "birthdays", label: "Birthdays", count: birthdaysSoon.length || undefined },
          // no count here: who to reach out to is a short list to look at, not a backlog to clear
          { key: "reconnect", label: "In touch" },
        ]}
      />

      {error ? (
        <Problem error={error} onRetry={() => load()}>Could not read people in {FOLDER}.</Problem>
      ) : people === null ? (
        <Loading>Reading people…</Loading>
      ) : tab === "all" ? (
        <>
          <div className="pe-filter-bar">
            <div className="pe-chips">
              <span className="pe-sort" role="group" aria-label="Sort">
                <Button small kind={sortBy === "name" ? "primary" : "plain"} aria-pressed={sortBy === "name"} onClick={() => setSortBy("name")}>A–Z</Button>
                <Button small kind={sortBy === "recent" ? "primary" : "plain"} aria-pressed={sortBy === "recent"} onClick={() => setSortBy("recent")}>Recent</Button>
              </span>
              <Button small kind={activeFilterCount > 0 ? "primary" : "plain"} onClick={() => setFilterOpen(true)}>
                {activeFilterCount > 0 ? `Filters · ${activeFilterCount}` : "Filters"}
              </Button>
              {relationFilter && (
                <Button small onClick={() => setRelationFilter("")}>
                  {relationLabel(relationFilter)} ×
                </Button>
              )}
              {groupFilter && (
                <Button small onClick={() => setGroupFilter("")}>
                  Group: {groupFilter} ×
                </Button>
              )}
              {tagFilter && (
                <Button small onClick={() => setTagFilter("")}>
                  #{tagFilter} ×
                </Button>
              )}
              {sinceFilter && (
                <Button small onClick={() => setSinceFilter("")}>
                  In touch: {SINCE.find((x) => x.key === sinceFilter)?.label ?? sinceFilter} ×
                </Button>
              )}
              {activeFilterCount > 0 && (
                <Button small kind="quiet" onClick={clearFilters}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          {!query && activeFilterCount === 0 && soonTwoWeeks.length > 0 && (
            <Card title="Birthdays coming up">
              <List
                rows={soonTwoWeeks.slice(0, 3).map((b) =>
                  personRow(b.person, {
                    aside: b.daysUntil === 0 ? "Today" : b.daysUntil === 1 ? "Tomorrow" : `in ${b.daysUntil}d`,
                    metaOverride: `${when.short(b.nextDate)}${b.turning !== null ? ` · turning ${b.turning}` : ""}`,
                  }),
                )}
              />
            </Card>
          )}

          {filtered.length === 0 ? (
            <Empty>
              {query || activeFilterCount > 0
                ? "No one matches that search or filter."
                : "No people in People/ yet. Tap Add or import a .vcf file."}
            </Empty>
          ) : sortBy === "recent" ? (
            <List
              label={`Most recently in touch · ${filtered.length}`}
              rows={filtered.map((p) => {
                const last = lastConnection(p);
                return personRow(p, {
                  aside: last ? formatDaysSince(Math.max(0, daysBetween(last.date, todayYmd))) : "Not yet",
                  ...(last ? { metaOverride: `${last.kind === "Talked" ? "Talked" : last.kind}: ${last.title}` } : {}),
                });
              })}
            />
          ) : (
            <div className="pe-contacts-wrap">
              <div className="pe-contacts-main">
                {favorites.length > 0 && (
                  <List
                    label={`Favorites · ${favorites.length}`}
                    rows={favorites.map((p) => personRow(p))}
                  />
                )}
                {letterGroups.map(([letter, group]) => (
                  <div key={letter} id={`letter-${letter}`} className="pe-letter-section">
                    <List label={letter} rows={group.map((p) => personRow(p))} />
                  </div>
                ))}
              </div>
              {letterGroups.length > 1 && (
                <nav className="pe-index pa-tight" aria-label="Letter index">
                  {letterGroups.map(([letter]) => (
                    <Button
                      key={letter}
                      kind="quiet"
                      small
                      className="pe-idx-btn"
                      aria-label={`Jump to ${letter}`}
                      onClick={() => jumpToLetter(letter)}
                    >
                      {letter}
                    </Button>
                  ))}
                </nav>
              )}
            </div>
          )}
        </>
      ) : tab === "birthdays" ? (
        <>
          {birthdaysSoon.length > 0 ? (
            <List
              label={`Next 60 days · ${birthdaysSoon.length}`}
              rows={birthdaysSoon.map((b) =>
                personRow(b.person, {
                  metaOverride: birthdayCountdownText(b.daysUntil, b.nextDate, b.turning),
                  aside: b.daysUntil === 0 ? "Today" : b.daysUntil === 1 ? "Tomorrow" : `${b.daysUntil}d`,
                  under: b.daysUntil <= 3 ? (b.daysUntil === 0 ? "Birthday today" : "Coming up") : undefined,
                }),
              )}
            />
          ) : (
            <Empty>No birthdays in the next 60 days.</Empty>
          )}
          {allBirthdays.length > birthdaysSoon.length && (
            <List
              label="Later in the year"
              rows={allBirthdays.slice(birthdaysSoon.length).map((b) =>
                personRow(b.person, {
                  metaOverride: `${when.short(b.nextDate)}${b.turning !== null ? ` · turning ${b.turning}` : ""}`,
                  aside: `${b.daysUntil}d`,
                }),
              )}
            />
          )}
        </>
      ) : (
        <>
          {keep.due.length > 0 && (
            <List
              label="Time to reach out"
              rows={keep.due.map((k) =>
                personRow(k.person, {
                  metaOverride: k.last ? `Last: ${k.last.title} · ${formatDaysSince(Math.max(0, daysBetween(k.last.date, todayYmd))).toLowerCase()}` : "Not in touch yet",
                  aside: str(k.person.fields?.keep_in_touch) || `every ${k.cadence} days`,
                }),
              )}
            />
          )}
          {keep.soon.length > 0 && (
            <List
              label="Coming up this week"
              rows={keep.soon.map((k) =>
                personRow(k.person, {
                  metaOverride: k.last ? `Last: ${k.last.title}` : undefined,
                  aside: k.daysLeft === 1 ? "Tomorrow" : `In ${k.daysLeft} days`,
                }),
              )}
            />
          )}
          {keep.due.length === 0 && keep.soon.length === 0 && (
            <p className="pe-small pe-muted pe-lead">
              {people.some((p) => cadenceDays(p.fields?.keep_in_touch))
                ? "No one is due. Everyone you keep in touch with has heard from you lately."
                : "Choose how often to keep in touch with someone (Edit details on their card), and they show here when it's time."}
            </p>
          )}

          <div className="pe-section-block">
            <div className="pe-section-head">
              <h2 className="pe-h2">Everyone else, not in touch for a while</h2>
            </div>
            <div className="pe-chips">
              {[30, 90, 365].map((d) => (
                <Button key={d} small kind={staleDays === d ? "primary" : "plain"} onClick={() => setStaleDays(d)}>
                  {d === 365 ? "A year+" : `${d}+ days`}
                </Button>
              ))}
              <Button small kind="quiet" onClick={() => setIncludePast((v) => !v)}>
                {includePast ? "Hide past" : "Include past"}
              </Button>
            </div>
          </div>
          {reconnect.stale.length === 0 && reconnect.unlinked.length === 0 ? (
            <Empty>No one else has gone quiet.</Empty>
          ) : (
            <>
              {reconnect.stale.length > 0 && (
                <List
                  label={`${staleDays === 365 ? "A year" : `${staleDays} days`} or more · ${reconnect.stale.length}`}
                  rows={reconnect.stale.map((r) =>
                    personRow(r.person, {
                      metaOverride: r.lastTitle ? `Last: ${r.lastTitle}` : undefined,
                      aside: formatDaysSince(r.daysSince),
                    }),
                  )}
                />
              )}
              {reconnect.unlinked.length > 0 && (
                <List
                  label={`No connection yet · ${reconnect.unlinked.length}`}
                  rows={reconnect.unlinked.map((r) => personRow(r.person))}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ── Add person drawer ── */}
      <Drawer open={addOpen} onClose={() => setAddOpen(false)} title="Add person">
        <Field
          label="Name"
          placeholder="Full name"
          value={newDraft.name}
          onChange={(name) => setNewDraft((d) => ({ ...d, name }))}
        />
        <Field
          label="Summary"
          placeholder="One-line note about who they are"
          value={newDraft.summary}
          onChange={(summary) => setNewDraft((d) => ({ ...d, summary }))}
        />
        <Fields
          label="More details"
          onSave={(k, v) => setNewDraft((d) => ({ ...d, [k]: v ?? (Array.isArray((d as Record<string, unknown>)[k]) ? [] : k === "favorite" ? false : "") }))}
          fields={[
            { name: "relation", label: "Relation", kind: "choice", choices: RELATIONS, value: newDraft.relation },
            { name: "status", label: "Status", kind: "choice", choices: STATUSES, value: newDraft.status },
            { name: "email", label: "Email", kind: "text", value: newDraft.email },
            { name: "phones", label: "Phones", kind: "list", value: newDraft.phones },
            { name: "birthday", label: "Birthday", kind: "date", value: newDraft.birthday },
            { name: "tags", label: "Tags", kind: "list", value: newDraft.tags },
            { name: "groups", label: "Groups", kind: "list", value: newDraft.groups },
            { name: "address", label: "Address", kind: "long", value: newDraft.address },
            { name: "favorite", label: "Favorite", kind: "yesno", value: newDraft.favorite },
          ]}
        />
        <div className="pa-actions">
          <Button kind="primary" busy={adding} onClick={() => void createPerson()}>Add person</Button>
          <Button kind="quiet" onClick={() => setAddOpen(false)}>Cancel</Button>
        </div>
      </Drawer>

      {/* ── Filter drawer ── */}
      <Drawer open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter people">
        <div className="pe-filter-section">
          <p className="pe-chip-label">Last in touch</p>
          <div className="pe-chips">
            <Button small kind={!sinceFilter ? "primary" : "plain"} onClick={() => setSinceFilter("")}>Any time</Button>
            {SINCE.map((x) => (
              <Button key={x.key} small kind={sinceFilter === x.key ? "primary" : "plain"} onClick={() => setSinceFilter(sinceFilter === x.key ? "" : x.key)}>
                {x.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="pe-filter-section">
          <p className="pe-chip-label">Relation</p>
          <div className="pe-chips">
            <Button small kind={!relationFilter ? "primary" : "plain"} onClick={() => setRelationFilter("")}>All</Button>
            {RELATIONS.map((r) => {
              const count = facets.relations.find(([k]) => k === r)?.[1] ?? 0;
              return (
                <Button key={r} small kind={relationFilter === r ? "primary" : "plain"} onClick={() => setRelationFilter(relationFilter === r ? "" : r)}>
                  {relationLabel(r)}{count ? ` · ${count}` : ""}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="pe-filter-section">
          <p className="pe-chip-label">Groups</p>
          {facets.groups.length > 0 ? (
            <div className="pe-chips">
              {facets.groups.map(([g, count]) => (
                <Button key={g} small kind={groupFilter === g ? "primary" : "plain"} onClick={() => setGroupFilter(groupFilter === g ? "" : g)}>
                  {g} · {count}
                </Button>
              ))}
            </div>
          ) : (
            <p className="pe-small pe-muted">No groups yet. Add groups on any person card.</p>
          )}
        </div>

        <div className="pe-filter-section">
          <p className="pe-chip-label">Tags</p>
          {facets.tags.length > 0 ? (
            <div className="pe-chips">
              {facets.tags.map(([t, count]) => (
                <Button key={t} small kind={tagFilter === t ? "primary" : "plain"} onClick={() => setTagFilter(tagFilter === t ? "" : t)}>
                  #{t} · {count}
                </Button>
              ))}
            </div>
          ) : (
            <p className="pe-small pe-muted">No tags yet. Add plain tags on any person card.</p>
          )}
        </div>

        <div className="pa-actions">
          <Button kind="primary" onClick={() => setFilterOpen(false)}>Show {filtered.length}</Button>
          {activeFilterCount > 0 && (
            <Button kind="quiet" onClick={clearFilters}>
              Clear all
            </Button>
          )}
        </div>
      </Drawer>

      {/* ── vCard import / export drawer ── */}
      <Drawer open={vcfOpen} onClose={() => { if (!vcfBusy) { setVcfOpen(false); setVcfPlan(null); } }} title="Contacts in and out">
        <Card title="Import from a .vcf file">
          <p>Matches existing people by email, phone, then name, and merges new details without duplicating.</p>
          {!vcfPlan ? (
            <div className="pa-actions">
              <Button kind="primary" busy={vcfBusy} onClick={() => void chooseVcf()}>Choose .vcf file</Button>
            </div>
          ) : (
            <>
              <List
                label={`${vcfPlan.fileName} · ${vcfPlan.rows.length} ${vcfPlan.rows.length === 1 ? "contact" : "contacts"}`}
                rows={vcfPlan.rows.slice(0, 20).map((r, i) => ({
                  key: `vcf-${i}`,
                  title: r.card.name,
                  meta: r.detail,
                  aside: r.action === "new" ? "New" : r.action === "merge" ? "Merge" : "Same",
                }))}
              />
              {vcfPlan.rows.length > 20 && <p className="pe-small pe-muted">And {vcfPlan.rows.length - 20} more contacts…</p>}
              <div className="pa-actions">
                {vcfPlan.rows.some((r) => r.action !== "skip") ? (
                  <Button kind="primary" busy={vcfBusy} onClick={() => void runVcfImport()}>
                    {vcfBusy ? "Importing…" : `Import ${vcfPlan.rows.filter((r) => r.action !== "skip").length}`}
                  </Button>
                ) : <p className="pe-small pe-muted">Everyone here is already up to date.</p>}
                <Button kind="quiet" disabled={vcfBusy} onClick={() => setVcfPlan(null)}>Cancel</Button>
              </div>
            </>
          )}
        </Card>

        <Card title="Export as .vcf">
          <p>Saves a standard vCard 4.0 file with phones, emails, addresses, birthdays, groups and photos.</p>
          <div className="pa-actions">
            <Button busy={vcfBusy} onClick={() => void exportVcf(people ?? [], "people.vcf")}>
              Export all ({totalCount})
            </Button>
            {(query || activeFilterCount > 0) && filtered.length !== totalCount && (
              <Button kind="quiet" busy={vcfBusy} onClick={() => void exportVcf(filtered, "people-filtered.vcf")}>
                Export shown ({filtered.length})
              </Button>
            )}
          </div>
        </Card>
      </Drawer>
    </Page>
  );
}

const CSS = `
.pe-row-head { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
.pe-row-name { overflow-wrap: anywhere; }
.pe-avatar { flex: none; display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--text); font: 600 var(--fs-label) var(--sans); letter-spacing: .03em; overflow: hidden; }
.pe-avatar-lg { width: 68px; height: 68px; font-size: var(--fs-head); border: var(--line-card); }
.pe-avatar-img { display: block; width: 100%; height: 100%; object-fit: cover; }

.pe-contacts-wrap { position: relative; display: flex; align-items: flex-start; gap: 8px; }
.pe-contacts-main { flex: 1; min-width: 0; }
.pe-letter-section { scroll-margin-top: 12px; }
.pe-index { position: sticky; top: 12px; flex: none; display: flex; flex-direction: column; align-items: center; padding: 2px 0; }
.pe-idx-btn { min-width: 24px; padding: 1px 4px; font-size: var(--fs-label); line-height: 1.35; text-decoration: none; color: var(--muted); }

.pe-filter-bar { margin: calc(var(--gap) * .6) 0 var(--gap); }
.pe-sort { display: inline-flex; gap: 2px; margin-right: 6px; }
.pe-lead { margin: calc(var(--gap) * .6) 0 var(--gap); }
.pe-filter-section { margin: 0 0 var(--gap); }
.pe-chips-wrap { display: grid; gap: 10px; margin-top: var(--gap); padding-top: calc(var(--gap) * .8); border-top: var(--line-row); }
.pe-chip-group { display: grid; gap: 6px; }
.pe-chip-label { margin: 0; font: 600 var(--fs-label) var(--sans); letter-spacing: var(--label-track); text-transform: var(--label-transform); font-variant-caps: var(--label-caps); color: var(--label-ink); }
.pe-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }

.pe-hero { display: flex; align-items: flex-start; gap: var(--pad); }
.pe-hero-avatar { flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.pe-hero-info { flex: 1; min-width: 0; display: grid; gap: 8px; }
.pe-summary { margin: 0; font: var(--fs-lead)/1.45 var(--serif); color: var(--text); }
.pe-muted { color: var(--muted); }
.pe-small { margin: 0; font-size: var(--fs-small); }
.pe-pre { white-space: pre-line; }

.pe-section-block { margin: calc(var(--gap) * 1.4) 0; }
.pe-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--gap); margin: 0 0 8px; }
.pe-h2 { margin: 0; font: italic 400 var(--fs-body) var(--serif); color: var(--muted); }
`;
