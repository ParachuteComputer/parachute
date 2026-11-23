// Rooms: the person's rooms on a Buzz relay (NIP-29 groups), as the Uni app shows them. One applet record; it talks to
// the relay only through the shell (services.relay "rooms": the shell signs in, signs posts and moves files as the person).
// This is the list (newest first, unread, what wants you), search across rooms, and read state; a room itself is the
// Room component (applets/room.tsx, imported below), the same one an area's applet shows.
// Read state is the Uni app's own (kind 30078 "read-state:<slot>", sealed to the person's key), so both apps agree.
// What it asks of this device, through the shell (docs/design/KEYRING.md): a voice note recorded on the shell's own
// sheet (voice), links opened in the browser (links) and notes in the app (open), both through the kit's Link, a file
// saved to Downloads (app.save), files picked on the shell's picker (app.pick), and on this device (storage) a draft
// per room and what the list last showed. A notification's tap opens it at the room and message it was about (onLaunch).
// Opening paints the list as it was last shown (its snapshot: the rooms, their last few messages, the names in them and
// where you had read to, for this relay and key) and then reads the relay again, its queries side by side, and puts what
// it read in place of the snapshot: a room you left, or a message deleted meanwhile, goes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, List, Loading, onLaunch, Page, Problem, ready, Search, services, storage, when } from "parachute";
import Room, { askEndings, chunk, createStore, glyph, lastText, nameOf, now, openAsks, rootOf, tag, tags, textOf, useStore, visible, type Ev, type RoomMeta, type Store } from "component:room";

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
 *  is read from what is inside it), unless it is very long (then cut like text: the list shows a plain line for it). */
