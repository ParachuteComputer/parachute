// Sessions: the Claude Code sessions Uni starts, per room: which are working now and what each is doing, the recent
// ones and how they ended, what each cost, and what it did, step by step. Read-only. The Uni app's session view (rooms'
// projects, T-302/T-304/T-319) as an applet (Aaron, 11-22: "in our old rooms we had a way of seeing into Claude code
// sessions, I miss that").
//
// What it reads, all of it written by mts (the launcher) into the vault, nothing from the machine itself:
//   Runs/<date> <title>       tag run: room, task, state, started_at, ended_at, summary, doing_now, doing_at, steps,
//                             feed (the steps note's id), report {summary, artifacts, checks, open, ripples}, ended,
//                             end_note, duration_s, and, once mts writes them at the finish, cost and model
//   Runs/Steps/<date> <run>   tag run-feed: one line per step, `- <time> · <step|said> · <text>`, oldest first; its
//                             metadata {first, total, parts, dropped} lists the earlier parts, each a note of its own
// mts redacts every line before it leaves the machine (T-304). This is the second net: every word read goes through
// redactRaw first (the same rules and cases as mts's and the Uni app's: src/applet/redaction-vectors.json), and a step
// shows only as a fixed phrase with a plain label (safeStep).
import { useEffect, useRef, useState } from "react";
import { Button, Empty, List, Loading, Page, Problem, onShown, ready, vault, when } from "parachute";

// ── redact (the Uni app's sessionWords.ts; tested in src/applet/sessionsApplet.test.ts) ──
const HIDDEN = "[hidden]";
const REDACT_RULES = [
  { re: "pass(?:word|wd|phrase|code)|secret|token|api[ _-]?key|access[ _-]?key|bearer|credential|private|authori[sz]ation", flags: "i", mix: false },
  { re: "(?<![A-Za-z])(?:pass|pwd|pw|cookie|auth)s?(?=\\s*[\"']?\\s*[:=])", flags: "i", mix: false },
  { re: "-----BEGIN", flags: "", mix: false },
  { re: "sk-(?:ant|proj|live|test|svcacct|admin)-|gh[pousr]_[A-Za-z0-9]{6,}|github_pat_|xox[abprse]-|nsec1[02-9ac-hj-np-z]{6,}|eyJ[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{12,}", flags: "", mix: false },
  { re: "(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{6,}", flags: "", mix: false },
  { re: "sk-[A-Za-z0-9_-]{6,}", flags: "", mix: true },
  { re: "://[^/\\s:@]+:[^/\\s@]+@", flags: "", mix: false },
  { re: "[0-9a-fA-F]{32,}", flags: "", mix: false },
  { re: "[A-Za-z0-9+/=]{32,}", flags: "", mix: true },
];
const DASHES = "\u2212\u2043";
const FOLD_FROM = "\u0430\u0435\u043e\u0440\u0441\u0443\u0445\u0455\u0456\u0458\u0501\u051b\u051d\u04bb\u04cf\u043a\u043c\u0442\u0432\u043d\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0425\u0423\u0405\u0406\u0408\u03b1\u03bf\u03c1\u03c4\u03c5\u03bd\u03ba\u03b9\u03b5\u0391\u0392\u0395\u0396\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7\u0131\u0237\u0251\u0261";
const FOLD_TO = "aeopcyxsijdqwhlkmtbhABEKMHOPCTXYSIJaoptuvkieABEZHIKMNOPTYXijag";
const FOLD: Record<string, string> = Object.fromEntries([...FOLD_FROM].map((c, i) => [c, FOLD_TO[i]]));
const RULES = REDACT_RULES.map((r) => ({ rx: new RegExp(r.re, `${r.flags}g`), mix: r.mix }));
const KEY_CHAR = /[A-Za-z0-9_-]/, DROP = /^[\p{Mn}\p{Cf}]$/u, DASH = /^\p{Pd}$/u;
function folded(text: string) {
  let norm = "";
  const at: number[] = [];
  let i = 0;
  for (const ch of text) {
    for (const d of ch.normalize("NFKD")) {
      if (DROP.test(d)) continue;
      const f = DASH.test(d) || DASHES.includes(d) ? "-" : FOLD[d] ?? d;
      norm += f;
      for (let k = 0; k < f.length; k++) at.push(i);
    }
    i += ch.length;
  }
  return { norm, at };
}
/** Everything from the first secret-like word or key shape on (the word it starts in too) is hidden, across lines. */
function redactRaw(text: string): string {
  const { norm, at } = folded(text);
  let first: number | null = null;
  for (const { rx, mix } of RULES) {
    rx.lastIndex = 0;
    for (const m of norm.matchAll(rx)) {
      const start = m.index!;
      if (first !== null && start >= first) break;
      if (mix && !(/[A-Za-z]/.test(m[0]) && /[0-9]/.test(m[0]))) continue;
      first = start;
      break;
    }
  }
  if (first === null) return text;
  while (first > 0 && KEY_CHAR.test(norm[first - 1])) first--;
  return text.slice(0, at[first]) + HIDDEN;
}
const PHRASES = [
  { bare: "Running a command", with: "Running {}" }, { bare: "Editing a file", with: "Editing {}" }, { bare: "Writing a file", with: "Writing {}" },
  { bare: "Reading a file", with: "Reading {}" }, { bare: "Searching the code", with: null }, { bare: "Searching the web", with: null },
  { bare: "Reading a web page", with: null }, { bare: "Handing off a part of the work", with: null }, { bare: "Updating its to-do list", with: null },
  { bare: "Using a skill", with: "Using the {} skill" },
];
/** A label (a file's name, a program's) shown only when it is plainly one: short tokens, low entropy, nothing hidden. */
function labelOk(label: string): boolean {
  if (!/^[A-Za-z0-9/._-]{1,64}$/.test(label)) return false;
  for (const t of label.split(/[/._-]/).filter(Boolean)) {
    if (t.length > 32) return false;
    if (/[A-Za-z]/.test(t) && /[0-9]/.test(t) && t.length > 12) return false;
    if (t.length >= 12) {
      const counts = new Map<string, number>();
      for (const c of t) counts.set(c, (counts.get(c) ?? 0) + 1);
      let h = 0;
      for (const n of counts.values()) h -= (n / t.length) * Math.log2(n / t.length);
      if (h >= 3.5) return false;
    }
    if ((t.match(/[a-z][A-Z]/g) ?? []).length > 3) return false;
  }
  return redactRaw(label) === label;
}
/** A step as it may show: one of the phrases, its label only when plain; anything else is "A step". */
function safeStep(text: string): string {
  if (PHRASES.some((p) => p.bare === text)) return text;
  for (const p of PHRASES) {
    if (!p.with) continue;
    const [pre, post] = p.with.split("{}");
    if (text.startsWith(pre) && text.endsWith(post) && text.length > pre.length + post.length)
      return labelOk(text.slice(pre.length, text.length - post.length)) ? text : p.bare;
  }
  return "A step";
}
// ── redact (end) ──

