// Home, for a person with rooms and a journal (the Uni app's first screen, as an applet): today's date, a line to add to
// the journal, what wants you in your rooms, the latest from Uni, and today's journal. It is an ordinary applet: it reads
// the relay through the shell (services.relay "rooms", read only: it publishes nothing and answers nothing), reads and
// adds entries in Journal/ (the Journal applet's paths), asks the app for the bar (to find Rooms) and to open Rooms at a
// room on a tap; an entry opens as a note link, through the kit. Its install fills UNI (the key whose messages are "from Uni"). Nothing here is the shell's.
import { useEffect, useMemo, useState } from "react";
import { app, link, ready, services, vault } from "parachute";
import { askOf, chunk, createStore, lastText, now, openAsks, tag, useStore, type Ev } from "component:room";

const UNI = "{{uni}}";
const pad = (n: number) => String(n).padStart(2, "0");
const today = (d = new Date()) => `Journal/${d.getFullYear()}/${pad(d.getMonth() + 1)}-${pad(d.getDate())}/`;
/** Journal/2026/11-19/09-41 First words of it (as the Journal applet names an entry). */
function pathFor(text: string, at = new Date()) {
  const words = text.replace(/[#*_`>\[\]\\/:?"<>|]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6).join(" ").slice(0, 48).trim() || "Entry";
  return `${today(at)}${pad(at.getHours())}-${pad(at.getMinutes())} ${words}`;
}
const timeOf = (path: string) => { const m = /\/(\d{2})-(\d{2})[^/]*$/.exec(path); return m ? `${+m[1] % 12 || 12}:${m[2]} ${+m[1] < 12 ? "am" : "pm"}` : ""; };
const firstLine = (body: string) => body.replace(/_Transcript pending\._/, "Transcribing…").replace(/[#*_`>]/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
const hello = () => { const h = new Date().getHours(); return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."; };
const ago = (ts: number) => { const s = now() - ts; return s < 90 ? "now" : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`; };
const DAYS = 14;

type Entry = { id: string; path: string; body?: string };
type Row = { key: string; room: string; roomName: string; text: string; at: number; event?: string };

const CSS = `
main { max-width: 720px; margin: 0 auto; padding: 18px var(--pad, 16px) 40px; color: var(--text); }
.kick { margin: 0; font: 600 calc(var(--size, 16px) * .72) var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }
h1 { margin: 2px 0 4px; font: 400 calc(var(--size, 16px) * 2.4)/1.05 var(--serif); }
.sum { margin: 0 0 12px; font: italic 1.05em/1.4 var(--serif); color: var(--muted); }
.line { display: flex; gap: 8px; margin: 0 0 6px; }
input { flex: 1; min-width: 0; box-sizing: border-box; padding: 10px 14px; font: 1.02em var(--serif); color: var(--text); background: var(--surface); border: 1.5px solid var(--text); border-radius: 999px; }
.save { border: 0; background: var(--text); color: var(--bg); border-radius: 999px; padding: 0 18px; font: inherit; cursor: pointer; }
.save:disabled { opacity: .5; }
h2 { margin: 18px 0 2px; padding-bottom: 4px; border-bottom: 1px solid var(--text); font: 600 .72em var(--sans); letter-spacing: .14em; text-transform: uppercase; }
ul { list-style: none; margin: 0; padding: 0; }
li button { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 10px; width: 100%; padding: 9px 0; border: 0; border-bottom: 1px dotted var(--muted); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.where { font: 600 .82em var(--sans); color: var(--muted); }
.what { grid-column: 1; font: 1.02em/1.35 var(--serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.when { grid-column: 2; grid-row: 1 / 3; align-self: center; font-size: .82em; color: var(--muted); }
.wants .what { font-weight: 600; }
.quiet { margin: 8px 0; font: italic .98em var(--serif); color: var(--muted); }
.err { color: var(--danger); font-size: .9em; }
`;

export default function Home() {
  const st = useMemo(createStore, []);
  const s = useStore(st);
  const [read, setRead] = useState<"reading" | "ok" | "away">("reading");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [rooms, setRooms] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadJournal = () => vault.queryRecords({ pathPrefix: today(), includeBody: true, limit: 40 }).then((rows: Entry[]) => setEntries(rows), () => setEntries([]));
  useEffect(() => {
    let on = true;
    ready().then(async () => {
      void loadJournal();
      // Rooms, as the bar has it: where a tap on a room goes
      app.pins().then((ps: { name: string; href: string }[]) => { if (on) setRooms(ps.find((p) => p.name === "Rooms")?.href ?? null); }, () => {});
      const relay = services.relay("rooms");
      try {
        s.me = (await services.me()).pubkey;
        const members: Ev[] = await relay.query([{ kinds: [39002], "#p": [s.me], limit: 500 }]);
        const ids = [...new Set(members.map((e) => tag(e, "d")).filter(Boolean))] as string[];
        const since = now() - DAYS * 86400;
        const parts = await Promise.all(chunk(ids, 100).map((c) => Promise.all([relay.query([{ kinds: [39000], "#d": c }]), relay.query([{ kinds: [9], "#h": c, since, limit: 500 }])])));
        if (!on) return;
        for (const [metas, msgs] of parts) {
          for (const m of metas as Ev[]) { const id = tag(m, "d"); if (id && tag(m, "archived") !== "true") s.rooms.set(id, { id, name: tag(m, "name") || id.slice(0, 8), about: "", dm: false }); }
          (msgs as Ev[]).forEach(st.add);
        }
        st.bump(); setRead("ok");
      } catch { if (on) setRead("away"); }
    }, () => setRead("away"));
    return () => { on = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { wants, fromUni } = useMemo(() => {
    const wants: Row[] = [], fromUni: Row[] = [];
    for (const [id, msgs] of s.msgs) {
      const room = s.rooms.get(id); if (!room) continue;
      const all = [...msgs.values()].sort((a, b) => b.created_at - a.created_at);
      const waiting = new Set<string>();
      if (openAsks(s, id) > 0) {
        const answered = new Set(all.flatMap((e) => e.tags.filter((t) => t[0] === "q").map((t) => t[1])));
        for (const e of all) { const a = askOf(e); if (a && a.until > now() && !answered.has(e.id) && e.pubkey !== s.me) { waiting.add(e.id); wants.push({ key: e.id, room: id, roomName: room.name, text: a.what, at: e.created_at, event: e.id }); } }
      }
      // Uni's newest line in the room, other than an ask already under Wants you
      const last = all.find((e) => e.pubkey === UNI && !waiting.has(e.id));
      if (last) fromUni.push({ key: last.id, room: id, roomName: room.name, text: lastText(s, last), at: last.created_at, event: last.id });
    }
    return { wants: wants.sort((a, b) => b.at - a.at).slice(0, 6), fromUni: fromUni.sort((a, b) => b.at - a.at).slice(0, 5) };
  }, [s.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRoom = (r: Row) => { if (rooms) void app.open(`${rooms}?room=${encodeURIComponent(r.room)}${r.event ? `&event=${r.event}` : ""}`); };
  // an entry opens as any note link does: through the kit (in the applet that opens journal notes)
  const openEntry = (e: Entry) => link.to(e).then((to: string) => link.follow(to), () => false);
  // a button and Enter, not a form: an applet's frame is sandboxed without forms, so a form's submit never fires
  const save = async () => {
    const body = line.trim();
    if (!body || busy) return;
    setBusy(true); setErr("");
    try { await vault.createRecord({ path: pathFor(body), body }); setLine(""); await loadJournal(); }
    catch (e: any) { setErr(`Not saved: ${e?.message ?? e}. Your words are still here.`); }
    setBusy(false);
  };
  const sorted = [...(entries ?? [])].sort((a, b) => b.path.localeCompare(a.path));
  const sum = read === "reading" ? "Reading your rooms…" : read === "away" ? "Your rooms couldn't be read just now." : wants.length ? `${wants.length} ${wants.length === 1 ? "thing wants" : "things want"} you.` : "Nothing waits for you.";
  const row = (r: Row) => <li key={r.key}><button type="button" onClick={() => openRoom(r)} disabled={!rooms}><span className="where">#{r.roomName}</span><span className="what">{r.text}</span><span className="when">{ago(r.at)}</span></button></li>;
  return (
    <main>
      <style>{CSS}</style>
      <p className="kick">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      <h1>{hello()}</h1>
      <p className="sum">{sum}</p>
      <div className="line">
        <input aria-label="A line for your journal" placeholder="A line for today's journal" value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }} />
        <button className="save" type="button" onClick={() => void save()} disabled={busy || !line.trim()}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {wants.length > 0 && <section className="wants" aria-label="Wants you"><h2>Wants you</h2><ul>{wants.map(row)}</ul></section>}
      <section aria-label="From Uni"><h2>From Uni</h2>
        {fromUni.length ? <ul>{fromUni.map(row)}</ul> : <p className="quiet">{read === "reading" ? "Reading…" : `Nothing from Uni in the last ${DAYS} days.`}</p>}
      </section>
      <section aria-label="Today's journal"><h2>Today's journal</h2>
        {sorted.length ? <ul>{sorted.map((e) => <li key={e.id}><button type="button" onClick={() => void openEntry(e)}><span className="where">{timeOf(e.path)}</span><span className="what">{firstLine(e.body ?? "") || e.path.split("/").pop()}</span></button></li>)}</ul>
          : <p className="quiet">{entries === null ? "Reading…" : "Nothing written today. A line above starts it."}</p>}
      </section>
    </main>
  );
}
