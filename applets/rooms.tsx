// Rooms: the person's rooms on a Buzz relay (NIP-29 groups), as the Uni app shows them. One applet record; it talks to
// the relay only through the shell (services.relay "rooms": the shell signs in, signs posts and moves files as the person).
// This is the list (newest first, unread, what wants you), search across rooms, and read state; a room itself is the
// Room component (applets/room.tsx, imported below), the same one an area's applet shows.
// Read state is the Uni app's own (kind 30078 "read-state:<slot>", sealed to the person's key), so both apps agree.
// What it asks of this device, through the shell (docs/design/KEYRING.md): a voice note recorded on the shell's own
// sheet (voice), links opened in the browser (app.openLink), a file saved to Downloads (app.save), files picked on the
// shell's picker (app.pick) and a draft kept on this device per room (storage). A notification's tap opens it at the
// room and message it was about (onLaunch).
import { useEffect, useMemo, useRef, useState } from "react";
import { onLaunch, ready, services } from "parachute";
import Room, { ago, chunk, createStore, glyph, lastText, nameOf, now, openAsks, rootOf, tag, tags, textOf, useStore, visible, withoutFences, type Ev, type Store } from "component:room";

type View = { at: "list" } | { at: "room"; id: string; event?: string };

const SLOT = "read-state:70617261636875746500726f6f6d7300"; // this app's slot ("parachute\0rooms\0" in hex)
const CLIENT = "parachute-rooms";

// ── read state, as the Uni app keeps it (max per room across every slot) ──
async function loadRead(relay: any): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const n of await relay.loadPrivate("read-state:").catch(() => [])) {
    try { const b = JSON.parse(n.text); for (const [k, v] of Object.entries(b.contexts ?? {})) if (typeof v === "number" && v > (out[k] ?? 0)) out[k] = v; } catch { /* another app's */ }
  }
  return out;
}

const CSS = `
:root { color-scheme: light dark; }
body { margin: 0; background: var(--bg); color: var(--text); font: var(--size, 16px)/var(--leading, 1.5) var(--sans); }
main { max-width: 760px; margin: 0 auto; padding: 14px var(--pad, 16px) 40px; }
main.in-room { max-width: none; padding: 0; }
h1 { font: 400 calc(var(--size, 16px) * 2)/1.1 var(--serif); margin: 6px 0 14px; }
button { font: inherit; color: inherit; }
.quiet { color: var(--muted); }
.status { color: var(--muted); font-style: italic; font-family: var(--serif); margin: 8px 0; }
.rows { list-style: none; margin: 0; padding: 0; }
.row { display: grid; grid-template-columns: 2.2em 1fr auto; gap: 2px 10px; align-items: baseline; padding: 12px 4px; border-bottom: 1px solid var(--line); cursor: pointer; background: none; border-left: 0; border-right: 0; border-top: 0; width: 100%; text-align: left; }
.row .g { grid-row: span 2; font-size: 1.3em; color: var(--muted); text-align: center; }
.row .n { font-family: var(--serif); font-size: 1.15em; }
.row.unread .n { font-weight: 700; }
.row .t { color: var(--muted); font-size: .85em; }
.row .last { grid-column: 2 / 4; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pill { margin-left: 8px; font: 600 .78em var(--sans); border: 1.5px solid var(--text); border-radius: 999px; padding: 0 7px; }
.pill.at { background: var(--text); color: var(--bg); }
.wants { grid-column: 2 / 4; font-size: .88em; }
.thread-link { border: 0; background: none; padding: 2px 0; color: var(--muted); cursor: pointer; font-size: .88em; text-decoration: underline; }
.search { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: inherit; font: inherit; margin-bottom: 8px; }
`;

