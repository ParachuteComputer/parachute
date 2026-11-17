// Journal: write a line, see your days. The Uni app's journal, as an applet on the vault it lives in: entries are notes
// in Journal/YYYY/MM-DD/HH-MM <first words>, tagged journal (the app tags what it adds there: its `opens`), so the Uni
// app, the vault and your agent read the same notes. Voice entries made elsewhere show with their transcript.
import { useEffect, useMemo, useState } from "react";
import { Days, Empty, Note, ready, vault } from "parachute";

type Entry = { id: string; path: string; updatedAt: string | null; createdAt?: string | null; body?: string; tags?: string[]; fields?: Record<string, unknown> };

const pad = (n: number) => String(n).padStart(2, "0");
/** Journal/2026/11-17/09-41 First words of it */
export function pathFor(text: string, at = new Date()) {
  const words = text.replace(/[#*_`>\[\]\\/:?"<>|]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6).join(" ").slice(0, 48).trim() || "Entry";
  return `Journal/${at.getFullYear()}/${pad(at.getMonth() + 1)}-${pad(at.getDate())}/${pad(at.getHours())}-${pad(at.getMinutes())} ${words}`;
}
/** When an entry was written: from its path (the Uni app's and this one's), else when it changed. */
function whenOf(e: Entry): Date {
  const m = /^(?:Journal|Notes)\/(\d{4})\/(\d{2})-(\d{2})\/(\d{2})-(\d{2})/.exec(e.path);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return new Date(e.createdAt ?? e.updatedAt ?? Date.now());
}
const DAY = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
function dayWord(d: Date) {
  const t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
  return d.toDateString() === t.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : DAY.format(d);
}

const CSS = `
main { max-width: 720px; margin: 0 auto; padding: 18px var(--pad, 16px) 60px; }
h1 { font: 400 calc(var(--size, 16px) * 2)/1.1 var(--serif); margin: 4px 0 10px; }
textarea { width: 100%; box-sizing: border-box; min-height: 5.5em; padding: 12px 14px; font: 1.05em/1.5 var(--serif); color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius, 10px); resize: vertical; }
.row { display: flex; gap: 10px; align-items: center; margin: 8px 0 18px; }
.save { border: 0; background: var(--text); color: var(--bg); border-radius: 999px; padding: 7px 18px; font: inherit; cursor: pointer; }
.quiet { color: var(--muted); }
.day { font: italic 1em var(--serif); color: var(--muted); margin: 26px 0 6px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
.entry { padding: 6px 0 10px; }
.entry .when { font: 600 .78em var(--sans); color: var(--muted); letter-spacing: .03em; }
.entry .voice { font-size: .8em; color: var(--muted); margin-left: 8px; }
.more { display: block; margin: 16px auto; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 5px 16px; font: inherit; color: inherit; cursor: pointer; }
.err { color: var(--danger); }
`;

export default function Journal() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [limit, setLimit] = useState(60);
  const load = async (n = limit) => {
    const rows: Entry[] = await vault.queryRecords({ pathPrefix: "Journal/", includeBody: true, limit: n });
    setEntries(rows);
  };
  useEffect(() => { ready().then(() => load()).catch((e: Error) => setErr(e.message)); }, []);
  const sorted = useMemo(() => (entries ?? []).map((e) => ({ e, at: whenOf(e) })).sort((a, b) => b.at.getTime() - a.at.getTime()), [entries]);
  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr("");
    try {
      await vault.createRecord({ path: pathFor(body), body });
      setText("");
      await load();
    } catch (e: any) { setErr(`Not saved: ${e?.message ?? e}. Your words are still here.`); }
    setBusy(false);
  };
  let last = "";
  return <main>
    <style>{CSS}</style>
    <h1>Journal</h1>
    <textarea aria-label="Write in your journal" placeholder="What's on your mind?" value={text} onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }} />
    <div className="row">
      <button className="save" onClick={save} disabled={busy || !text.trim()}>{busy ? "Saving…" : "Save"}</button>
      {err ? <span className="err" role="alert">{err}</span> : <span className="quiet">Saved to Journal/ in this vault.</span>}
    </div>
    <Days times={sorted.map((x) => x.at.toISOString())} label="entries, the last four weeks" />
    {entries === null ? <p className="quiet">Reading…</p> : !sorted.length ? <Empty>Nothing yet. Write the first line above.</Empty> : null}
    {sorted.map(({ e, at }) => {
      const day = dayWord(at);
      const head = day !== last ? <h2 className="day" key={`d${e.id}`}>{day}</h2> : null;
      last = day;
      const voice = (e.fields as any)?.source === "voice";
      return [head, <article className="entry" key={e.id} aria-label={`Entry at ${TIME.format(at)}`}>
        <div className="when">{TIME.format(at)}{voice && <span className="voice">voice</span>}</div>
        <Note body={e.body ?? ""} path={e.path} tags={e.tags} />
      </article>];
    })}
    {entries && entries.length >= limit && <button className="more" onClick={() => { const n = limit + 60; setLimit(n); void load(n); }}>Older entries</button>}
  </main>;
}
