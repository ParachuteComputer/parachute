// Home, for a person with rooms and a journal (the Uni app's first screen, as an applet): what wants you in your rooms,
// the latest from Uni, today's journal and a line to add to it. It is an ordinary applet, written on the kit: it reads
// the relay through the shell (services.relay "rooms", read only: it publishes nothing and answers nothing), reads and
// adds entries in Journal/ (the Journal applet's paths), asks the app for the bar (to find Rooms) and to open Rooms at a
// room on a tap; an entry opens as a note link (link.open). Its install fills UNI (the key whose messages are "from
// Uni"). Nothing here is the shell's.
import { useEffect, useMemo, useRef, useState } from "react";
import { app, Empty, link, List, Loading, Page, Problem, ready, services, toast, vault, when, Write } from "parachute";
import { askOf, chunk, createStore, lastText, now, openAsks, tag, useStore, type Ev } from "component:room";

const UNI = "{{uni}}";
/** Journal/2026/11-19/: where today's entries are (the Journal applet's paths). */
const today = () => `Journal/${when.path(Date.now()).split("/").slice(0, 2).join("/")}/`;
/** Journal/2026/11-19/09-41 First words of it (as the Journal applet names an entry). */
function pathFor(text: string) {
  const words = text.replace(/[#*_`>\[\]\\/:?"<>|]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6).join(" ").slice(0, 48).trim() || "Entry";
  return `Journal/${when.path(Date.now())} ${words}`;
}
/** When an entry was written, from its path. */
const writtenAt = (path: string) => { const m = /(\d{4})\/(\d{2})-(\d{2})\/(\d{2})-(\d{2})/.exec(path); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null; };
const firstLine = (body: string) => body.replace(/_Transcript pending\._/, "Transcribing").replace(/[#*_`>]/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
const hello = () => { const h = +when.path(Date.now()).slice(-5, -3); return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."; };
const DAYS = 14;

type Entry = { id: string; path: string; body?: string };
type Row = { key: string; room: string; roomName: string; text: string; at: number; event?: string };

const CSS = `
.today .sum { margin: 0 0 12px; font: italic var(--fs-lead) var(--serif); color: var(--muted); }
.today .pa-list { margin-top: 14px; }
`;

export default function Home() {
  const st = useMemo(createStore, []);
  const s = useStore(st);
  const [read, setRead] = useState<"reading" | "ok" | "away">("reading");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [rooms, setRooms] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);

  const loadJournal = () => vault.queryRecords({ pathPrefix: today(), includeBody: true, limit: 40 }).then((rows: Entry[]) => setEntries(rows), () => setEntries([]));
  // false once Home is gone: a read that lands later changes nothing
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const loadRooms = async () => {
    const relay = services.relay("rooms");
    try {
      s.me = (await services.me()).pubkey;
      const members: Ev[] = await relay.query([{ kinds: [39002], "#p": [s.me], limit: 500 }]);
      const ids = [...new Set(members.map((e) => tag(e, "d")).filter(Boolean))] as string[];
      const since = now() - DAYS * 86400;
      const parts = await Promise.all(chunk(ids, 100).map((c) => Promise.all([relay.query([{ kinds: [39000], "#d": c }]), relay.query([{ kinds: [9], "#h": c, since, limit: 500 }])])));
      if (!mounted.current) return;
      // what was read now takes the place of what was there: a room archived or left since goes
      s.rooms.clear(); s.msgs.clear();
      for (const [metas, msgs] of parts) {
        for (const m of metas as Ev[]) { const id = tag(m, "d"); if (id && tag(m, "archived") !== "true") s.rooms.set(id, { id, name: tag(m, "name") || id.slice(0, 8), about: "", dm: false }); }
        (msgs as Ev[]).forEach(st.add);
      }
      st.bump(); setRead("ok");
    } catch { if (mounted.current) setRead("away"); }
  };
  useEffect(() => {
    ready().then(async () => {
      void loadJournal();
      // Rooms, as the bar has it: where a tap on a room goes
      app.pins().then((ps: { name: string; href: string }[]) => { if (mounted.current) setRooms(ps.find((p) => p.name === "Rooms")?.href ?? null); }, () => {});
      await loadRooms();
    }, () => setRead("away"));
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
  const roomRows = (rs: Row[], strong: boolean) => rs.map((r) => ({ key: r.key, title: r.text, meta: `#${r.roomName}`, aside: when.ago(r.at * 1000), strong, ...(rooms ? { onPress: () => openRoom(r) } : {}) }));
  return (
    <Page title={hello()} className="today" onRefresh={() => Promise.all([loadJournal(), loadRooms()])}>
      <style>{CSS}</style>
      {read === "reading" ? <Loading>Reading your rooms…</Loading>
        : read === "away" ? <Problem>Your rooms couldn't be read just now</Problem>
        : <p className="sum">{wants.length ? `${wants.length} ${wants.length === 1 ? "thing wants" : "things want"} you.` : "Nothing waits for you."}</p>}
      <Write line enter="send" label="A line for your journal" placeholder="A line for today's journal" value={line} onChange={setLine} onSend={save} send={busy ? "Saving…" : "Save"} busy={busy} />
      {!rooms && read === "ok" && (wants.length > 0 || fromUni.length > 0) && <Empty>Pin Rooms to open these from here.</Empty>}
      {wants.length > 0 && <List label="Wants you" rows={roomRows(wants, true)} />}
      <List label="From Uni" rows={roomRows(fromUni, false)} />
      {read === "ok" && !fromUni.length && <Empty>Nothing from Uni in the last {DAYS} days.</Empty>}
      <List label="Today's journal" rows={sorted.map((e) => ({ key: e.id, title: firstLine(e.body ?? "") || e.path.split("/").pop(), aside: when.time(writtenAt(e.path)), onPress: () => void link.open(e) }))} />
      {entries === null ? <Loading /> : !sorted.length && <Empty>Nothing written today. A line above starts it.</Empty>}
    </Page>
  );
}
