// An area: one area of your life (the garden, a client, a class) as one page. Its room, where you talk with Uni about it,
// beside its notes from the vault: the area's own note (Areas/<area>/<area>) and the rest of its folder, newest first.
// Two columns on a wide screen, the room kept in view; on a phone, one column: the area's note, the room, then the rest.
// Everything it may reach is in its record (applets/area.json): one folder to read, one room on the relay. The room is
// the Room component (applets/room.tsx), the same one the Rooms applet shows; it reads which room, and which key is
// Uni's, from what this applet was allowed (ready()), so the page has nothing of its own to keep in step.
import { useEffect, useRef, useState } from "react";
import { link as kitLink, Note, ready, vault } from "parachute";
import Room from "component:room";

// an app from before note links (11-18) has no link: there only the area's own notes open from a note
const link: { parse: (raw: string) => unknown; follow: (to: string, o?: { from?: string }) => Promise<unknown> } = kitLink ?? { parse: () => null, follow: async () => false };

type Rec = { id: string; path: string; updatedAt: string | null; tags?: string[]; fields?: Record<string, unknown>; body?: string };
type Place = { name: string; folder: string; service: string; room: string };

const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const when = (iso: string | null) => (iso ? DAY.format(new Date(iso)) : "");
/** The area's own note under the page's heading: a first line "# Garden" would only say the heading again. */
const withoutTitle = (body: string, name: string) => body.replace(/^\s*#\s+([^\n]*)\n?/, (line, t: string) => (t.trim() === name ? "" : line));

const CSS = `
:root { color-scheme: light dark; }
body { margin: 0; background: var(--bg); color: var(--text); font: var(--size, 16px)/var(--leading, 1.5) var(--sans); }
.area { max-width: 1240px; margin: 0 auto; padding: 0 var(--pad, 16px); display: grid; grid-template-columns: minmax(0, 1fr);
  grid-template-areas: "head" "note" "talk" "list"; column-gap: 56px; }
.area > header { grid-area: head; padding: 22px 0 10px; }
.kick { margin: 0; font: 600 calc(var(--size, 16px) * .72) var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
h1 { margin: 2px 0 0; font: 400 calc(var(--size, 16px) * 2.6)/1.05 var(--serif); }
.lede { grid-area: note; padding-bottom: 8px; }
.talk { grid-area: talk; --room-h: 78dvh; margin: 10px calc(var(--pad, 16px) * -1); border-top: 1px solid var(--text); border-bottom: 1px solid var(--line); }
.list { grid-area: list; padding: 14px 0 48px; }
h2 { margin: 18px 0 4px; font: italic 400 1.15em var(--serif); color: var(--muted); }
.notes { list-style: none; margin: 0; padding: 0; }
.notes button { display: flex; width: 100%; gap: 12px; align-items: baseline; padding: 9px 0; background: none; border: 0; border-bottom: 1px solid var(--line);
  text-align: left; cursor: pointer; font: 1.05em var(--serif); color: var(--text); }
.notes button span { flex: 1; }
.notes button time { color: var(--muted); font: .8em var(--sans); }
.notes button[aria-current="true"] span { text-decoration: underline; text-underline-offset: 3px; }
.back { margin: 6px 0 0; padding: 0; border: 0; background: none; color: var(--muted); font: italic 1em var(--serif); cursor: pointer; }
.quiet { color: var(--muted); font-style: italic; font-family: var(--serif); }
@media (min-width: 900px) {
  .area { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); grid-template-areas: "head talk" "note talk" "list talk"; grid-template-rows: auto auto 1fr; }
  .talk { position: sticky; top: 0; align-self: start; --room-h: 100dvh; margin: 0; border: 0; border-left: 1px solid var(--line); }
}
`;

export default function Area() {
  const [place, setPlace] = useState<Place | null>(null);
  const [notes, setNotes] = useState<Rec[] | null>(null);
  const [open, setOpen] = useState<Rec | null>(null);
  const [why, setWhy] = useState("");
  const lede = useRef<HTMLElement>(null);

  useEffect(() => {
    ready().then(async (c: any) => {
      // its room and folder, as its card named them
      const svc = (c?.services ?? []).find((s: any) => s?.kind === "nostr-relay" && s.rooms?.length);
      const folder: string | undefined = (c?.access ?? []).find((r: any) => r?.verbs?.includes("read"))?.path;
      if (!svc || !folder) { setWhy("This page needs one room on a relay and one folder to read: see its record."); return; }
      setPlace({ name: svc.rooms[0].name, folder, service: svc.id, room: svc.rooms[0].id });
      try { setNotes(await vault.queryRecords({ pathPrefix: folder, includeBody: true, limit: 100 })); }
      catch (e: any) { setWhy(`Couldn't read ${folder}: ${e?.message ?? e}`); setNotes([]); }
    });
  }, []);
  useEffect(() => { if (open) lede.current?.scrollIntoView({ block: "start" }); }, [open?.id]);

  if (!place) return <main className="area"><style>{CSS}</style><header><p className="quiet">{why || "Opening…"}</p></header></main>;
  const title = (r: Rec) => r.path.slice(place.folder.length).replace(/\.md$/, "");
  const own = notes?.find((r) => title(r) === place.name) ?? null;
  const rest = (notes ?? []).filter((r) => r !== own).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const shown = open ?? own;
  // a note of the area's opens here; any other link (another note, a note link, a web address) through the kit
  const follow = (target: string) => { const r = notes?.find((x) => title(x) === target || x.path === target); if (r) setOpen(r); else void link.follow(link.parse(target) || /^(https?:|mailto:)/i.test(target) ? target : `[[${target}]]`, { from: shown?.path }); };

  return <main className="area">
    <style>{CSS}</style>
    <header><p className="kick">Area</p><h1>{place.name}</h1></header>
    <section className="lede" ref={lede} aria-label={shown ? title(shown) : `About ${place.name}`}>
      {open && <button type="button" className="back" onClick={() => setOpen(null)}>← {place.name}</button>}
      {shown ? <Note body={shown === own ? withoutTitle(own.body ?? "", place.name) : shown.body ?? ""} path={shown.path} tags={shown.tags} fields={shown.fields} onLink={follow} />
        : notes && <p className="quiet">Nothing written about {place.name} yet. A note at {place.folder}{place.name} shows here.</p>}
    </section>
    <section className="talk" aria-label={`Talk about ${place.name}`}>
      <Room service={place.service} room={place.room} name={place.name} />
    </section>
    <section className="list" aria-label={`Notes in ${place.name}`}>
      {why && <p className="quiet" role="status">{why}</p>}
      {rest.length > 0 && <><h2>Notes</h2><ul className="notes">
        {rest.map((r) => <li key={r.id}><button type="button" aria-current={open?.id === r.id} onClick={() => setOpen(r)}><span>{title(r)}</span><time>{when(r.updatedAt)}</time></button></li>)}
      </ul></>}
    </section>
  </main>;
}