export default function Rooms() {
  const st = useMemo(createStore, []);
  const s = useStore(st);
  const relay = useMemo(() => services.relay("rooms"), []);
  const [status, setStatus] = useState("Reading your rooms…");
  const [view, setView] = useState<View>({ at: "list" });
  const saveTimer = useRef<any>(null);

  const saveRead = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      relay.savePrivate(SLOT, JSON.stringify({ v: 1, client_id: CLIENT, contexts: s.read })).catch(() => {});
    }, 1500);
  };
  /** The room is read up to its newest message (the Room tells it while it is open). */
  const markRead = (room: string, latest: number) => {
    if (latest > (s.read[room] ?? 0)) { s.read[room] = latest; st.bump(); saveRead(); }
  };
  const names = async (pks: string[]) => {
    const want = pks.filter((p) => !s.names.has(p) && !s.asked.has(p));
    want.forEach((p) => s.asked.add(p));
    for (const c of chunk(want, 100)) (await relay.query([{ kinds: [0], authors: c }]).catch(() => [])).forEach(st.add);
    if (want.length) st.bump();
  };

  // opened from a notification: that room, at that message
  useEffect(() => onLaunch((l: { room: string; event?: string }) => setView({ at: "room", id: l.room, ...(l.event ? { event: l.event } : {}) })), []);

  useEffect(() => {
    let stop: (() => void) | null = null, on = true;
    const off = relay.onStatus((x: any) => { if (x.status === "closed" && !x.sub) setStatus(`The relay is away (${x.why ?? "closed"}). Trying again…`); if (x.status === "ready" && !x.sub) setStatus(""); });
    (async () => {
      await ready();
      try {
        s.me = (await services.me()).pubkey;
        const members = await relay.query([{ kinds: [39002], "#p": [s.me], limit: 500 }]);
        const ids = [...new Set(members.map((e: Ev) => tag(e, "d")).filter(Boolean))] as string[];
        const metas = ids.length ? await relay.query(chunk(ids, 100).map((c) => ({ kinds: [39000], "#d": c }))) : [];
        for (const m of metas as Ev[]) {
          const id = tag(m, "d"); if (!id || tag(m, "archived") === "true") continue;
          s.rooms.set(id, { id, name: tag(m, "name") || id.slice(0, 8), about: tag(m, "about") || "", dm: m.tags.some((t) => (t[0] === "t" && t[1] === "dm") || t[0] === "hidden") });
        }
        s.read = await loadRead(relay);
        const rooms = [...s.rooms.keys()];
        // what comes after starts now: anything posted while the history below is read still arrives
        const since = now() - 5;
        for (const c of chunk(rooms, 10)) (await relay.query(c.map((id) => ({ kinds: [9], "#h": [id], limit: 40 })))).forEach(st.add);
        st.bump();
        if (!on) return;
        setStatus(rooms.length ? "" : "No rooms yet. When someone writes to you, the room shows here.");
        await names([...new Set([...s.msgs.values()].flatMap((m) => [...m.values()].map((e) => e.pubkey)))]);
        // what comes after: new posts, edits and deletions, one subscription a room (a Buzz relay sends live events only
        // to a subscription for one room)
        const onEvents = (evs: Ev[]) => { evs.forEach(st.add); st.bump(); void names(evs.map((e) => e.pubkey)); };
        stop = relay.subscribeMany(rooms.slice(0, 90).map((id) => [{ kinds: [9, 5, 40003, 9005], "#h": [id], since }]), onEvents);
      } catch (e: any) { setStatus(`Couldn't read your rooms: ${e?.message ?? e}`); }
    })();
    return () => { on = false; stop?.(); off(); };
  }, []);

  if (view.at === "list") return <main><style>{CSS}</style><RoomList st={st} status={status} open={(id, event) => setView({ at: "room", id, ...(event ? { event } : {}) })} /></main>;
  return <main className="in-room"><style>{CSS}</style>
    <Room key={view.id + (view.event ?? "")} service="rooms" room={view.id} name={s.rooms.get(view.id)?.name} at={view.event} readAt={s.read[view.id] ?? 0}
      onRead={(latest: number) => markRead(view.id, latest)} onBack={() => setView({ at: "list" })} />
  </main>;
}

function unreadOf(s: Store["s"], room: string) {
  const r = s.read[room] ?? 0;
  const list = [...(s.msgs.get(room)?.values() ?? [])].filter((e) => visible(s, e) && e.pubkey !== s.me && e.created_at > r);
  return { n: r ? list.length : 0, mention: r ? list.some((e) => tags(e, "p").includes(s.me)) : false };
}

function RoomList({ st, status, open }: { st: Store; status: string; open: (id: string, event?: string) => void }) {
  const s = st.s;
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Ev[] | null>(null);
  const rows = [...s.rooms.values()].map((room) => {
    const msgs = [...(s.msgs.get(room.id)?.values() ?? [])].filter((e) => visible(s, e) && !rootOf(e));
    const last = msgs.sort((a, b) => b.created_at - a.created_at)[0];
    return { room, last, at: last?.created_at ?? 0, ...unreadOf(s, room.id), asks: openAsks(s, room.id) };
  }).sort((a, b) => b.at - a.at || a.room.name.localeCompare(b.room.name));
  // across every room, by the relay's own search (NIP-50); a hit opens its room at that message
  const search = async () => {
    if (!q.trim()) { setFound(null); return; }
    const ids = [...s.rooms.keys()];
    const out = await services.relay("rooms").query(chunk(ids, 100).map((c) => ({ kinds: [9], "#h": c, search: q.trim(), limit: 30 }))).catch(() => []);
    setFound((out as Ev[]).sort((a, b) => b.created_at - a.created_at));
  };
  return <>
    <h1>Rooms</h1>
    <input className="search" type="search" placeholder="Search your rooms" aria-label="Search your rooms" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
    {found && <section aria-label="Found"><p className="quiet">{found.length ? `${found.length} found` : "Nothing found."} <button className="thread-link" onClick={() => { setFound(null); setQ(""); }}>Clear</button></p>
      <ul className="rows">{found.map((e) => <li key={e.id}><button className="row" onClick={() => open(tag(e, "h")!, e.id)}><span className="g">{glyph(s.rooms.get(tag(e, "h")!)?.name ?? "")}</span><span className="n">{s.rooms.get(tag(e, "h")!)?.name ?? "a room"}</span><span className="t">{ago(e.created_at)}</span><span className="last">{nameOf(s, e.pubkey)}: {withoutFences(textOf(s, e)).slice(0, 160)}</span></button></li>)}</ul></section>}
    {status && <p className="status" role="status">{status}</p>}
    <ul className="rows" aria-label="Your rooms">
      {rows.map(({ room, last, at, n, mention, asks }) => <li key={room.id}>
        <button className={`row${n ? " unread" : ""}`} onClick={() => open(room.id)} data-room={room.id}>
          <span className="g" aria-hidden="true">{glyph(room.name)}</span>
          <span className="n">{room.name}{n > 0 && <span className={`pill${mention ? " at" : ""}`} aria-label={`${n} new${mention ? ", mentions you" : ""}`}>{mention ? "@ " : ""}{n > 99 ? "99+" : n}</span>}</span>
          <span className="t">{at ? ago(at) : ""}</span>
          <span className="last">{last ? <><b>{last.pubkey === s.me ? "You" : nameOf(s, last.pubkey)}:</b> {lastText(s, last)}</> : room.about}</span>
          {asks > 0 && <span className="wants">◆ {asks === 1 ? "Something wants you" : `${asks} things want you`}</span>}
        </button>
      </li>)}
    </ul>
  </>;
}
