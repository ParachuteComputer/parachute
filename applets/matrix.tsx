// Matrix: your rooms on a Matrix homeserver. The applet holds no password or token: you give the app a token for the
// homeserver (Settings → Applets → Matrix), the app keeps it sealed and adds it to the applet's requests. Rooms, their
// messages, new ones as they come (sync), and sending.
import { useEffect, useRef, useState } from "react";
import { ready, services } from "parachute";

type Ev = { event_id: string; sender: string; origin_server_ts: number; type: string; content: { body?: string; msgtype?: string } };
type Room = { id: string; name: string; last?: Ev };

async function mx(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const r: any = await services.fetch("matrix", path, { method: init.method ?? "GET", headers: { "content-type": "application/json", accept: "application/json" }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}), as: "json" });
  if (r.status === 401) throw new Error("NO_TOKEN");
  if (r.status >= 300) throw new Error(r.body?.error ?? `the homeserver said ${r.status}`);
  return r.body;
}
const room = (id: string) => encodeURIComponent(id);
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const short = (u: string) => u.replace(/^@/, "").split(":")[0];

const CSS = `
main { max-width: 760px; margin: 0 auto; padding: 14px var(--pad, 16px) 110px; }
h1 { font: 400 calc(var(--size, 16px) * 2)/1.1 var(--serif); margin: 4px 0 12px; }
button { font: inherit; color: inherit; cursor: pointer; }
.quiet { color: var(--muted); } .err { color: var(--danger); }
.rows { list-style: none; margin: 0; padding: 0; }
.row { width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line); padding: 11px 2px; display: grid; grid-template-columns: 1fr auto; }
.row .n { font: 1.1em var(--serif); } .row .t { color: var(--muted); font-size: .85em; }
.row .last { grid-column: 1 / 3; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.back { border: 0; background: none; font-style: italic; font-family: var(--serif); color: var(--muted); padding: 6px 0; }
.msg { padding: 6px 0; } .msg .who { font-weight: 600; margin-right: 8px; } .msg .when { color: var(--muted); font-size: .8em; }
.msg .body { white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.mine .body { background: var(--surface); border: 1px solid var(--line); border-radius: 4px 14px 14px 14px; padding: 6px 12px; display: inline-block; }
.composer { position: fixed; left: 0; right: 0; bottom: 0; background: var(--bg); border-top: 1px solid var(--line); }
.composer .in { max-width: 760px; margin: 0 auto; padding: 8px var(--pad, 16px) 12px; display: flex; gap: 8px; }
.composer textarea { flex: 1; resize: none; padding: 8px 10px; font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
.send { border: 0; background: var(--text); color: var(--bg); border-radius: 999px; padding: 8px 16px; }
`;

