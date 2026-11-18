// Rooms: the person's rooms on a Buzz relay (NIP-29 groups), as the Uni app shows them. One applet record; it talks to
// the relay only through the shell (services.relay "rooms": the shell signs in, signs posts and moves files as the person).
// This is the list (newest first, unread, what wants you), search across rooms, and read state; a room itself is the
// Room component (applets/room.tsx, imported below), the same one an area's applet shows.
// Read state is the Uni app's own (kind 30078 "read-state:<slot>", sealed to the person's key), so both apps agree.
// What it asks of this device, through the shell (docs/design/KEYRING.md): a voice note recorded on the shell's own
// sheet (voice), links opened in the browser (app.openLink), a file saved to Downloads (app.save), files picked on the
// shell's picker (app.pick), and on this device (storage) a draft per room and what the list last showed. A notification's
// tap opens it at the room and message it was about (onLaunch).
// Opening paints the list as it was last shown (its snapshot: the rooms, their last few messages, the names in them and
// where you had read to, for this relay and key) and then reads the relay again, its queries side by side, and puts what
// it read in place of the snapshot: a room you left, or a message deleted meanwhile, goes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { onLaunch, ready, services, storage } from "parachute";
import Room, { ago, chunk, createStore, glyph, lastText, nameOf, now, openAsks, rootOf, tag, tags, textOf, useStore, visible, withoutFences, type Ev, type RoomMeta, type Store } from "component:room";

type View = { at: "list" } | { at: "room"; id: string; event?: string };

const SLOT = "read-state:70617261636875746500726f6f6d7300"; // this app's slot ("parachute\0rooms\0" in hex)
const CLIENT = "parachute-rooms";

// ── what the list last showed, kept on this device so the next open paints at once ──
// One value (storage sends it in one call, whatever its size): the rooms, each room's newest few messages as they read
// now, the names in them and where you had read to, for this relay and key. At most 64 KB, so drafts keep the rest.
// It paints before the shell has said whose key this is (that waits for the device's key store): a snapshot of another
// key's list is cleared the moment it says.
type Snapshot = { v: 2; relay: string; me: string; rooms: RoomMeta[]; read: Record<string, number>; names: Record<string, string>; msgs: Ev[] };
const SNAP = "list";
const SNAP_MAX = 64_000;

/** Its size as kept: storage counts UTF-8 bytes. */
const bytesOf = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length;
/** A message as kept: the list shows a line of it, so plain text is cut short; a card or an ask is kept whole (its line
 *  is read from what is inside it). */
