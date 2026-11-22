// Matrix: your rooms on a Matrix homeserver. The applet holds no password or token: you give the app a token for the
// homeserver (Settings → Applets → Matrix), the app keeps it sealed and adds it to the applet's requests. Rooms, their
// messages, new ones as they come (sync), and sending.
import { useEffect, useRef, useState } from "react";
import { List, Loading, Page, Problem, ready, services, when, Write } from "parachute";

type Ev = { event_id: string; sender: string; origin_server_ts: number; type: string; content: { body?: string; msgtype?: string } };
type Room = { id: string; name: string; last?: Ev };

async function mx(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const r: any = await services.fetch("matrix", path, { method: init.method ?? "GET", headers: { "content-type": "application/json", accept: "application/json" }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}), as: "json" });
  if (r.status === 401) throw new Error("NO_TOKEN");
  if (r.status >= 300) throw new Error(r.body?.error ?? `the homeserver said ${r.status}`);
  return r.body;
}
const room = (id: string) => encodeURIComponent(id);
const short = (u: string) => u.replace(/^@/, "").split(":")[0];

const CSS = `
.matrix { padding-bottom: 110px; }
.msg { padding: 6px 0; } .msg .who { font-weight: 600; margin-right: 8px; } .msg .when { color: var(--muted); font-size: var(--fs-small); }
.msg .body { white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.mine .body { background: var(--surface); border: 1px solid var(--line); border-radius: 4px 14px 14px 14px; padding: 6px 12px; display: inline-block; }
.composer { position: fixed; left: 0; right: 0; bottom: 0; background: var(--bg); border-top: 1px solid var(--line); }
.composer .in { max-width: 760px; margin: 0 auto; padding: 8px var(--pad) 12px; }
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

  if (open) return <RoomView id={open} name={rooms?.find((r) => r.id === open)?.name ?? "Room"} me={me} events={timeline[open] ?? []} back={() => setOpen(null)}
    sent={(e) => setTimeline((t) => ({ ...t, [open]: [...(t[open] ?? []).filter((x) => x.event_id !== e.event_id), e] }))} />;
  return <Page title="Matrix">
    {err && <Problem>{err}</Problem>}
    {!err && rooms === null && <Loading>Reading your rooms…</Loading>}
    {rooms && <List label="Your Matrix rooms" rows={[...rooms].sort((a, b) => (b.last?.origin_server_ts ?? 0) - (a.last?.origin_server_ts ?? 0)).map((r) => ({
      key: r.id, title: r.name, aside: r.last ? when.short(r.last.origin_server_ts) : "", onPress: () => setOpen(r.id),
      meta: r.last ? `${r.last.sender === me ? "You" : short(r.last.sender)}: ${r.last.content.body ?? ""}` : "",
    }))} />}
  </Page>;
}

function RoomView({ id, name, me, events, back, sent }: { id: string; name: string; me: string; events: Ev[]; back: () => void; sent: (e: Ev) => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [events.length]);
  const send = async () => {
    const body = text.trim(); if (!body) return;
    setErr(null);
    try {
      const txn = `p${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
      const r = await mx(`v3/rooms/${room(id)}/send/m.room.message/${txn}`, { method: "PUT", body: { msgtype: "m.text", body } });
      sent({ event_id: r.event_id, sender: me, origin_server_ts: Date.now(), type: "m.room.message", content: { msgtype: "m.text", body } });
      setText("");
    } catch (e) { setErr(e); }
  };
  return <Page scroll title={name} back={{ label: "Matrix", onPress: back }} className="matrix">
    <style>{CSS}</style>
    <div role="log" aria-label={`Messages in ${name}`}>{events.map((e) => <article key={e.event_id} className={`msg${e.sender === me ? " mine" : ""}`}>
      <div><span className="who">{e.sender === me ? "You" : short(e.sender)}</span><span className="when">{when.time(e.origin_server_ts)}</span></div>
      <div className="body">{e.content.body ?? ""}</div>
    </article>)}</div>
    <div ref={end} />
    {err ? <Problem error={err}>Not sent</Problem> : null}
    <div className="composer"><div className="in">
      <Write line enter="send" label={`Message ${name}`} value={text} onChange={setText} onSend={send} send="Send" />
    </div></div>
  </Page>;
}
