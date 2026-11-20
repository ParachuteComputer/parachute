// when: the kit's one way to say a date or a time (docs/WRITE-AN-APPLET.md, the parts). Every applet said
// them its own way (docs/INVENTORY.md "Dates and times"); now each says them through these, in the person's language.
// A moment is a Date, an ISO string (a date alone is that day where the person is), milliseconds, or seconds (a relay's created_at: a number below 1e11 is seconds,
// which holds for any date after 1973). Something that isn't a moment gives "" (or null from `parse`).
//   when.time(t)    9:41 AM
//   when.day(t)     Today · Yesterday · Monday, November 17 · Monday, November 17, 2025
//   when.date(t)    Monday, November 17 (the year too when it isn't this one), whatever day it is
//   when.short(t)   9:41 AM today · Yesterday · Mon this week · Nov 17 this year · Nov 17, 2025
//   when.full(t)    Mon, Nov 17, 9:41 AM (the year too when it isn't this one)
//   when.ago(t)     now · 5m · 3h · then as short()
//   when.stamp(t)   2026-11-17 09-41: a moment in a note's name, sorted as text
//   when.path(t)    2026/11-17/09-41: the same as folders, as Journal files its entries
//   when.parse(t)   the Date, or null
export type Moment = Date | string | number | null | undefined;

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

function parse(t: Moment): Date | null {
  if (t instanceof Date) return Number.isNaN(t.getTime()) ? null : t;
  if (typeof t === "number") { if (!Number.isFinite(t)) return null; return new Date(Math.abs(t) < 1e11 ? t * 1000 : t); }
  if (typeof t === "string" && t.trim()) {
    // a date alone ("2026-11-17", as a note's fields hold one) is that day here, not midnight in London
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.trim());
    if (day) { const d = new Date(+day[1], +day[2] - 1, +day[3]); return d.getMonth() === +day[2] - 1 && d.getDate() === +day[3] ? d : null; }
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  return null;
}

// formatters are made once each, in the device's language
const fmt = new Map<string, Intl.DateTimeFormat>();
const f = (o: Intl.DateTimeFormatOptions) => { const k = JSON.stringify(o); let x = fmt.get(k); if (!x) { x = new Intl.DateTimeFormat(undefined, o); fmt.set(k, x); } return x; };
const midnight = (d: Date) => { const m = new Date(d); m.setHours(0, 0, 0, 0); return m.getTime(); };
/** Whole days from `d` to `now` by the calendar (yesterday is 1, whatever the hour). */
const daysBack = (d: Date, now: Date) => Math.round((midnight(now) - midnight(d)) / DAY_MS);

function time(t: Moment): string { const d = parse(t); return d ? f({ hour: "numeric", minute: "2-digit" }).format(d) : ""; }

function day(t: Moment, now = new Date()): string {
  const d = parse(t);
  if (!d) return "";
  const back = daysBack(d, now);
  if (back === 0) return "Today";
  if (back === 1) return "Yesterday";
  return date(d, now);
}

function date(t: Moment, now = new Date()): string {
  const d = parse(t);
  if (!d) return "";
  return f(d.getFullYear() === now.getFullYear() ? { weekday: "long", month: "long", day: "numeric" } : { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d);
}

function short(t: Moment, now = new Date()): string {
  const d = parse(t);
  if (!d) return "";
  const back = daysBack(d, now);
  if (back === 0) return time(d);
  if (back === 1) return "Yesterday";
  if (back > 1 && back < 7) return f({ weekday: "short" }).format(d);
  return f(d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function full(t: Moment, now = new Date()): string {
  const d = parse(t);
  if (!d) return "";
  return f(d.getFullYear() === now.getFullYear() ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

function ago(t: Moment, now = new Date()): string {
  const d = parse(t);
  if (!d) return "";
  const m = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 60 * 24 && daysBack(d, now) === 0) return `${Math.floor(m / 60)}h`;
  return short(d, now);
}

function stamp(t: Moment): string {
  const d = parse(t);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}` : "";
}

function path(t: Moment, seconds = false): string {
  const d = parse(t);
  return d ? `${d.getFullYear()}/${pad(d.getMonth() + 1)}-${pad(d.getDate())}/${pad(d.getHours())}-${pad(d.getMinutes())}${seconds ? `-${pad(d.getSeconds())}` : ""}` : "";
}

export const when = Object.freeze({ time, day, date, short, full, ago, stamp, path, parse });