type Item = { at: string | null; kind: "step" | "said"; text: string; n: number };
/** A steps note's lines, oldest first; line i is the session's line first + i. */
function parseFeed(content: string | null | undefined, first = 0): Item[] {
  const out: Item[] = [];
  let i = 0;
  for (const line of (content ?? "").split("\n")) {
    const m = /^- (\S+) · (step|said) ·(?: (.*))?$/.exec(line.trimEnd());
    if (!m) continue;
    const n = first + i++;
    const said = redactRaw(m[3] ?? "").trim();
    const text = m[2] === "step" ? safeStep(said) : said;
    if (text) out.push({ at: Number.isFinite(Date.parse(m[1])) ? m[1] : null, kind: m[2] as Item["kind"], text, n });
  }
  return out;
}

// ── the session's earlier steps, a part at a time (the Uni app's sessionWords.ts feedPages, withHead, partBefore,
// withPart): the steps note holds the newest lines from `first` of `total`; `parts` hold the earlier ones, each a note
// of its own; the first `dropped` are no longer kept. A part may overlap the note's own lines: they are counted once.
type Part = { id: string; first: number; n: number };
type Pages = { first: number; total: number; dropped: number; parts: Part[] };
type Held = { items: Item[]; from: number; to: number };
const HELD_MAX = 5_400;
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
function feedPages(metadata: unknown): Pages | null {
  const md = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  const first = count(md.first), total = count(md.total);
  if (first === null || total === null || first > total) return null;
  let parts: Part[] = [];
  for (const p of Array.isArray(md.parts) ? md.parts : []) {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(o.id) ? o.id : null, f = count(o.first), n = count(o.n);
    const prev = parts[parts.length - 1];
    if (!id || f === null || !n || f >= first || (prev && prev.first + prev.n !== f)) { parts = []; continue; }
    parts.push({ id, first: f, n });
  }
  const last = parts[parts.length - 1];
  if (last && last.first + last.n < first) parts = [];
  return { first, total, dropped: count(md.dropped) ?? 0, parts };
}
function withHead(held: Held | null, head: readonly Item[], pages: Pages): Held {
  const floor = Math.max(pages.dropped, pages.total - HELD_MAX);
  if (held && held.from < pages.first && held.to >= pages.first) {
    const kept = held.items.filter((it) => it.n < pages.first && it.n >= floor);
    return { items: [...kept, ...head], from: Math.max(held.from, Math.min(floor, pages.first)), to: pages.total };
  }
  return { items: [...head], from: pages.first, to: pages.total };
}
function partBefore(pages: Pages | null, from: number): Part | null {
  let best: Part | null = null;
  for (const p of pages?.parts ?? []) if (p.first < from && (!best || p.first > best.first)) best = p;
  return best;
}
function withPart(held: Held, part: Part, lines: readonly Item[]): Held {
  if (!(part.first < held.from && part.first + part.n >= held.from)) return held;
  if (held.to - part.first > HELD_MAX) return held;
  return { items: [...lines.filter((it) => it.n < held.from), ...held.items], from: part.first, to: held.to };
}

