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
import { useEffect, useState } from "react";
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

const HEARD_MS = 2 * 3_600_000, UNHEARD_START_MS = 3 * 3_600_000, DAYS = 7;
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
  const title = redactRaw(r.path.replace(/^Runs\/\d{4}-\d{2}-\d{2}\s*/, "")) || "A session";
  return {
    id: r.id, title, room: str(f.room)?.replace(/^#/, "") ?? "no room", state, started: new Date(started).toISOString(),
    ended: state === "working" ? null : str(f.ended_at) ?? (state === "silent" ? str(f.doing_at) : r.updatedAt),
    now: state === "working" ? (str(f.doing_now) ? safeStep(redactRaw(f.doing_now)) : null) : null, nowAt: str(f.doing_at),
    steps: typeof f.steps === "number" && f.steps > 0 ? Math.floor(f.steps) : 0,
    cost: typeof f.cost === "number" && Number.isFinite(f.cost) ? f.cost : null, model: str(f.model) && /^[a-z0-9.-]{1,40}$/.test(f.model) ? f.model : null,
    task: str(f.task) && /^T-\d+[a-z]?$/i.test(f.task) ? f.task.toUpperCase() : null, summary: said(f.summary, 200), feed: str(f.feed) && /^[A-Za-z0-9_-]{1,128}$/.test(f.feed) ? f.feed : null, fields: f,
  };
}