const keptText = (text: string) => (/```uni-/.test(text) ? (text.length > 1500 ? text.slice(0, 1500) : text) : text.length > 300 ? text.slice(0, 300) : text);

function snapshotOf(s: Store["s"], relay: string): Snapshot | null {
  // the rooms most recently active first: when not all fit, the list paints those, and the read brings the rest
  const lastAt = (id: string) => Math.max(0, ...[...(s.msgs.get(id)?.values() ?? [])].map((e) => e.created_at));
  const all = [...s.rooms.values()].sort((a, b) => lastAt(b.id) - lastAt(a.id));
  const take = (rooms: RoomMeta[], per: number): Snapshot => {
    // each room's newest messages and newest thread replies, as they read now: its last line, and its counts (without
    // their signatures: nothing checks them here, and the read brings the signed ones)
    const newest = (xs: Ev[]) => xs.sort((a, b) => b.created_at - a.created_at).slice(0, per);
    const msgs = rooms.flatMap((r) => {
      const xs = [...(s.msgs.get(r.id)?.values() ?? [])].filter((e) => visible(s, e));
      return [...newest(xs.filter((e) => !rootOf(e))), ...newest(xs.filter((e) => rootOf(e)))];
    }).map((e) => ({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: keptText(textOf(s, e)) }));
    const authors = new Set(msgs.map((e) => e.pubkey));
    return { v: 2, relay, me: s.me, rooms, read: Object.fromEntries(rooms.filter((r) => s.read[r.id]).map((r) => [r.id, s.read[r.id]])),
      names: Object.fromEntries([...s.names].filter(([k]) => authors.has(k))), msgs };
  };
  for (const per of [8, 4, 2, 1]) { const snap = take(all, per); if (bytesOf(snap) <= SNAP_MAX) return snap; }
  for (let n = Math.floor(all.length * 0.8); n >= 1; n = Math.floor(n * 0.8)) { const snap = take(all.slice(0, n), 1); if (bytesOf(snap) <= SNAP_MAX) return snap; }
  return null;
}

/** At most n of these at a time, in order. */
async function pooled<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
}

/** The list as it was last shown on this relay: its key, or null when there is none. */
function paint(st: Store, snap: unknown, relay: string): string | null {
  const x = snap as Snapshot | null;
  if (!x || x.v !== 2 || x.relay !== relay || typeof x.me !== "string" || !Array.isArray(x.rooms) || !Array.isArray(x.msgs)) return null;
  const s = st.s;
  for (const r of x.rooms) if (r && typeof r.id === "string") s.rooms.set(r.id, r);
  for (const [k, v] of Object.entries(x.names ?? {})) if (typeof v === "string") s.names.set(k, v);
  s.read = { ...x.read };
  x.msgs.forEach(st.add);
  return x.me;
}

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
  // where the list was scrolled to, and where each room was left (distance from its foot; null: at the foot)
  const listY = useRef(0);
  const places = useRef(new Map<string, number | null>());
  const saveTimer = useRef<any>(null);

  const saveRead = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      relay.savePrivate(SLOT, JSON.stringify({ v: 1, client_id: CLIENT, contexts: s.read })).catch(() => {});
    }, 1500);
  };
  /** The room is read up to its newest message (the Room tells it while it is open). */
  const markRead = (room: string, latest: number) => {
    if (latest > (s.read[room] ?? 0)) { s.read[room] = latest; st.bump(); saveRead(); keepSoon(); }
  };
  const names = async (pks: string[]) => {
    const want = pks.filter((p) => !s.names.has(p) && !s.asked.has(p));
    want.forEach((p) => s.asked.add(p));
    for (const c of chunk(want, 100)) (await relay.query([{ kinds: [0], authors: c }]).catch(() => [])).forEach(st.add);
    if (want.length) { st.bump(); keepSoon(); }
  };

  // opened from a notification: that room, at that message
  useEffect(() => onLaunch((l: { room: string; event?: string }) => setView({ at: "room", id: l.room, ...(l.event ? { event: l.event } : {}) })), []);

  // the snapshot is written right after the first read, then a little after the list changed, at most once in two
  // seconds and only when it changed (a frame that closes gets no last word)
  const keep = useRef<{ relay: string; timer: any; written: string } | null>(null);
  const keepSoon = (now = false) => {
    const k = keep.current; if (!k || k.timer) return;
    k.timer = setTimeout(() => {
      k.timer = null;
      const snap = snapshotOf(s, k.relay); if (!snap) return;
      const json = JSON.stringify(snap);
      if (json !== k.written) storage.set(SNAP, snap).then(() => { k.written = json; }, () => {});
    }, now ? 0 : 2000);
  };

  useEffect(() => {
    let stop: (() => void) | null = null, on = true, url = "", painted: string | null = null, mine = false;
    // the relay away: its queries then answer empty or short (a timeout, a dropped connection), so a read made while it
    // is away replaces nothing; the list read goes again when it is back
    let down = false, synced = false, syncing = false, again = false;
    const away = (why: string) => setStatus(`The relay is away (${why}). Trying again…`);
    const forget = () => { s.rooms.clear(); s.msgs.clear(); s.names.clear(); s.read = {}; st.bump(); };
    const sync = async () => {
      if (!on) return;
      // back while a read is still waiting on its timeout: that read, empty, will change nothing, so it goes again after
      if (syncing) { again = true; return; }
      syncing = true;
      try {
        const [members, read] = await Promise.all([relay.query([{ kinds: [39002], "#p": [s.me], limit: 500 }]), loadRead(relay)]);
        const ids = [...new Set(members.map((e: Ev) => tag(e, "d")).filter(Boolean))] as string[];
        // no rooms at all, over a list it painted: more likely a read cut short than every room left at once (so the
        // rare person who did leave every room keeps seeing the old list, with no live updates, until they are in a room
        // again)
        if (!on || down || (painted && !synced && !ids.length)) return;
        // what comes after starts now: anything posted while the history below is read still arrives
        const since = now() - 5;
        // side by side, but at most a few calls at a time: the shell holds 8 of an applet's calls waiting at once
        const [metas, history] = await Promise.all([
          ids.length ? relay.query(chunk(ids, 100).map((c) => ({ kinds: [39000], "#d": c }))) : Promise.resolve([]),
          pooled(chunk(ids, 10), 3, (c) => relay.query(c.map((id) => ({ kinds: [9], "#h": [id], limit: 40 })))),
        ]);
        if (!on || down) return;
        // what was read now takes the snapshot's place: rooms left and messages gone since go with it
        s.rooms.clear();
        for (const m of metas as Ev[]) {
          const id = tag(m, "d"); if (!id || tag(m, "archived") === "true") continue;
          s.rooms.set(id, { id, name: tag(m, "name") || id.slice(0, 8), about: tag(m, "about") || "", dm: m.tags.some((t) => (t[0] === "t" && t[1] === "dm") || t[0] === "hidden") });
        }
        for (const id of ids) s.msgs.set(id, new Map());
        for (const id of [...s.msgs.keys()]) if (!s.rooms.has(id)) s.msgs.delete(id);
        // read state only moves forward: a room read on this device a moment ago stays read
        for (const [k, v] of Object.entries(read)) if (v > (s.read[k] ?? 0)) s.read[k] = v;
        history.flat().forEach(st.add);
        synced = true;
        st.bump();
        const rooms = [...s.rooms.keys()];
        setStatus(rooms.length ? "" : "No rooms yet. When someone writes to you, the room shows here.");
        await names([...new Set([...s.msgs.values()].flatMap((m) => [...m.values()].map((e) => e.pubkey)))]);
        if (!on) return;
        // the first read, with its names, is kept at once: a Rooms closed a moment later still opens painted
        keep.current ??= { relay: url, timer: null, written: "" };
        keepSoon(true);
        // what comes after: new posts, edits and deletions, one subscription a room (a Buzz relay sends live events only
        // to a subscription for one room)
        const onEvents = (evs: Ev[]) => { evs.forEach(st.add); st.bump(); keepSoon(); void names(evs.map((e) => e.pubkey)); };
        stop = relay.subscribeMany(rooms.slice(0, 90).map((id) => [{ kinds: [9, 5, 40003, 9005], "#h": [id], since }]), onEvents);
      } catch (e: any) { if (on) setStatus(`Couldn't read your rooms: ${e?.message ?? e}`); } finally {
        syncing = false;
        if (again && !synced && !down) { again = false; void sync(); }
      }
    };
    const off = relay.onStatus((x: any) => {
      if (x.sub) return;
      if (x.status === "closed") { down = true; away(x.why ?? "closed"); }
      if (x.status === "ready") { const was = down; down = false; setStatus(""); if (was && mine && !synced) void sync(); }
    });
    (async () => {
      const ctx: any = await ready();
      url = String((ctx?.services ?? []).find((x: any) => x?.id === "rooms")?.url ?? "");
      // the list as it was last shown, at once (a snapshot it can't read is dropped)
      try { painted = paint(st, await storage.get(SNAP).catch(() => null), url); }
      catch { painted = null; forget(); storage.set(SNAP, null).catch(() => {}); }
      if (painted && on) { s.me = painted; st.bump(); if (!down) setStatus(""); }
      // then whose key this is: another key's list goes at once
      try { s.me = (await services.me()).pubkey; mine = true; }
      catch (e: any) { if (painted) forget(); if (on) setStatus(`Couldn't read your rooms: ${e?.message ?? e}`); return; }
      if (painted && painted !== s.me) { painted = null; forget(); setStatus("Reading your rooms…"); }
      await sync();
    })();
    return () => { on = false; stop?.(); off(); const k = keep.current; if (k?.timer) { clearTimeout(k.timer); k.timer = null; } };
  }, []);

  // opening a room: drawn at once from what the list holds, and where you left it (each room's place, and the list's)
  const open = (id: string, event?: string) => { listY.current = window.scrollY; setView({ at: "room", id, ...(event ? { event } : {}) }); };
  if (view.at === "list") return <main><style>{CSS}</style><RoomList st={st} status={status} open={open} y={listY.current} /></main>;
  const id = view.id;
  const seed = { msgs: [...(s.msgs.get(id)?.values() ?? [])].filter((e) => visible(s, e)).map((e) => ({ ...e, content: textOf(s, e) })), names: s.names };
  const place = { get: () => places.current.get(id) ?? null, set: (d: number | null) => { places.current.set(id, d); } };
  return <main className="in-room"><style>{CSS}</style>
    <Room key={id + (view.event ?? "")} service="rooms" room={id} name={s.rooms.get(id)?.name} at={view.event} readAt={s.read[id] ?? 0} seed={seed} place={place}
      onRead={(latest: number) => markRead(id, latest)} onBack={() => setView({ at: "list" })} />
  </main>;
}

function unreadOf(s: Store["s"], room: string) {
  const r = s.read[room] ?? 0;
  const list = [...(s.msgs.get(room)?.values() ?? [])].filter((e) => visible(s, e) && e.pubkey !== s.me && e.created_at > r);
  return { n: r ? list.length : 0, mention: r ? list.some((e) => tags(e, "p").includes(s.me)) : false };
}

function RoomList({ st, status, open, y }: { st: Store; status: string; open: (id: string, event?: string) => void; y: number }) {
  const s = st.s;
  // back from a room: the list where you left it
  useLayoutEffect(() => { if (y) window.scrollTo(0, y); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