// ── words (the Uni app's live.ts plainTitle, resultWords): no task numbers, run ids or the launcher's own lines ──
function plainTitle(raw: string): string {
  return raw.replace(/\((?:resume|resumes|fork)\s+[a-z0-9]{8}\)/gi, "").replace(/\s*\([a-z0-9]{8}\)/g, "").replace(/\s*\([^)]{0,12}$/, "").replace(/\(\d+\)\s*$/, "").replace(/\bT-\d+[a-z]?\b:?/gi, "")
    .replace(/\s{2,}/g, " ").replace(/^[\s·:–—-]+|[\s·:–—-]+$/g, "").trim();
}
function resultWords(summary: string | null): string | null {
  if (!summary) return null;
  const file = /evidence: file (\S+)/.exec(summary)?.[1];
  if (file) return `Left ${file.split("/").pop()}.`;
  if (/evidence: commit (?:[0-9a-f]{6,}|\[hidden\])/.test(summary)) return "Left a commit.";
  if (/^unverified:/.test(summary)) return "Says it finished; nothing it left could be checked yet.";
  if (/unit gone/.test(summary)) return "Its worker was gone; closed when the old runs were tidied.";
  if (/^mts [a-z0-9]{8}: \w+$/.test(summary)) return null;
  return plainTitle(summary.replace(/\bmts [a-z0-9]{8}:?\s*/g, "").replace(/\brun=[a-z0-9]{8}\b/g, "")) || null;
}
/** Why a session ended, in a sentence (the Uni app's live.ts endWhy and sessionWords.ts endWords): mts's `ended` word,
 *  else its closing line; `resumesAt` when it picks up again after a session limit. */
const END_WHYS = ["done", "unverified", "blocked", "stopped", "killed", "limit", "turns", "context", "failed", "lost", "never_started"];
function endWords(state: string, ended: unknown, summary: unknown, note: string | null, resumesAt: string | null): string | null {
  if (state === "working") return null;
  if (state === "silent") return "Didn't finish: nothing has been heard from it for a while. Its worker may have been lost.";
  const sm = typeof summary === "string" ? summary : "";
  const w = /^mts [a-z0-9]{8}: (\w+)/.exec(sm)?.[1];
  const why = typeof ended === "string" && END_WHYS.includes(ended) ? ended : /^unverified:/.test(sm) ? "unverified" : w === "stopped" || w === "killed" ? w
    : w === "unknown" ? "lost" : w === "failed_to_start" ? "never_started" : state === "finished" ? "done" : state === "waiting" ? "blocked" : state === "failed" ? "failed" : null;
  const room = "Didn't finish: it ran out of room";
  switch (why) {
    case "done": return "Finished.";
    case "unverified": return "Says it finished, but nothing it left could be checked yet.";
    case "blocked": return "Stopped to ask you something.";
    case "stopped": return "Didn't finish: it was stopped on purpose.";
    case "killed": return `Didn't finish: it was cut off before the end.${note ? ` ${note}` : ""}`;
    case "limit": return `${room}: the Claude account reached its session limit.${resumesAt ? ` It picks up again by itself at ${resumesAt}.` : ""}`;
    case "turns": return `${room}: it used every turn it was given.`;
    case "context": return `${room}: its conversation grew too long to go on.`;
    case "failed": return `Didn't finish: it failed.${note ? ` What went wrong: ${note}` : ""}`;
    case "lost": return "Didn't finish: its worker was lost (the machine restarted, or the worker was gone).";
    case "never_started": return `It never started.${note ? ` ${note}` : ""}`;
  }
  return state === "stopped" ? "Didn't finish: it was stopped." : null;
}