const keptText = (text: string) => (/```uni-/.test(text) ? (text.length > 8000 ? text.slice(0, 300) : text) : text.length > 300 ? text.slice(0, 300) : text);

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
.pa-page.in-room { max-width: none; padding: 0; }
/* a Mac: the list of rooms on the left page, the room on the right (docs/LOOK.md) */
.beside { display: grid; grid-template-columns: minmax(300px, 2fr) minmax(0, 3fr); height: 100dvh; }
.beside > .rooms { height: 100dvh; overflow-y: auto; padding: calc(var(--pad) * 1.2) calc(var(--pad) * 1.6); border-right: 1px solid var(--line); background: linear-gradient(to bottom, var(--sky-top), var(--bg) 240px); }
.beside > .rooms h2 { margin: 0 0 var(--gap); font: var(--title-weight) var(--fs-title)/1.1 var(--display, var(--serif)); }
.beside .room .rooms-row { display: none; }
.quiet { color: var(--muted); }
.rooms .note { color: var(--muted); font-style: italic; font-family: var(--serif); margin: 8px 0; }
.rooms .pa-row-meta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rooms .pa-badge:has(.at) { background: var(--text); color: var(--bg); }
`;

/** The rooms in the list's order (the newest talk first), each with its glyph and whether something in it wants you. */
function inOrder(s: Store["s"]) {
  return [...s.rooms.values()].map((room) => {
    const msgs = [...(s.msgs.get(room.id)?.values() ?? [])].filter((e) => visible(s, e) && !rootOf(e));
    const at = msgs.reduce((m, e) => Math.max(m, e.created_at), 0);
    return { id: room.id, name: room.name, glyph: glyph(room.name), wants: openAsks(s, room.id) > 0, at };
  }).sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

/** Room to room in place (docs/LOOK.md, "Motion"): the new room is drawn at once, and the old one, a still copy laid over
 *  it, fades out on --t-swap, so the page is never blank. Nothing of it under still (the time is 0 then). */
function swapOut() {
  const el = document.querySelector<HTMLElement>(".room");
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--t-swap")) || 0;
  if (!el || !ms) return;
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  ghost.removeAttribute("aria-label");
  ghost.style.cssText = `position: fixed; left: ${r.left}px; top: ${r.top}px; width: ${r.width}px; height: ${r.height}px; margin: 0; z-index: 5; pointer-events: none; background: var(--bg); transition: opacity var(--t-swap) var(--ease-out);`;
  document.body.appendChild(ghost);
  // the copy shows the talk where it was scrolled (a copy starts at its top)
  const from = el.querySelector<HTMLElement>(".scroll"), to = ghost.querySelector<HTMLElement>(".scroll");
  if (from && to) to.scrollTop = from.scrollTop;
  void ghost.getBoundingClientRect();
  ghost.style.opacity = "0";
  const gone = () => ghost.remove();
  ghost.addEventListener("transitionend", gone, { once: true });
  setTimeout(gone, ms + 100);
}

/** A room id safe inside a selector (the page's CSS.escape: `CSS` here is this applet's own style text). */
const CSS_ESCAPE = (s: string): string => (globalThis as any).CSS?.escape?.(s) ?? s.replace(/["\\]/g, "\\$&");
type Status = { k: "" | "reading" | "empty" } | { k: "problem" | "note"; t: string; e?: unknown };

export default function Rooms() {
  // an open book (a Mac, a tablet on its side): the list of rooms stays beside the room
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia("(min-width: 900px)").matches);
  useEffect(() => { if (typeof matchMedia !== "function") return; const q = matchMedia("(min-width: 900px)"); const f = () => setWide(q.matches); q.addEventListener?.("change", f); return () => q.removeEventListener?.("change", f); }, []);
  const st = useMemo(createStore, []);
  const s = useStore(st);
  const relay = useMemo(() => services.relay("rooms"), []);
  // where the list stands: being read, a problem, a word about what shows, nothing yet, or nothing to say
  const [status, setStatus] = useState<Status>({ k: "reading" });
  const [view, setView] = useState<View>({ at: "list" });
  // where the list was scrolled to, and where each room was left (distance from its foot; null: at the foot)
  const listY = useRef(0);
  // a search and its finds outlive a visit to one of them: back from a hit, the finds are still there
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Ev[] | null>(null);
  const latest = useRef("");
  const search = { q, setQ, found, setFound, latest };
  const lastRow = useRef<{ sel: string; top: number } | null>(null);
  const places = useRef(new Map<string, number | null>());
  const saveTimer = useRef<any>(null);

  // read state is written only once the relay's own has been read into it: the snapshot's may be older than another
  // device's, and this app's slot is replaced as a whole (a write before then waits for the read)
  const readMerged = useRef(false), readWaiting = useRef(false);
  const saveRead = () => {
    if (!readMerged.current) { readWaiting.current = true; return; }
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
  // (back from it, the list from its top: where the person was before isn't where they came from)
  useEffect(() => onLaunch((l: { room: string; event?: string }) => {
    listY.current = 0; lastRow.current = null;
    setView({ at: "room", id: l.room, ...(l.event ? { event: l.event } : {}) });
  }), []);

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
    const away = (why: string) => setStatus({ k: "problem", t: `The relay is away (${why}). Trying again…` });
    const forget = () => { s.rooms.clear(); s.msgs.clear(); s.names.clear(); s.read = {}; st.bump(); };
    const sync = async () => {
      if (!on) return;
      // back while a read is still waiting on its timeout: that read, empty, will change nothing, so it goes again after
      if (syncing) { again = true; return; }
      syncing = true;
      try {
        const [members, read] = await Promise.all([relay.query([{ kinds: [39002], "#p": [s.me], limit: 500 }]), loadRead(relay)]);
        const ids = [...new Set(members.map((e: Ev) => tag(e, "d")).filter(Boolean))] as string[];
        if (!on || down) return;
        // the relay's read state is in hand: merged now, only forward (a room read on this device a moment ago stays read),
        // so marks made meanwhile can be written, whatever the rest of this read finds
        for (const [k, v] of Object.entries(read)) if (v > (s.read[k] ?? 0)) s.read[k] = v;
        readMerged.current = true;
        if (readWaiting.current) { readWaiting.current = false; saveRead(); }
        // no rooms at all, over a list it painted: more likely a read cut short than every room left at once (so the
        // rare person who did leave every room keeps seeing the old list, with no live updates, until they are in a room
        // again)
        if (painted && !synced && !ids.length) { setStatus({ k: "note", t: "This is what you last saw: the relay didn't list your rooms just now." }); return; }
        // what comes after starts now: anything posted while the history below is read still arrives
        const since = now() - 5;
        // side by side, but at most a few calls at a time: the shell holds 8 of an applet's calls waiting at once
        const [metas, history] = await Promise.all([
          // a call for each hundred rooms: one naming every room is over a frame's request budget past about two hundred
          pooled(chunk(ids, 100), 3, (c) => relay.query([{ kinds: [39000], "#d": c }])).then((xs) => xs.flat()),
          pooled(chunk(ids, 10), 3, (c) => relay.query(c.map((id) => ({ kinds: [9], "#h": [id], limit: 40 })))),
        ]);
        // and how the asks among them ended: one its asker closed (an edit, uni-ask SPEC §3) no longer wants you
        const endings = await askEndings(relay, (history as Ev[][]).flat());
        if (!on || down) return;
        // rooms listed but none of them described: a read cut short, not every room gone (what is painted stays)
        if (painted && !synced && ids.length && !(metas as Ev[]).length) { setStatus({ k: "note", t: "This is what you last saw: the relay didn't describe your rooms just now." }); return; }
        // what was read now takes the snapshot's place: rooms left and messages gone since go with it
        s.rooms.clear();
        for (const m of metas as Ev[]) {
          const id = tag(m, "d"); if (!id || tag(m, "archived") === "true") continue;
          s.rooms.set(id, { id, name: tag(m, "name") || "A room with no name", about: tag(m, "about") || "", dm: m.tags.some((t) => (t[0] === "t" && t[1] === "dm") || t[0] === "hidden") });
        }
        for (const id of ids) s.msgs.set(id, new Map());
        for (const id of [...s.msgs.keys()]) if (!s.rooms.has(id)) s.msgs.delete(id);
        history.flat().forEach(st.add);
        endings.forEach(st.add);
        synced = true;
        st.bump();
        const rooms = [...s.rooms.keys()];
        setStatus(rooms.length ? { k: "" } : { k: "empty" });
        await names([...new Set([...s.msgs.values()].flatMap((m) => [...m.values()].map((e) => e.pubkey)))]);
        if (!on) return;
        // the first read, with its names, is kept at once: a Rooms closed a moment later still opens painted
        keep.current ??= { relay: url, timer: null, written: "" };
        keepSoon(true);
        // what comes after: new posts, edits and deletions, one subscription a room (a Buzz relay sends live events only
        // to a subscription for one room)
        const onEvents = (evs: Ev[]) => { evs.forEach(st.add); st.bump(); keepSoon(); void names(evs.map((e) => e.pubkey)); };
        stop = relay.subscribeMany(rooms.slice(0, 90).map((id) => [{ kinds: [9, 5, 40003, 9005], "#h": [id], since }]), onEvents);
      } catch (e: any) { if (on) setStatus({ k: "problem", t: "Couldn't read your rooms", e }); } finally {
        syncing = false;
        if (again && !synced && !down) { again = false; void sync(); }
      }
    };
    const off = relay.onStatus((x: any) => {
      if (x.sub) return;
      if (x.status === "closed") { down = true; away(x.why ?? "closed"); }
      // ready: a read that never completed goes again (it says why the list may be old until then)
      if (x.status === "ready") { down = false; if (mine && !synced) void sync(); else setStatus({ k: "" }); }
    });
    (async () => {
      const ctx: any = await ready();
      url = String((ctx?.services ?? []).find((x: any) => x?.id === "rooms")?.url ?? "");
      // the list as it was last shown, at once (a snapshot it can't read is dropped)
      try { painted = paint(st, await storage.get(SNAP).catch(() => null), url); }
      catch { painted = null; forget(); storage.set(SNAP, null).catch(() => {}); }
      if (painted && on) { s.me = painted; st.bump(); if (!down) setStatus({ k: "" }); }
      // then whose key this is: another key's list goes at once
      try { s.me = (await services.me()).pubkey; mine = true; }
      catch (e: any) { if (painted) forget(); if (on) setStatus({ k: "problem", t: "Couldn't read your rooms", e }); return; }
      if (painted && painted !== s.me) { painted = null; forget(); setStatus({ k: "reading" }); }
      await sync();
    })();
    return () => { on = false; stop?.(); off(); const k = keep.current; if (k?.timer) { clearTimeout(k.timer); k.timer = null; } };
  }, []);

  // opening a room: drawn at once from what the list holds, and where you left it (each room's place, and the list's)
  const open = (id: string, event?: string) => {
    listY.current = window.scrollY;
    // and where its row was on the screen: back from the room, that row is put there again (rows not drawn yet are
    // only placeholders, so the page's offset alone can land elsewhere)
    const sel = event ? `[data-hit="${CSS_ESCAPE(event)}"]` : `[data-room="${CSS_ESCAPE(id)}"]`;
    const row = document.querySelector(sel);
    lastRow.current = row ? { sel, top: row.getBoundingClientRect().top } : null;
    setView({ at: "room", id, ...(event ? { event } : {}) }); };
  if (view.at === "list") return <Page title="Rooms" className="rooms"><style>{CSS}</style><RoomList st={st} status={status} open={open} y={listY.current} row={lastRow.current} search={search} /></Page>;
  const id = view.id;
  // only messages as the relay sent them (signed, unchanged): a card in one is checked by its signature; the snapshot's
  // shortened copies (no signature) wait for the room's own read; edits go along as their own events
  const held = [...(s.msgs.get(id)?.values() ?? [])].filter((e) => visible(s, e) && (e as Ev & { sig?: string }).sig);
  const heldIds = new Set(held.map((e) => e.id));
  // the held messages with their edits: the newest of anyone, and each editor's newest with no ask block (an ask's close)
  const seed = { msgs: [...held, ...[...s.edits.entries(), ...[...s.plain.entries()].map(([k, ed]) => [k.split(" ")[0], ed] as const)].filter(([t]) => heldIds.has(t)).map(([, ed]) => ed)], names: s.names, me: s.me };
  const place = { get: () => places.current.get(id) ?? null, set: (d: number | null) => { places.current.set(id, d); } };
  // a room scrolls its own talk (room.tsx), its box to write in at the foot; the page around it doesn't move
  const toRoom = (to: string) => { swapOut(); open(to); };
  const theRoom = <Room key={id + (view.event ?? "")} service="rooms" room={id} name={s.rooms.get(id)?.name} at={view.event} readAt={s.read[id] ?? 0} seed={seed} place={place}
      onRead={(latest: number) => markRead(id, latest)} onBack={() => setView({ at: "list" })} rooms={inOrder(s)} onRoom={toRoom} />;
  // a Mac: the list on the left page, the room on the right; a tap there swaps the room in place
  if (wide) return <Page scroll className="in-room"><style>{CSS}</style>
    <div className="beside"><section className="rooms" aria-label="Rooms"><h2>Rooms</h2><RoomList st={st} status={status} open={toRoom} y={0} row={null} search={search} /></section>{theRoom}</div>
  </Page>;
  return <Page scroll className="in-room"><style>{CSS}</style>{theRoom}</Page>;
}

function unreadOf(s: Store["s"], room: string) {
  const r = s.read[room] ?? 0;
  const list = [...(s.msgs.get(room)?.values() ?? [])].filter((e) => visible(s, e) && e.pubkey !== s.me && e.created_at > r);
  return { n: r ? list.length : 0, mention: r ? list.some((e) => tags(e, "p").includes(s.me)) : false };
}

type Searching = { q: string; setQ: (q: string) => void; found: Ev[] | null; setFound: (f: Ev[] | null) => void; latest: { current: string } };
function RoomList({ st, status, open, y, row, search: { q, setQ, found, setFound, latest } }: { st: Store; status: Status; open: (id: string, event?: string) => void; y: number; row: { sel: string; top: number } | null; search: Searching }) {
  const s = st.s;
  // back from a room: the list where you left it
  useLayoutEffect(() => {
    if (y) window.scrollTo(0, y);
    const el = row && document.querySelector(row.sel);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - row!.top);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [...s.rooms.values()].map((room) => {
    const msgs = [...(s.msgs.get(room.id)?.values() ?? [])].filter((e) => visible(s, e) && !rootOf(e));
    const last = msgs.sort((a, b) => b.created_at - a.created_at)[0];
    return { room, last, at: last?.created_at ?? 0, ...unreadOf(s, room.id), asks: openAsks(s, room.id) };
  }).sort((a, b) => b.at - a.at || a.room.name.localeCompare(b.room.name));
  // across every room, by the relay's own search (NIP-50); a hit opens its room at that message
  const search = async (term: string) => {
    // only the newest search lands: one cleared, or overtaken by another, while the relay answered is dropped
    latest.current = term;
    if (!term) { setFound(null); return; }
    const ids = [...s.rooms.keys()];
    const relay = services.relay("rooms");
    // a call for each hundred rooms, as the list's read
    const out = (await pooled(chunk(ids, 100), 3, (c) => relay.query([{ kinds: [9], "#h": c, search: term, limit: 30 }]).catch(() => []))).flat();
    if (latest.current === term) setFound((out as Ev[]).sort((a, b) => b.created_at - a.created_at));
  };
  const roomOf = (e: Ev) => s.rooms.get(tag(e, "h")!);
  return <>
    <Search label="Search your rooms" value={q} onChange={setQ} onSearch={(t) => void search(t)} />
    {found && <section aria-label="Found"><p className="quiet">{found.length ? `${found.length} found` : "Nothing found."} <Button small onClick={() => { latest.current = ""; setFound(null); setQ(""); }}>Back to your rooms</Button></p>
      <List rows={found.map((e) => ({ key: e.id, data: { hit: e.id }, glyph: glyph(roomOf(e)?.name ?? ""), title: roomOf(e)?.name ?? "a room", aside: when.ago(e.created_at), meta: <><b>{e.pubkey === s.me ? "You" : nameOf(s, e.pubkey)}:</b> {lastText(s, e)}</>, onPress: () => open(tag(e, "h")!, e.id) }))} />
    </section>}
    {status.k === "reading" ? <Loading>Reading your rooms…</Loading> : status.k === "problem" ? <Problem error={status.e}>{status.t}</Problem>
      : status.k === "note" ? <p className="note" role="status">{status.t}</p> : status.k === "empty" ? <Empty>No rooms yet. When someone writes to you, the room shows here.</Empty> : null}
    {/* a search's finds take the list's place until it is cleared */}
    {!found && <List label="Your rooms" hideLabel rows={rows.map(({ room, last, at, n, mention, asks }) => ({
      key: room.id, data: { room: room.id }, glyph: glyph(room.name), title: room.name, strong: n > 0, onPress: () => open(room.id),
      badge: n > 0 ? <span className={mention ? "at" : undefined} aria-label={`${n} new${mention ? ", mentions you" : ""}`}>{mention ? "@ " : ""}{n > 99 ? "99+" : n}</span> : undefined,
      aside: at ? when.ago(at) : "",
      meta: last ? <><b>{last.pubkey === s.me ? "You" : nameOf(s, last.pubkey)}:</b> {lastText(s, last)}</> : room.about,
      under: asks > 0 ? `◆ ${asks === 1 ? "Something wants you" : `${asks} things want you`}` : undefined,
    }))} />}
  </>;
}
