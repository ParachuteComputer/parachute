// Calendar: the person's calendar through their calendar door (the Uni app's T-229 door: events kept as vault notes,
// NIP-98 in front). The applet holds no key: the shell signs each request as the person (service "cal"), and the door
// decides what that key may do (its session names the ops). The next two weeks by day, an event's detail, and the
// everyday changes: add one, move one (its start; the door keeps its length), cancel one. A change is one of the door's
// ops with its own id, kept while the form is the same, so trying again after a lost answer can't make it twice; and the
// event's rev (changed elsewhere meanwhile: refused, and the list read again). A series is shown as
// the door expands it; Move and Cancel on one of its days change that day only. The last two weeks read are kept on
// this device, so the list shows at once and when the door can't be reached.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, List, Loading, Page, Problem, ready, services, toast, useSaved, when } from "parachute";

type Inst = { id: string; uid?: string; recurrence_id: string | null; start: string; end: string; all_day: boolean; tz?: string; title: string;
  status?: string; show_as?: string; location?: string | null; series?: boolean; rev: number };
type Detail = { id: string; rev: number; title: string; description?: string; location?: string | null; attendees?: { address: string; name?: string; partstat?: string }[] };
type Session = { role: string; ops: string[]; tz?: string };
type View = { at: "list" } | { at: "event"; inst: Inst } | { at: "add" } | { at: "move"; inst: Inst };

const DAYS = 14;
const DAY_MS = 86_400_000;
class Refused extends Error { constructor(message: string, readonly status: number) { super(message); } }
/** One call to the door, signed by the shell. A refusal comes back as its words. */
async function door(path: string, body?: unknown): Promise<any> {
  const r: any = await services.fetch("cal", path, body === undefined ? { as: "json" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), as: "json" });
  if (r.status >= 300) throw new Refused(r.body?.error ?? `the calendar door said ${r.status}`, r.status);
  return r.body;
}
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
/** The ops of one form or button: the same change sent again keeps its id (the door answers the same once it landed,
 *  and frees the id when it refused), a different one gets a new id. */
function useOps() {
  const last = useRef<{ body: string; id: string } | null>(null);
  return (body: Record<string, unknown>) => {
    const key = JSON.stringify(body);
    if (last.current?.body !== key) last.current = { body: key, id: newId() };
    return door("op", { ...body, opId: last.current.id });
  };
}
/** Changed elsewhere since it was read (the door's stale base_rev). */
const stale = (e: unknown) => e instanceof Refused && e.status === 409;

/** The day and the time of `d` on this device, as the kit writes them ("2026-11-21", "09:41"). */
const ymd = (d: Date) => when.stamp(d).slice(0, 10);
const hhmm = (d: Date) => when.stamp(d).slice(11).replace("-", ":");
const midnight = (d: Date) => new Date(`${ymd(d)}T00:00:00`);
/** n days on, at midnight (by the calendar: a day with a clock change is still one day) */
const addDays = (d: Date, n: number) => midnight(new Date(midnight(d).getTime() + n * DAY_MS + 12 * 3600_000));
/** An all-day date (YYYY-MM-DD) as this device's midnight; a timed one as its instant. */
const at = (s: string, allDay: boolean) => (allDay ? new Date(`${s}T00:00:00`) : new Date(s));
function span(i: Inst): string {
  return i.all_day ? "All day" : `${when.time(at(i.start, false))} – ${when.time(at(i.end, false))}`;
}
const dayLabel = (d: Date, today: Date) => {
  const n = Math.round((midnight(d).getTime() - today.getTime()) / DAY_MS);
  return n === 0 ? `Today · ${when.date(d)}` : n === 1 ? `Tomorrow · ${when.date(d)}` : when.date(d);
};
/** The instances on each day of the window (an all-day event that spans days is on each of them). */
function byDay(list: Inst[], from: Date): { day: Date; items: Inst[] }[] {
  const days = Array.from({ length: DAYS }, (_, k) => ({ day: addDays(from, k), items: [] as Inst[] }));
  for (const i of list) {
    if (i.status === "cancelled") continue;
    const a = at(i.start, i.all_day), b = at(i.end, i.all_day);
    for (const d of days) {
      const next = addDays(d.day, 1);
      if (a < next && (b > d.day || (a.getTime() === b.getTime() && a >= d.day))) d.items.push(i);
    }
  }
  for (const d of days) d.items.sort((x, y) => Number(y.all_day) - Number(x.all_day) || at(x.start, x.all_day).getTime() - at(y.start, y.all_day).getTime());
  return days;
}
const can = (s: Session | null, o: string) => !!s?.ops.includes(o);

