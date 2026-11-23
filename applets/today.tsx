// Home, for a person with rooms and a journal (the Uni app's first screen, as an applet): what wants you in your rooms
// (Uni's open asks, and a line that names you since you last read the room, on any device, or wrote in it; in a room
// never read, any such line from the last 14 days), the latest from Uni, today's journal and a line to add to it. It
// is an ordinary applet, written on the kit: it reads the relay through the shell (services.relay "rooms", read only:
// it publishes nothing and answers nothing; it reads the read state Rooms keeps, and its code doesn't write it), reads and
// adds entries in Journal/ (the Journal applet's paths), asks the app for the bar (to find Rooms) and to open Rooms at a
// room on a tap; an entry opens as a note link (link.open). Its install fills UNI (the key whose messages are "from
// Uni"). Shown again (the app keeps it running while the person is elsewhere), or the app back in front, it reads again.
// Nothing here is the shell's.
import { useEffect, useMemo, useRef, useState } from "react";
import { app, Button, Card, Empty, link, List, Loading, onShown, Page, Problem, ready, services, shown, toast, vault, when, Write } from "parachute";
import { askEndings, askNow, askOf, chunk, createStore, lastText, now, openAsks, promptOf, tag, tags, useStore, visible, type Ev } from "component:room";

const UNI = "{{uni}}";
/** Journal/2026/11-19/: where today's entries are (the Journal applet's paths). */
const today = () => `Journal/${when.path(Date.now()).split("/").slice(0, 2).join("/")}/`;
/** An entry's name: its first line with words, up to six of them, ending at the first sentence's end when that comes
 *  sooner ("Walked to the bakery", "How was today"). A number, an initial, a short title or a dotted abbreviation (1.
 *  J. Dr. U.S. p.m.) doesn't end a sentence, nor does punctuation alone (... !!!). The same in Journal and Home
 *  (src/vault/naming.test.ts checks both copies). */