export default function Matrix() {
  const [me, setMe] = useState("");
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [timeline, setTimeline] = useState<Record<string, Ev[]>>({});
  const since = useRef<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      await ready();
      try {
        setMe((await mx("v3/account/whoami")).user_id);
        const ids: string[] = (await mx("v3/joined_rooms")).joined_rooms;
        const list = await Promise.all(ids.map(async (id) => {
          const name = await mx(`v3/rooms/${room(id)}/state/m.room.name`).then((x) => x.name as string, () => id);
          const msgs = await mx(`v3/rooms/${room(id)}/messages?dir=b&limit=30`).then((x) => (x.chunk as Ev[]).filter((e) => e.type === "m.room.message").reverse(), () => []);
          return { id, name, msgs };
        }));
        if (!on) return;
        setTimeline(Object.fromEntries(list.map((r) => [r.id, r.msgs])));
        setRooms(list.map((r) => ({ id: r.id, name: r.name, last: r.msgs[r.msgs.length - 1] })));
        // what comes after: sync, a long poll the homeserver answers when something happens
        const first = await mx(`v3/sync?timeout=0&filter=${encodeURIComponent(JSON.stringify({ room: { timeline: { limit: 1 } } }))}`);
        since.current = first.next_batch;
        while (on) {
          try {
            const s = await mx(`v3/sync?timeout=20000&since=${encodeURIComponent(since.current!)}`);
            since.current = s.next_batch;
            const joined = s.rooms?.join ?? {};
            const fresh: Record<string, Ev[]> = {};
            for (const [id, r] of Object.entries<any>(joined)) fresh[id] = (r.timeline?.events ?? []).filter((e: Ev) => e.type === "m.room.message");
            if (Object.values(fresh).some((x) => x.length)) {
              setTimeline((t) => { const n = { ...t }; for (const [id, evs] of Object.entries(fresh)) { const have = new Set((n[id] ?? []).map((e) => e.event_id)); n[id] = [...(n[id] ?? []), ...evs.filter((e) => !have.has(e.event_id))]; } return n; });
              setRooms((rs) => (rs ?? []).map((r) => (fresh[r.id]?.length ? { ...r, last: fresh[r.id][fresh[r.id].length - 1] } : r)));
            }
          } catch { await new Promise((r) => setTimeout(r, 3000)); }
        }
      } catch (e: any) {
        // the homeserver refuses without one (401), or the app says it holds none for this applet yet
        setErr(e?.message === "NO_TOKEN" || /token/i.test(e?.message ?? "") ? "The homeserver needs a token. Give this applet one in Settings → Applets → Matrix: the app keeps it, never the applet." : `Couldn't read your rooms: ${e?.message ?? e}`);
      }
    })();
    return () => { on = false; };
  }, []);

  if (open) return <main><style>{CSS}</style><RoomView id={open} name={rooms?.find((r) => r.id === open)?.name ?? "Room"} me={me} events={timeline[open] ?? []} back={() => setOpen(null)}
    sent={(e) => setTimeline((t) => ({ ...t, [open]: [...(t[open] ?? []).filter((x) => x.event_id !== e.event_id), e] }))} /></main>;
  return <main>
    <style>{CSS}</style>
    <h1>Matrix</h1>
    {err && <p className="err" role="alert">{err}</p>}
    {!err && rooms === null && <p className="quiet">Reading your rooms…</p>}
    {rooms && <ul className="rows" aria-label="Your Matrix rooms">{[...rooms].sort((a, b) => (b.last?.origin_server_ts ?? 0) - (a.last?.origin_server_ts ?? 0)).map((r) => <li key={r.id}>
      <button className="row" onClick={() => setOpen(r.id)}><span className="n">{r.name}</span><span className="t">{r.last ? TIME.format(new Date(r.last.origin_server_ts)) : ""}</span>
        <span className="last">{r.last ? `${r.last.sender === me ? "You" : short(r.last.sender)}: ${r.last.content.body ?? ""}` : ""}</span></button>
    </li>)}</ul>}
  </main>;
}

function RoomView({ id, name, me, events, back, sent }: { id: string; name: string; me: string; events: Ev[]; back: () => void; sent: (e: Ev) => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [events.length]);
  const send = async () => {
    const body = text.trim(); if (!body) return;
    setErr("");
    try {
      const txn = `p${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
      const r = await mx(`v3/rooms/${room(id)}/send/m.room.message/${txn}`, { method: "PUT", body: { msgtype: "m.text", body } });
      sent({ event_id: r.event_id, sender: me, origin_server_ts: Date.now(), type: "m.room.message", content: { msgtype: "m.text", body } });
      setText("");
    } catch (e: any) { setErr(`Not sent: ${e?.message ?? e}`); }
  };
  return <>
    <button className="back" onClick={back}>← Matrix</button>
    <h1>{name}</h1>
    <div role="log" aria-label={`Messages in ${name}`}>{events.map((e) => <article key={e.event_id} className={`msg${e.sender === me ? " mine" : ""}`}>
      <div><span className="who">{e.sender === me ? "You" : short(e.sender)}</span><span className="when">{TIME.format(new Date(e.origin_server_ts))}</span></div>
      <div className="body">{e.content.body ?? ""}</div>
    </article>)}</div>
    <div ref={end} />
    {err && <p className="err" role="alert">{err}</p>}
    <div className="composer"><div className="in">
      <textarea rows={1} aria-label={`Message ${name}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); void send(); } }} />
      <button className="send" onClick={send}>Send</button>
    </div></div>
  </>;
}