const WORDS: Record<State, string> = { working: "Working", silent: "Silent", finished: "Finished", stopped: "Stopped", waiting: "Needs you", failed: "Didn't finish" };
const money = (c: number | null) => (c === null ? null : `$${c < 10 ? c.toFixed(2) : Math.round(c)}`);
const agoText = (iso: string | null) => { const a = when.ago(iso); return /^\d+[mh]$/.test(a) ? `${a} ago` : a; };
const lasted = (r: Run) => { const ms = (time(r.ended) ?? Date.now()) - Date.parse(r.started); const m = Math.max(0, Math.round(ms / 60_000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
// the task only where the title doesn't start with it
const metaOf = (r: Run) => [r.now ?? (r.state === "working" ? "starting" : r.summary), r.state === "working" ? `${lasted(r)} so far` : agoText(r.ended ?? r.started), money(r.cost),
  r.task && !r.title.toUpperCase().startsWith(r.task) ? r.task : null].filter(Boolean).join(" · ");

const CSS = `
.facts { color: var(--muted); font-size: var(--fs-small); margin: 0 0 14px; }
.now { margin: 0 0 14px; }
.part { margin: 14px 0 0; }
.part h2 { font-size: var(--fs-label); color: var(--muted); margin: 0 0 4px; font-weight: 600; }
.part p { margin: 0 0 4px; white-space: pre-wrap; }
.step { color: var(--muted); }
`;

function Steps({ run }: { run: Run }) {
  const [items, setItems] = useState<Item[] | null | undefined>(undefined);
  const [pages, setPages] = useState<{ first: number; total: number; dropped: number; parts: { id: string; first: number; n: number }[] } | null>(null);
  const [from, setFrom] = useState(0);
  const load = async () => {
    if (!run.feed) { setItems(null); return; }
    const n: Rec = await vault.getRecord(run.feed).catch(() => null);
    if (!n) { setItems(null); return; }
    const md = n.fields ?? {};
    const first = Number.isInteger(md.first) && md.first >= 0 ? md.first : 0;
    const parts = Array.isArray(md.parts) ? md.parts.filter((p: any) => p && /^[A-Za-z0-9_-]{1,128}$/.test(p.id) && Number.isInteger(p.first) && Number.isInteger(p.n)) : [];
    setPages({ first, total: Number.isInteger(md.total) ? md.total : first, dropped: Number.isInteger(md.dropped) ? md.dropped : 0, parts });
    setItems((was) => [...(was ?? []).filter((x) => x.n < first), ...parseFeed(n.body, first)]);
    setFrom((f) => (f && f < first ? f : first));
  };
  useEffect(() => { setItems(undefined); setFrom(0); void load(); }, [run.id, run.feed, run.steps]); // eslint-disable-line react-hooks/exhaustive-deps
  const earlier = pages?.parts.filter((p) => p.first + p.n <= from).pop() ?? null;
  const more = async () => {
    if (!earlier) return;
    const n: Rec = await vault.getRecord(earlier.id).catch(() => null);
    if (!n) return;
    setItems((was) => [...parseFeed(n.body, earlier.first), ...(was ?? [])]);
    setFrom(earlier.first);
  };
  if (items === undefined) return <Loading />;
  if (items === null || !items.length) return <Empty>No steps written yet.</Empty>;
  return <>
    {earlier ? <Button small onClick={more}>Earlier steps</Button> : pages && pages.dropped > 0 && from <= pages.dropped ? <p className="facts">The first {pages.dropped} steps are no longer kept.</p> : null}
    <List label="Steps" hideLabel rows={items.map((it) => ({ key: String(it.n), title: <span className={it.kind}>{it.text}</span>, aside: it.at ? when.time(it.at) : undefined }))} />
  </>;
}

const PARTS: [string, string][] = [["summary", "What it did"], ["open", "Left open"], ["checks", "Checks"], ["artifacts", "What it made"], ["ripples", "Ripples"]];

function Detail({ run, back }: { run: Run; back: () => void }) {
  const report = run.fields.report && typeof run.fields.report === "object" ? run.fields.report : {};
  const facts = [WORDS[run.state], `#${run.room}`, `started ${when.full(run.started)}`, lasted(run), money(run.cost), run.model, run.task, run.steps ? `${run.steps} steps` : null].filter(Boolean).join(" · ");
  return <Page title={run.title} back={{ label: "Sessions", onPress: back }}>
    <style>{CSS}</style>
    <p className="facts">{facts}</p>
    {run.now ? <p className="now"><strong>Now:</strong> {run.now} <span className="facts">({agoText(run.nowAt)})</span></p> : null}
    {said(run.fields.end_note) ? <p className="now">{said(run.fields.end_note)}</p> : null}
    {PARTS.map(([k, name]) => { const v = said(Array.isArray(report[k]) ? report[k].join("\n") : report[k], 1200); return v ? <section className="part" key={k}><h2>{name}</h2><p>{v}</p></section> : null; })}
    <section className="part"><h2>Steps</h2><Steps run={run} /></section>
  </Page>;
}

export default function Sessions() {
  const [runs, setRuns] = useState<Run[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = async () => {
    try {
      const rows: Rec[] = await vault.queryRecords({ pathPrefix: "Runs/", tag: "run", includeFields: true, limit: 200 });
      const now = Date.now();
      const all = rows.map((r) => runOf(r, now)).filter((r): r is Run => !!r && (r.state === "working" || now - Date.parse(r.ended ?? r.started) < DAYS * 86_400_000));
      setRuns(all.sort((a, b) => Date.parse(b.started) - Date.parse(a.started)));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  // read on open, when shown again and on a pull; what is working now says what it is doing at most once a minute
  useEffect(() => { ready().then(load); return onShown((on: boolean) => { if (on) void load(); }); }, []);
  const run = open ? runs?.find((r) => r.id === open) ?? null : null;
  if (run) return <Detail run={run} back={() => setOpen(null)} />;
  const working = (runs ?? []).filter((r) => r.state === "working");
  // what is working is under Working now; each room lists the rest, newest first
  const done = (runs ?? []).filter((r) => r.state !== "working");
  const rooms = [...new Set(done.map((r) => r.room))];
  return <Page title="Sessions" onRefresh={load}>
    <style>{CSS}</style>
    {error ? <Problem error={error} onRetry={load}>The sessions couldn't be read</Problem> : runs === undefined ? <Loading /> : !runs.length ? <Empty>No sessions in the last {DAYS} days.</Empty> : <>
      {working.length ? <List label="Working now" rows={working.map((r) => ({ key: r.id, title: r.title, meta: `#${r.room} · ${metaOf(r)}`, strong: true, onPress: () => setOpen(r.id) }))} />
        : <p className="facts">Nothing is working now.</p>}
      {rooms.map((room) => <List key={room} label={`#${room}`} rows={done.filter((r) => r.room === room).map((r) => ({ key: r.id, title: r.title, meta: metaOf(r), badge: WORDS[r.state], onPress: () => setOpen(r.id) }))} />)}
    </>}
  </Page>;
}