function entryWords(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => /[\p{L}\p{N}]/u.test(l)) ?? "";
  const all = line.replace(/[#*_`>\[\]\\/:"<>|]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6);
  const end = all.findIndex((w) => {
    const bare = w.replace(/[.!?…。]+$/, "");
    return /[.!?…。]$/.test(w) && /[^\p{P}\s]/u.test(w) && !/\.\p{L}/u.test(bare)
      && !/^(\d+|\p{L}|dr|mr|mrs|ms|st|mt|vs|etc|no|jr|sr|prof|sen|rep|gov|gen|approx|fig|inc|mon|tue|tues|thu|thur|thurs|fri|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/iu.test(bare);
  });
  const words = (end >= 0 ? all.slice(0, end + 1) : all).join(" ").replace(/\?/g, "").replace(/[.!…。]+$/, "").replace(/\s+/g, " ").trim();
  // never a code note's name (the vault keeps .html, .tsx, .jsx for code): "index.html" is filed "index html"
  return Array.from(words).slice(0, 48).join("").trim().replace(/\.(html?|tsx|jsx)$/i, " $1") || "Entry";
}
/** Journal/2026/11-19/09-41 First words of it (as the Journal applet names an entry). */
function pathFor(text: string) {
  const words = entryWords(text);
  return `Journal/${when.path(Date.now())} ${words}`;
}
/** When an entry was written, from its path. */
const writtenAt = (path: string) => { const m = /(\d{4})\/(\d{2})-(\d{2})\/(\d{2})-(\d{2})/.exec(path); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null; };
const firstLine = (body: string) => body.replace(/_Transcript pending\._/, "Transcribing").replace(/[#*_`>]/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
const hello = () => { const h = +when.path(Date.now()).slice(-5, -3); return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."; };
const DAYS = 14;

/** When each room was last read, on any device: the read state Rooms keeps (the most recent mark per room, across every
 *  app's slot); none when it can't be read. */
async function readMarks(relay: any): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const n of await relay.loadPrivate("read-state:").catch(() => [])) {
    try { const b = JSON.parse(n.text); for (const [k, v] of Object.entries(b.contexts ?? {})) if (typeof v === "number" && v > (out[k] ?? 0)) out[k] = v; } catch { /* another app's */ }
  }
  return out;
}
/** Marks only move forward: a read that came back short (or a late one) never makes a room unread again. */
const later = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (v > (out[k] ?? 0)) out[k] = v;
  return out;
};
/** A line Home counts by its own rule, never as a mention: an ask (open or not), a command to approve, Uni's card, a
 *  secret request. */
const ownRule = (e: Ev) => !!askOf(e) || !!promptOf(e) || /```uni-(sealed-(approval|morning)|secret-request)\n/.test(e.content);

type Entry = { id: string; path: string; body?: string };
type Row = { key: string; room: string; roomName: string; text: string; at: number; event?: string; ask?: { why?: string; until?: number; kind?: string } };

// Home's look (docs/LOOK.md): the greeting in the big serif in the hour's sky, what wants you as the one white card with
// light on it, the horizon once, then Today on paper, the newest first
const CSS = `
.today .pa-title { font-size: var(--fs-display); line-height: 1.02; }
.today .sum { margin: 4px 0 16px; font: var(--fs-body)/1.4 var(--sans); color: var(--muted); }
.today .ask { margin: 0 0 6px; border: 0; border-radius: calc(var(--radius) * 1.8); background: var(--surface); box-shadow: var(--shadow-card); }
.today .ask .wants { display: flex; flex-wrap: wrap; gap: 2px 8px; margin: 0 0 6px; font: var(--fs-small)/1.3 var(--sans); color: var(--muted); }
.today .ask .wants b { color: var(--primary); }
.today .ask .pa-card-title { margin: 0 0 4px; font: var(--title-weight) var(--fs-head)/1.18 var(--display, var(--serif)); letter-spacing: -.01em; }
.today .ask .why { margin: 0 0 12px; font: var(--fs-body)/1.45 var(--serif); color: var(--muted); }
.today .ask .pa-button.pa-primary { min-height: 44px; }
.today .also .pa-list { margin-top: 0; }
.today .more { margin: 4px 0 0; font: var(--fs-small) var(--sans); color: var(--muted); }
.today .horizon { display: block; width: 100%; height: 26px; margin: 6px 0 10px; overflow: visible; }
.today .horizon path { fill: none; stroke: var(--line); stroke-width: 2; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.today .pa-list { margin-top: 0; }
`;
/** A count in words, to ten: "Two things want you." */
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const counted = (n: number) => n === 0 ? "Nothing wants you." : `${WORDS[n] ?? n} ${n === 1 ? "thing wants" : "things want"} you.`;

export default function Home() {
  const st = useMemo(createStore, []);
  const s = useStore(st);
  const [read, setRead] = useState<"reading" | "ok" | "away">("reading");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [rooms, setRooms] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [marks, setMarks] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const loadJournal = () => vault.queryRecords({ pathPrefix: today(), includeBody: true, limit: 40 }).then((rows: Entry[]) => setEntries(rows), () => setEntries([]));
  // false once Home is gone: a read that lands later changes nothing
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  // the newest read wins: one started later (a pull, a show) makes an earlier one's answer change nothing
  const seq = useRef(0);
  const loadRooms = async () => {
    const turn = ++seq.current;
    const current = () => mounted.current && turn === seq.current;
    const relay = services.relay("rooms");
    try {
      s.me = (await services.me()).pubkey;
      const read = readMarks(relay);
      const members: Ev[] = await relay.query([{ kinds: [39002], "#p": [s.me], limit: 500 }]);
      const ids = [...new Set(members.map((e) => tag(e, "d")).filter(Boolean))] as string[];
      const since = now() - DAYS * 86400;
      const parts = await Promise.all(chunk(ids, 100).map((c) => Promise.all([relay.query([{ kinds: [39000], "#d": c }]), relay.query([{ kinds: [9], "#h": c, since, limit: 500 }])])));
      // how the asks among them ended: one its asker closed (uni-ask SPEC §3) no longer wants you
      const endings = await askEndings(relay, parts.flatMap(([, msgs]) => msgs as Ev[]));
      const got = await read;
      if (!current()) return;
      // a read again over rooms already shown that found none (a slow or dropped relay answers short): what is there stays
      if (s.rooms.size && !parts.some(([metas]) => (metas as Ev[]).length)) { setMarks((m) => later(m, got)); return; }
      // what was read now takes the place of what was there: a room archived or left since goes
      s.rooms.clear(); s.msgs.clear();
      for (const [metas, msgs] of parts) {
        for (const m of metas as Ev[]) { const id = tag(m, "d"); if (id && tag(m, "archived") !== "true") s.rooms.set(id, { id, name: tag(m, "name") || "A room with no name", about: "", dm: false }); }
        (msgs as Ev[]).forEach(st.add);
      }
      setMarks((m) => later(m, got));
      endings.forEach(st.add);
      st.bump(); setRead("ok");
    } catch { if (current() && !s.rooms.size) setRead("away"); }
  };
  useEffect(() => {
    ready().then(async () => {
      void loadJournal();
      // Rooms, as the bar has it: where a tap on a room goes
      app.pins().then((ps: { name: string; href: string }[]) => { if (mounted.current) setRooms(ps.find((p) => p.name === "Rooms")?.href ?? null); }, () => {});
      await loadRooms();
    }, () => setRead("away"));
    // shown again, or the app back in front with Home on screen: what was written or said meanwhile (an entry in
    // Journal, a room read in Rooms or on another device) is there
    let away = false;
    const again = () => { if (mounted.current) { void loadJournal(); void loadRooms(); } };
    const off = typeof onShown === "function" ? onShown((on: boolean) => {
      if (!on) { away = true; return; }
      if (away) { away = false; again(); }
    }) : () => {};
    const front = () => { if (document.visibilityState === "visible" && (typeof shown !== "function" || shown())) again(); };
    document.addEventListener("visibilitychange", front);
    return () => { off(); document.removeEventListener("visibilitychange", front); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { waits, wants, fromUni } = useMemo(() => {
    const wants: Row[] = [], fromUni: Row[] = [];
    for (const [id, msgs] of s.msgs) {
      const room = s.rooms.get(id); if (!room) continue;
      const all = [...msgs.values()].sort((a, b) => b.created_at - a.created_at);
      const waiting = new Set<string>();
      if (openAsks(s, id) > 0) {
        const answered = new Set(all.flatMap((e) => e.tags.filter((t) => t[0] === "q").map((t) => t[1])));
        for (const e of all) { const a = askNow(s, e); if (a && a.until > now() && !answered.has(e.id) && e.pubkey !== s.me && visible(s, e)) { waiting.add(e.id); wants.push({ key: e.id, room: id, roomName: room.name, text: a.what, at: e.created_at, event: e.id, ask: { why: a.why, until: a.until, kind: a.kind } }); } }
      }
      // what names you since you last read the room (on any device) or wrote in it
      const mine = all.find((e) => e.pubkey === s.me)?.created_at ?? 0;
      const seen = Math.max(marks[id] ?? 0, mine);
      for (const e of all) {
        if (e.created_at <= seen) break;
        if (e.pubkey !== s.me && !waiting.has(e.id) && !ownRule(e) && visible(s, e) && tags(e, "p").includes(s.me)) { waiting.add(e.id); wants.push({ key: e.id, room: id, roomName: room.name, text: lastText(s, e), at: e.created_at, event: e.id }); }
      }
      // Uni's newest line in the room, other than one already under Wants you
      const last = all.find((e) => e.pubkey === UNI && !waiting.has(e.id));
      if (last) fromUni.push({ key: last.id, room: id, roomName: room.name, text: lastText(s, last), at: last.created_at, event: last.id });
    }
    return { waits: wants.length, wants: wants.sort((a, b) => b.at - a.at).slice(0, 6), fromUni: fromUni.sort((a, b) => b.at - a.at).slice(0, 5) };
  }, [s.rev, marks]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRoom = (r: Row) => { if (rooms) void app.open(`${rooms}?room=${encodeURIComponent(r.room)}${r.event ? `&event=${r.event}` : ""}`); };
  const save = async () => {
    const body = line.trim();
    if (!body || busy) return;
    setBusy(true);
    const path = pathFor(body);
    try {
      // the same words in the same minute: the path is taken, so it gets the seconds
      await vault.createRecord({ path, body }).catch((e: any) => { if (e?.status === 409 || /conflict|elsewhere/i.test(String(e?.message ?? e))) return vault.createRecord({ path: path.replace(/^(Journal\/[^ ]+)/, `Journal/${when.path(Date.now(), true)}`), body }); throw e; });
      setLine(""); await loadJournal();
    }
    catch (e: any) { toast(`Not saved: ${e?.message ?? e}. Your words are still here.`, { error: true }); }
    setBusy(false);
  };
  const sorted = [...(entries ?? [])].sort((a, b) => b.path.localeCompare(a.path));
  const roomRows = (rs: Row[], strong: boolean) => rs.map((r) => ({ key: r.key, title: r.text, meta: `${r.roomName}`, aside: when.ago(r.at * 1000), strong, ...(rooms ? { onPress: () => openRoom(r) } : {}) }));
  // the one that wants you most (the newest ask, else the newest line that names you): the card; the rest under it
  const first = wants.find((w) => w.ask) ?? wants[0];
  const rest = wants.filter((w) => w !== first);
  // Today, the newest first: Uni's lines and your journal, by the time each was written
  const day = [
    ...fromUni.map((r) => ({ key: r.key, at: r.at * 1000, title: r.text, meta: `Uni, in ${r.roomName}`, onPress: rooms ? () => openRoom(r) : undefined })),
    ...sorted.map((e) => ({ key: e.id, at: writtenAt(e.path)?.getTime() ?? 0, title: firstLine(e.body ?? "") || e.path.split("/").pop() || "", meta: "Your journal", onPress: () => void link.open(e) })),
  ].sort((a, b) => b.at - a.at).map(({ at, ...r }) => ({ ...r, aside: when.short(at) }));
  return (
    <Page title={hello()} start="first" className="today" onRefresh={() => Promise.all([loadJournal(), loadRooms()])}>
      <style>{CSS}</style>
      {read === "reading" ? <Loading>Reading your rooms…</Loading>
        : read === "away" ? <Problem>Your rooms couldn't be read just now</Problem>
        : <p className="sum">{when.date(Date.now())}. {counted(waits)}</p>}
      <Write line dock enter="send" label="A line for your journal" placeholder="A line for today" value={line} onChange={setLine} onSend={save} send={busy ? "Saving…" : "Save"} busy={busy} />
      {!rooms && read === "ok" && (wants.length > 0 || fromUni.length > 0) && <Empty>Pin Rooms to open these from here.</Empty>}
      {first && <section className="wants-you" aria-label="Wants you">
        <div className="ask"><Card>
          <p className="wants"><b>◆ Wants you</b><span>{first.ask?.until ? `by ${when.short(first.ask.until * 1000)}, ` : ""}in {first.roomName}</span></p>
          <h3 className="pa-card-title">{first.text}</h3>
          {first.ask?.why && <p className="why">{first.ask.why}</p>}
          {rooms && <Button kind="primary" onClick={() => openRoom(first)}>{first.ask ? `Answer in ${first.roomName}` : `Open ${first.roomName}`}</Button>}
        </Card></div>
        {rest.length > 0 && <div className="also"><List label="Also wants you" hideLabel rows={roomRows(rest.slice(0, 3), true)} /></div>}
        {waits > 4 && <p className="more">{waits - 4} more in your rooms.</p>}
      </section>}
      {read === "ok" && !first && <Empty>Nothing wants you.</Empty>}
      <svg className="horizon" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0 18C70 6 140 7 210 14S330 24 400 10" /></svg>
      <List label="Today" rows={day} />
      {entries === null ? <Loading /> : !day.length && <Empty>Nothing written today. A line below starts it.</Empty>}
    </Page>
  );
}
