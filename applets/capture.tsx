// Capture: the simple app's quick way in (docs/SIMPLE.md). Write a line or say it; it lands in Inbox/ of this vault as
// a note of its own, named by its first words (a voice note: "Voice note" and when), where Notes, the vault and your AI read it. A voice note is recorded on the app's own sheet
// (voice.record: the applet never touches the microphone), written with "_Transcript pending._" and its recording
// attached with transcribe asked (vault.attach): the hub puts the words in place of the marker. Below the box, the
// latest captures; a tap opens one in the app, where it can be edited.
import { useEffect, useRef, useState } from "react";
import { Empty, Link, link, ready, vault, voice } from "parachute";

type Rec = { id: string; path: string; updatedAt: string | null; createdAt?: string | null; body?: string };
const PENDING = "_Transcript pending._";
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
/** Inbox/<the first words>: a capture is named by what it says (the same words again also get the time: make) */
export function pathFor(text: string, at = new Date()) {
  const words = text.replace(/[#*_`>\[\]\\/:?"<>|^]/g, " ").split(/\s+/).filter(Boolean).slice(0, 10).join(" ").slice(0, 80).replace(/^[.\s]+/, "").trim();
  return `Inbox/${words || `Note ${stamp(at)}`}`;
}
const voicePath = (at: Date) => `Inbox/Voice note ${stamp(at)}`;
/** The vault refused the name: a note is there already (the kit's vault client says 409, "edited elsewhere"). */
const clash = (e: any) => e?.status === 409 || /conflict|elsewhere/i.test(String(e?.message ?? e));
/** A new note at this path; a name already taken (the same words again) gets the time, then a number:
 *  "milk", "milk 2026-11-18 14-05", "milk 2026-11-18 14-05 2", … so only the same words ten times in one minute fail. */
async function make(path: string, body: string, at = new Date(), timed = false): Promise<Rec> {
  // (a name that has the time already, a voice note's, gets only the number)
  const base = timed ? path : `${path} ${stamp(at)}`;
  const names = [path, ...(timed ? [] : [base]), ...Array.from({ length: 8 }, (_, i) => `${base} ${i + 2}`)];
  for (const [i, name] of names.entries()) {
    try { return await vault.createRecord({ path: name, body }); } catch (e) { if (!clash(e) || i === names.length - 1) throw e; }
  }
  throw new Error("no free name");
}
// (a capture made before it was named by its words starts with the time: shown without it)
const nameOf = (r: Rec) => r.path.replace(/^Inbox\//, "").replace(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2}(-\d{2})? ?/, "") || "Note";
const when = (r: Rec) => { const d = new Date(r.createdAt ?? r.updatedAt ?? ""); return Number.isNaN(+d) ? "" : d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }); };
/** While a transcript is awaited: read again every 10 seconds, twelve times, not for ever. */
const LOOKS = 12, LOOK_MS = 10_000;

const CSS = `
main { max-width: 680px; margin: 0 auto; padding: 18px var(--pad, 16px) 40px; color: var(--text); }
h1 { font: 400 calc(var(--size, 16px) * 2.6)/1 var(--serif); margin: 6px 0 14px; letter-spacing: -.01em; }
textarea { width: 100%; box-sizing: border-box; min-height: 7em; padding: 14px 16px; font: 1.15em/1.45 var(--serif); color: var(--text); background: var(--surface); border: 2px solid var(--text); border-radius: var(--radius, 12px); resize: vertical; }
textarea:focus { outline: none; border-color: var(--accent); }
.act { display: flex; gap: 12px; align-items: center; margin: 12px 0 6px; }
.save { flex: 1; border: 0; background: var(--text); color: var(--bg); border-radius: 999px; padding: 13px 18px; font: 600 1.05em var(--sans); cursor: pointer; }
.save:disabled { opacity: .45; }
.mic { border: 0; background: var(--accent); color: var(--bg); border-radius: 999px; padding: 13px 20px; font: 600 1.05em var(--sans); cursor: pointer; white-space: nowrap; }
.mic b { display: inline-block; width: .7em; height: .7em; margin-right: 8px; border-radius: 50%; background: var(--bg); vertical-align: -.02em; }
.mic:disabled { opacity: .5; }
.said { min-height: 1.4em; margin: 4px 2px 18px; color: var(--muted); font-size: .92em; }
.err { color: var(--danger); }
h2 { font: 600 .74em var(--sans); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 18px 0 6px; border-bottom: 1px solid var(--text); padding-bottom: 6px; }
ul { list-style: none; margin: 0; padding: 0; }
li { padding: 10px 0; border-bottom: 1px dotted var(--muted); }
li .t { font: 500 1.05em/1.3 var(--serif); color: var(--text); }
li .w { display: block; font-size: .82em; color: var(--muted); margin-top: 2px; }
li .p { display: block; margin-top: 4px; color: var(--muted); font-style: italic; }
li a { text-decoration: none; }
`;

export default function Capture() {
  const [items, setItems] = useState<Rec[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [err, setErr] = useState("");
  const [addr, setAddr] = useState<Record<string, string>>({});
  const load = async () => {
    const rows: Rec[] = await vault.queryRecords({ pathPrefix: "Inbox/", includeBody: true, limit: 12 });
    setItems(rows);
    const links = await Promise.all(rows.map((r) => link.to(r).catch(() => "")));
    setAddr(Object.fromEntries(rows.map((r, i) => [r.id, links[i]])));
  };
  useEffect(() => { ready().then(load).catch((e: Error) => setErr(e.message)); }, []);
  // a transcript awaited: read again a few times
  const [looks, setLooks] = useState(0);
  const waiting = (items ?? []).some((r) => (r.body ?? "").includes(PENDING));
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!waiting || looks >= LOOKS) return;
    const t = setTimeout(() => { setLooks((n) => n + 1); void loadRef.current().catch(() => {}); }, LOOK_MS);
    return () => clearTimeout(t);
  }, [waiting, looks, items]);

  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(""); setSaid("");
    try {
      await make(pathFor(body), body);
    } catch (e: any) { setErr(`Not saved: ${e?.message ?? e}. Your words are still here.`); setBusy(false); return; }
    setText(""); setSaid("Saved to Inbox.");
    // (saved: a list that can't be read just now doesn't make it unsaved)
    await load().catch(() => {});
    setBusy(false);
  };
  const speak = async () => {
    if (busy) return;
    setErr(""); setSaid("");
    let r: { bytes: ArrayBuffer; type: string; duration: number } | null;
    try { r = await voice.record(); } catch (e: any) { setErr(`Not recorded: ${e?.message ?? e}`); return; }
    if (!r) return;
    setBusy(true);
    try {
      const at = new Date();
      const made: Rec = await make(voicePath(at), PENDING, at, true);
      try { await vault.attach(made.id, r.bytes, r.type, { transcribe: true }); } catch (e) {
        await vault.updateRecord(made.id, { body: "_The recording couldn't be attached._", if_updated_at: (made as any).updatedAt }).catch(() => {});
        throw e;
      }
    } catch (e: any) { setErr(`Voice note not saved: ${e?.message ?? e}`); setBusy(false); return; }
    setLooks(0); setSaid(`Saved ${Math.round(r.duration)} s of voice. The words follow in a moment.`);
    await load().catch(() => {});
    setBusy(false);
  };

  return <main>
    <style>{CSS}</style>
    <h1>Capture</h1>
    <textarea aria-label="Write it down" placeholder="What's on your mind?" value={text} onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }} />
    <div className="act">
      <button className="save" onClick={save} disabled={busy || !text.trim()}>{busy ? "Saving…" : "Save"}</button>
      <button className="mic" onClick={speak} disabled={busy} aria-label="Say it: record a voice note"><b aria-hidden="true" />Say it</button>
    </div>
    <p className={err ? "said err" : "said"} role={err ? "alert" : "status"}>{err || said}</p>
    <h2>Lately in Inbox</h2>
    {items === null ? <p className="said">Reading…</p> : !items.length ? <Empty>Nothing captured yet.</Empty> : (
      <ul aria-label="Captured">
        {items.map((r) => {
          const pending = (r.body ?? "").includes(PENDING);
          const first = (r.body ?? "").replace(PENDING, "").trim().split("\n")[0].slice(0, 140);
          // the name is the link (to the note in the app, where it can be edited); when and the words are plain
          const name = <span className="t">{nameOf(r)}</span>;
          return <li key={r.id}>{addr[r.id] ? <Link to={addr[r.id]}>{name}</Link> : name}<span className="w">{when(r)}</span>
            {pending ? <span className="p">{looks >= LOOKS ? "Still transcribing." : "Transcribing…"}</span> : first && !first.startsWith(nameOf(r)) ? <span className="p">{first}</span> : null}</li>;
        })}
      </ul>
    )}
  </main>;
}