/** A short id-like word (a room, a model) shown only when it is plainly one: nothing the redactor would hide. */
const plainWord = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) && redactRaw(v) === v ? v : null);

const HEARD_MS = 2 * 3_600_000, UNHEARD_START_MS = 3 * 3_600_000;
/** What the kit gives at most in one read (src/applet/contract.ts LIMITS.maxNotes): the sessions changed last. Working
 *  ones say what they do every minute, so they are always among them. */
const SHOWN = 50;
type Rec = { id: string; path: string; updatedAt: string | null; fields?: Record<string, any>; body?: string };
type State = "working" | "silent" | "finished" | "stopped" | "waiting" | "failed";
type Run = { id: string; title: string; room: string; state: State; started: string; ended: string | null; now: string | null; nowAt: string | null;
  steps: number; cost: number | null; model: string | null; task: string | null; summary: string | null; feed: string | null; fields: Record<string, any> };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const time = (v: unknown) => { const t = Date.parse(str(v) ?? ""); return Number.isFinite(t) ? t : null; };
const said = (v: unknown, max = 400): string | null => { const s = str(v); return s ? redactRaw(s).slice(0, max) : null; };

function runOf(r: Rec, now: number): Run | null {
  const f = r.fields ?? {};
  const started = time(f.started_at);
  if (started === null) return null;
  const raw = str(f.state);
  let state: State = raw === "running" || raw === "queued" || raw === "stalled" ? "working" : raw === "done" ? "finished" : raw === "blocked" || raw === "decision" ? "waiting"
    : raw === "failed" || raw === "lost" ? "failed" : "stopped";
  if (state === "failed" && /: stopped$/.test(str(f.summary) ?? "")) state = "stopped";
  const nowAt = time(f.doing_at);
  // a note that still says running but hasn't been heard from is silent, not working
  if (state === "working" && (nowAt !== null ? now - nowAt >= HEARD_MS : now - started >= UNHEARD_START_MS)) state = "silent";
  const title = plainTitle(redactRaw(r.path.replace(/^Runs\/\d{4}-\d{2}-\d{2}\s*/, "").replace(/∕/g, "/"))) || "A session";
  return {
    id: r.id, title, room: plainWord(str(f.room)?.replace(/^#/, ""), /^[a-z0-9][a-z0-9_-]{0,39}$/i) ?? "no room", state, started: new Date(started).toISOString(),
    ended: state === "working" ? null : str(f.ended_at) ?? (state === "silent" ? str(f.doing_at) : r.updatedAt),
    now: state === "working" ? (str(f.doing_now) ? safeStep(redactRaw(f.doing_now)) : null) : null, nowAt: str(f.doing_at),
    steps: typeof f.steps === "number" && f.steps > 0 ? Math.floor(f.steps) : 0,
    cost: typeof f.cost === "number" && Number.isFinite(f.cost) && f.cost >= 0 ? f.cost : null, model: plainWord(f.model, /^claude-[a-z]+-\d+(?:-\d+)*(?:\[1m\])?$/),
    task: str(f.task) && /^T-\d+[a-z]?$/i.test(f.task) ? f.task.toUpperCase() : null, summary: resultWords(said(f.summary, 300)), feed: str(f.feed) && /^[A-Za-z0-9_-]{1,128}$/.test(f.feed) ? f.feed : null, fields: f,
  };
}

const WORDS: Record<State, string> = { working: "Working", silent: "Silent", finished: "Finished", stopped: "Stopped", waiting: "Needs you", failed: "Didn't finish" };
const money = (c: number | null) => (c === null ? null : `$${c < 10 ? c.toFixed(2) : Math.round(c)}`);
const agoText = (iso: string | null) => { const a = when.ago(iso); return /^\d+[mh]$/.test(a) ? `${a} ago` : a; };
const lasted = (r: Run) => { const ms = (time(r.ended) ?? Date.now()) - Date.parse(r.started); const m = Math.max(0, Math.round(ms / 60_000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const metaOf = (r: Run) => [r.now ?? (r.state === "working" ? "starting" : r.summary), r.state === "working" ? `${lasted(r)} so far` : agoText(r.ended ?? r.started), money(r.cost), r.task].filter(Boolean).join(" · ");

const CSS = `
.facts { color: var(--muted); font-size: var(--fs-small); margin: 0 0 14px; }
.now { margin: 0 0 14px; }
.part { margin: 14px 0 0; }
.part h2 { font-size: var(--fs-label); color: var(--muted); margin: 0 0 4px; font-weight: 600; }
.part p { margin: 0 0 4px; white-space: pre-wrap; }
.step { color: var(--muted); }
`;

function Steps({ run, again }: { run: Run; again: number }) {
  const [held, setHeld] = useState<Held | null | undefined>(undefined);
  const [pages, setPages] = useState<Pages | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [earlierSaid, setEarlierSaid] = useState<{ gone: number; line: string } | null>(null);
  const [partFailed, setPartFailed] = useState(false);
  // the steps note read again when the session has taken more steps, and on each pull (or the applet shown again):
  // what was held before its first line stays (withHead)
  useEffect(() => {
    let live = true;
    if (!run.feed) { setHeld(null); return; }
    void vault.getRecord(run.feed).then((n: Rec | null) => {
      if (!live) return;
      // the kit answers a note it can't read (gone, or the hub out of reach) with null
      if (!n) { setFailed(true); setHeld((was) => was ?? null); return; }
      const p = feedPages(n.fields) ?? { first: 0, total: 0, dropped: 0, parts: [] };
      const head = parseFeed(n.body, p.first);
      setPages(p); setFailed(false);
      setHeld((was) => withHead(was ?? null, head, { ...p, total: Math.max(p.total, p.first + head.length) }));
    }, () => { if (live) { setFailed(true); setHeld((was) => was ?? null); } });
    return () => { live = false; };
  }, [run.feed, run.steps, again]);
  const part = held ? partBefore(pages, held.from) : null;
  const earlier = part && !(earlierSaid && part.first + part.n <= earlierSaid.gone) ? part : null;
  const more = async () => {
    if (!earlier || !held || busy) return;
    setBusy(true);
    try {
      const n: Rec = await vault.getRecord(earlier.id);
      // mts keeps the last 25 parts and reuses the oldest note for the next 200 steps: a part that now holds other steps
      // is no longer these
      if (!n) throw new Error("unread");
      if ((n.fields ?? {}).first !== earlier.first) { setEarlierSaid({ gone: earlier.first + earlier.n, line: "Those steps are no longer kept." }); return; }
      setPartFailed(false);
      setHeld((h) => (h ? withPart(h, earlier, parseFeed(n.body, earlier.first)) : h));
    } catch { setPartFailed(true); } finally { setBusy(false); }
  };
  if (held === undefined) return <Loading />;
  if (held === null || !held.items.length) return failed ? <Problem>The steps couldn't be read</Problem> : <Empty>No steps written yet.</Empty>;
  const dropped = pages && !earlier && pages.dropped > 0 && held.from <= pages.dropped ? pages.dropped : 0;
  return <>
    {failed ? <p className="facts">The steps couldn't be read again: this is what was read before.</p> : null}
    {partFailed ? <p className="facts">Couldn't load earlier steps.</p> : null}
    {earlier ? <Button small busy={busy} onClick={more}>Earlier steps</Button> : earlierSaid ? <p className="facts">{earlierSaid.line}</p> : dropped ? <p className="facts">The first {dropped} steps are no longer kept.</p> : null}
    <List label="Steps" hideLabel rows={held.items.map((it) => ({ key: String(it.n), title: <span className={it.kind}>{it.text}</span>, aside: it.at ? when.time(it.at) : undefined }))} />
  </>;
}

const PARTS: [string, string][] = [["summary", "What it did"], ["open", "Left open"], ["checks", "Checks"], ["artifacts", "What it made"], ["ripples", "Ripples"]];

function Detail({ run, back, reload, again, error, gone }: { run: Run; back: () => void; reload: () => unknown; again: number; error: string | null; gone: boolean }) {
  const report = run.fields.report && typeof run.fields.report === "object" ? run.fields.report : {};
  const facts = [WORDS[run.state], `#${run.room}`, `started ${when.full(run.started)}`, lasted(run), money(run.cost), run.model, run.task, run.steps ? `${run.steps} steps` : null].filter(Boolean).join(" · ");
  return <Page title={run.title} back={{ label: "Sessions", onPress: back }} onRefresh={reload}>
    <style>{CSS}</style>
    <p className="facts">{facts}</p>
    {error ? <Problem error={error} onRetry={reload}>The sessions couldn't be read again</Problem> : null}
    {gone ? <p className="facts">No longer among the {SHOWN} sessions that changed last: this is how it was.</p> : null}
    {run.now ? <p className="now"><strong>Now:</strong> {run.now} <span className="facts">({agoText(run.nowAt)})</span></p> : null}
    {(() => { const t = endWords(run.state, run.fields.ended, run.fields.summary, said(run.fields.end_note, 200), when.full(run.fields.resumes_at) || null); return t ? <p className="now">{t}</p> : null; })()}
    {PARTS.map(([k, name]) => { const v = said(Array.isArray(report[k]) ? report[k].join("\n") : report[k], 1200); return v ? <section className="part" key={k}><h2>{name}</h2><p>{v}</p></section> : null; })}
    <section className="part"><h2>Steps</h2><Steps key={run.id} run={run} again={again} /></section>
  </Page>;
}

export default function Sessions() {
  const [runs, setRuns] = useState<Run[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Run | null>(null);
  const [again, setAgain] = useState(0);
  const [capped, setCapped] = useState(false);
  const asked = useRef(0);
  const load = async () => {
    const me = ++asked.current;
    setAgain((n) => n + 1);
    try {
      const rows: Rec[] = await vault.queryRecords({ pathPrefix: "Runs/", tag: "run", includeFields: true, limit: SHOWN });
      if (me !== asked.current) return;
      setCapped(rows.length >= SHOWN);
      const now = Date.now();
      const all = rows.map((r) => runOf(r, now)).filter((r): r is Run => !!r);
      setRuns(all.sort((a, b) => Date.parse(b.started) - Date.parse(a.started)));
      setError(null);
    } catch (e) { if (me === asked.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  // read on open, each time it is shown again, and on a pull (here and on a session)
  useEffect(() => { ready().then(load); return onShown((on: boolean) => { if (on) void load(); }); }, []);
  // the session open, as read now; one no longer among those read stays as it was, and says so
  const fresh = open ? runs?.find((r) => r.id === open.id) ?? null : null;
  if (open) return <Detail run={fresh ?? open} gone={!fresh} back={() => setOpen(null)} reload={load} again={again} error={error} />;
  const working = (runs ?? []).filter((r) => r.state === "working");
  // what is working is under Working now; each room lists the rest, newest first
  const done = (runs ?? []).filter((r) => r.state !== "working");
  const rooms = [...new Set(done.map((r) => r.room))];
  return <Page title="Sessions" onRefresh={load}>
    <style>{CSS}</style>
    {error ? <Problem error={error} onRetry={load}>{runs ? "The sessions couldn't be read again" : "The sessions couldn't be read"}</Problem> : null}
    {runs === undefined ? (error ? null : <Loading />) : runs === null ? null : !runs.length ? <Empty>No sessions yet: mts writes one here each time Uni starts a worker.</Empty> : <>
      {working.length ? <List label="Working now" rows={working.map((r) => ({ key: r.id, title: r.title, meta: `#${r.room} · ${metaOf(r)}`, strong: true, onPress: () => setOpen(r) }))} />
        : <p className="facts">Nothing is working now.</p>}
      {rooms.map((room) => <List key={room} label={`#${room}`} rows={done.filter((r) => r.room === room).map((r) => ({ key: r.id, title: r.title, meta: metaOf(r), badge: WORDS[r.state], onPress: () => setOpen(r) }))} />)}
      {capped ? <p className="facts">The {SHOWN} sessions that changed last.</p> : null}
    </>}
  </Page>;
}