export default function Calendar() {
  const [from, setFrom] = useState(() => midnight(new Date()));
  const [kept, setKept] = useSaved<{ from: string; list: Inst[]; at: string } | null>("window", null);
  const [list, setList] = useState<Inst[] | null>(() => (kept && kept.from === ymd(from) ? kept.list : null));
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>({ at: "list" });
  const today = midnight(new Date());
  const create = useOps(), move = useOps();
  // the window being read: an answer for another (Earlier, Later tapped meanwhile) is dropped
  const want = useRef(ymd(from));

  async function load(start = from) {
    const mine = ymd(start);
    want.current = mine;
    setBusy(true); setError(null);
    try {
      const s = session ?? await door("session");
      setSession({ role: String(s.role), ops: Array.isArray(s.ops) ? s.ops.map(String) : [], tz: s.tz });
      const got = await door(`events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(addDays(start, DAYS).toISOString())}`);
      if (want.current !== mine) return;
      const insts = (got.instances ?? []) as Inst[];
      setList(insts);
      setKept({ from: mine, list: insts, at: new Date().toISOString() });
    } catch (e) { if (want.current === mine) setError(e); }
    finally { if (want.current === mine) setBusy(false); }
  }
  useEffect(() => { void load(from).finally(() => ready()); }, [from]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Another window: what this device kept of it, else nothing until it is read. */
  const go = (d: Date) => { setList(kept && kept.from === ymd(d) ? kept.list : null); setFrom(d); };
  /** After a refused change because the event changed elsewhere: say so, and show it as it is now. */
  const changedElsewhere = () => { toast("It changed elsewhere since; here it is now."); setView({ at: "list" }); void load(); };

  const days = useMemo(() => (list ? byDay(list, from) : []), [list, from]);
  const back = { label: "Calendar", onPress: () => setView({ at: "list" }) };

  if (view.at === "event") return <EventView inst={view.inst} session={session} back={back} onMove={() => setView({ at: "move", inst: view.inst })}
    onDone={() => { setView({ at: "list" }); void load(); }} onStale={changedElsewhere} />;
  if (view.at === "add") return <EventForm title="Add an event" back={back} day={from < today ? today : from} onSave={async (f) => {
    // its zone is the door's own (the person's calendar), the times are instants
    await create({ op: "create", fields: f });
    toast("Added"); setView({ at: "list" }); void load();
  }} />;
  if (view.at === "move") return <EventForm title={`Move ${view.inst.title}`} back={back} inst={view.inst} onSave={async (f) => {
    const i = view.inst;
    // the new start alone: the door keeps the event's length (an evening that ends after midnight, a few days away)
    try { await move({ op: "move", id: i.id, base_rev: i.rev, start: f.start, ...(i.series && i.recurrence_id ? { scope: "this", recurrence_id: i.recurrence_id } : {}) }); }
    catch (e) { if (stale(e)) return changedElsewhere(); throw e; }
    toast("Moved"); setView({ at: "list" }); void load();
  }} />;

  const shown = days.filter((d) => d.items.length || midnight(d.day).getTime() === today.getTime());
  return (
    <Page title="Calendar" onRefresh={() => load()} aside={
      <span className="cal-nav">
        <Button small kind="quiet" onClick={() => go(addDays(from, -7))}>‹ Earlier</Button>
        {from.getTime() !== today.getTime() && <Button small kind="quiet" onClick={() => go(today)}>Today</Button>}
        <Button small kind="quiet" onClick={() => go(addDays(from, 7))}>Later ›</Button>
      </span>}>
      <style>{CSS}</style>
      {can(session, "create") && <p><Button kind="primary" onClick={() => setView({ at: "add" })}>Add an event</Button></p>}
      {error ? <Problem error={error} onRetry={() => load()}>{list ? `Couldn't reach your calendar${kept?.at ? `; this is as it was ${when.ago(kept.at)}` : ""}.` : "Couldn't reach your calendar."}</Problem> : null}
      {!list ? (busy ? <Loading>Reading your calendar…</Loading> : null)
        : !shown.some((d) => d.items.length) ? <Empty>Nothing in these two weeks.</Empty>
        : shown.map((d) => (
          <List key={ymd(d.day)} label={dayLabel(d.day, today)} rows={d.items.length ? d.items.map((i) => ({
            key: `${i.id}:${i.recurrence_id ?? ""}`, title: i.title || "(no title)",
            meta: [span(i), i.location].filter(Boolean).join(" · "),
            aside: i.status === "tentative" ? "Not confirmed" : i.show_as === "free" ? "Free" : undefined,
            onPress: () => setView({ at: "event", inst: i }),
          })) : [{ key: "none", title: "Nothing" }]} />
        ))}
    </Page>
  );
}

function EventView({ inst, session, back, onMove, onDone, onStale }: { inst: Inst; session: Session | null; back: { label: string; onPress: () => void }; onMove: () => void; onDone: () => void; onStale: () => void }) {
  const op = useOps();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { door(`event/${encodeURIComponent(inst.id)}`).then(setDetail, setError); }, [inst.id]);
  const day = when.date(at(inst.start, inst.all_day));
  async function cancel() {
    setBusy(true);
    try {
      await op({ op: "cancel", id: inst.id, base_rev: inst.rev, ...(inst.series && inst.recurrence_id ? { scope: "this", recurrence_id: inst.recurrence_id } : {}) });
      toast("Cancelled"); onDone();
    } catch (e) { if (stale(e)) return onStale(); toast(e instanceof Error ? e.message : String(e), { error: true }); setBusy(false); }
  }
  return (
    <Page title={inst.title || "(no title)"} back={back}>
      <style>{CSS}</style>
      <p>{day} · {span(inst)}{inst.series ? <span className="quiet"> · repeats</span> : null}</p>
      {inst.location ? <p>{inst.location}</p> : null}
      {inst.status === "tentative" ? <p className="quiet">Not confirmed yet.</p> : null}
      {error ? <Problem error={error}>Couldn't read the rest of this event.</Problem> : null}
      {detail?.description ? <p className="cal-desc">{detail.description}</p> : null}
      {detail?.attendees?.length ? <List label="Who" rows={detail.attendees.map((a) => ({ key: a.address, title: a.name || a.address.replace(/^mailto:/, ""), aside: a.partstat === "ACCEPTED" ? "Coming" : a.partstat === "DECLINED" ? "Not coming" : undefined }))} /> : null}
      <p className="cal-actions">
        {can(session, "move") && <Button onClick={onMove}>Move…</Button>}
        {can(session, "cancel") && (sure
          ? <><Button kind="primary" busy={busy} onClick={() => void cancel()}>{inst.series ? "Cancel this day" : "Cancel the event"}</Button><Button kind="quiet" onClick={() => setSure(false)}>Keep it</Button></>
          : <Button onClick={() => setSure(true)}>Cancel…</Button>)}
      </p>
      {inst.series ? <p className="small quiet">Changes here are to this day only; the whole series is changed in the Uni app for now.</p> : null}
    </Page>
  );
}

/** What the form says: for Add, the whole event; for Move, its new start (end is then the old length on, for show). */
type Fields = { title: string; start: string; end: string; all_day: boolean };
function EventForm({ title, back, inst, day, onSave }: { title: string; back: { label: string; onPress: () => void }; inst?: Inst; day?: Date; onSave: (f: Fields) => Promise<void> }) {
  const a = inst ? at(inst.start, inst.all_day) : null;
  const [name, setName] = useState(inst?.title ?? "");
  const [date, setDate] = useState(ymd(a ?? day ?? new Date()));
  const [allDay, setAllDay] = useState(inst?.all_day ?? false);
  const [from, setFrom] = useState(a && !inst?.all_day ? hhmm(a) : "10:00");
  const [to, setTo] = useState("11:00");
  const [busy, setBusy] = useState(false);
  async function save(e?: { preventDefault(): void }) {
    e?.preventDefault();
    let f: Fields;
    if (allDay) {
      f = { title: name.trim(), start: date, end: ymd(addDays(new Date(`${date}T00:00:00`), 1)), all_day: true };
    } else {
      const s = new Date(`${date}T${from}:00`), t = new Date(`${date}T${to}:00`);
      if (!inst && !(t > s)) { toast("It has to end after it starts.", { error: true }); return; }
      f = { title: name.trim(), start: s.toISOString(), end: t.toISOString(), all_day: false };
    }
    if (!inst && !f.title) { toast("Give it a name.", { error: true }); return; }
    setBusy(true);
    try { await onSave(f); } catch (err) { toast(err instanceof Error ? err.message : String(err), { error: true }); setBusy(false); }
  }
  return (
    <Page title={title} back={back}>
      <style>{CSS}</style>
      <form className="cal-form" onSubmit={save}>
        {!inst && <label>What <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lunch with Sam" /></label>}
        <label>Day <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {!inst && <label className="cal-check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>}
        {!allDay && (inst
          ? <label>Starts <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          : <div className="cal-times">
            <label>From <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To <input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>)}
        {inst && <p className="small quiet">It keeps its length.</p>}
        <p><Button kind="primary" busy={busy} onClick={() => void save()}>{inst ? "Move" : "Add"}</Button></p>
      </form>
    </Page>
  );
}

const CSS = `
.cal-nav { display: inline-flex; gap: 4px; }
.cal-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.cal-desc { white-space: pre-wrap; }
.cal-form { display: grid; gap: 12px; max-width: 26rem; }
.cal-form label { display: grid; gap: 4px; font-size: var(--fs-small); color: var(--muted); }
.cal-form input { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
.cal-form .cal-check { display: flex; align-items: center; gap: 8px; color: var(--text); }
.cal-times { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.quiet { color: var(--muted); }
.small { font-size: var(--fs-small); }
`;
