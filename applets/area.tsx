// An area: one area of your life (the garden, a client, a class) as one page. Its room, where you talk with Uni about it,
// beside its notes from the vault: the area's own note (Areas/<area>/<area>) and the rest of its folder, newest first.
// Two columns on a wide screen, the room kept in view; on a phone, one column: the area's note, the room, then the rest.
// Everything it may reach is in its record (applets/area.json): one folder to read, one room on the relay. The room is
// the Room component (applets/room.tsx), the same one the Rooms applet shows; it reads which room, and which key is
// Uni's, from what this applet was allowed (ready()), so the page has nothing of its own to keep in step.
import { useEffect, useRef, useState } from "react";
import { Button, link, List, Loading, Note, Page, Problem, ready, vault, when } from "parachute";
import Room from "component:room";

type Rec = { id: string; path: string; updatedAt: string | null; tags?: string[]; fields?: Record<string, unknown>; body?: string };
type Place = { name: string; folder: string; service: string; room: string };

/** The area's own note under the page's heading: a first line "# Garden" would only say the heading again. */
const withoutTitle = (body: string, name: string) => body.replace(/^\s*#\s+([^\n]*)\n?/, (line, t: string) => (t.trim() === name ? "" : line));

const CSS = `
.area .cols { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-areas: "note" "talk" "list"; column-gap: 56px; }
.area .lede { grid-area: note; padding-bottom: 8px; }
.area .talk { grid-area: talk; --room-h: 78dvh; margin: 10px calc(var(--pad) * -1); border-top: var(--line-head); border-bottom: 1px solid var(--line); }
.area .list { grid-area: list; padding: 14px 0 0; }
.area .quiet { color: var(--muted); font-style: italic; font-family: var(--serif); }
/* on a computer the room is the right column from the top of the screen, kept in view; the title and notes the left */
@media (min-width: 900px) {
  .pa-page.area.open { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); grid-template-areas: "pull pull" "head talk" "note talk" "list talk";
    grid-template-rows: auto auto auto 1fr; column-gap: 56px; padding-top: 0; }
  .area > .pa-page-head { grid-area: head; padding-top: calc(var(--pad) * 1.4); }
  .area > .pa-pull { grid-area: pull; }
  .area .cols { display: contents; }
  .area .talk { position: sticky; top: 0; align-self: start; --room-h: 100dvh; margin: 0; border: 0; border-left: 1px solid var(--line); }
}
`;

export default function Area() {
  const [place, setPlace] = useState<Place | null>(null);
  const [notes, setNotes] = useState<Rec[] | null>(null);
  const [open, setOpen] = useState<Rec | null>(null);
  const [why, setWhy] = useState("");
  const [failed, setFailed] = useState<unknown>(null);
  const lede = useRef<HTMLElement>(null);

  const read = async (folder: string) => {
    try { setNotes(await vault.queryRecords({ pathPrefix: folder, includeBody: true, limit: 100 })); setFailed(null); }
    catch (e) { setFailed(e); setNotes((n) => n ?? []); }
  };
  useEffect(() => {
    ready().then(async (c: any) => {
      // its room and folder, as its card named them
      const svc = (c?.services ?? []).find((s: any) => s?.kind === "nostr-relay" && s.rooms?.length);
      const folder: string | undefined = (c?.access ?? []).find((r: any) => r?.verbs?.includes("read"))?.path;
      if (!svc || !folder) { setWhy("This page needs one room on a relay and one folder to read: see its record."); return; }
      setPlace({ name: svc.rooms[0].name, folder, service: svc.id, room: svc.rooms[0].id });
      await read(folder);
    });
  }, []);
  useEffect(() => { if (open) lede.current?.scrollIntoView({ block: "start" }); }, [open?.id]);

  if (!place) return <Page className="area"><style>{CSS}</style>{why ? <p className="quiet">{why}</p> : <Loading>Opening…</Loading>}</Page>;
  const title = (r: Rec) => r.path.slice(place.folder.length).replace(/\.md$/, "");
  const own = notes?.find((r) => title(r) === place.name) ?? null;
  const rest = (notes ?? []).filter((r) => r !== own).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const shown = open ?? own;
  // a note of the area's opens here; any other link (another note, a note link, a web address) through the kit
  const follow = (target: string) => { const r = notes?.find((x) => title(x) === target || x.path === target); if (r) setOpen(r); else void link.follow(link.parse(target) || /^(https?:|mailto:)/i.test(target) ? target : `[[${target}]]`, { from: shown?.path }); };

  return <Page kicker="Area" title={place.name} wide className="area open" onRefresh={() => read(place.folder)}>
    <style>{CSS}</style>
    <div className="cols">
      <section className="lede" ref={lede} aria-label={shown ? title(shown) : `About ${place.name}`}>
        {open && <Button kind="quiet" className="pa-back" onClick={() => setOpen(null)}>← {place.name}</Button>}
        {shown ? <Note body={shown === own ? withoutTitle(own.body ?? "", place.name) : shown.body ?? ""} path={shown.path} tags={shown.tags} fields={shown.fields} onLink={follow} />
          : notes && <p className="quiet">Nothing written about {place.name} yet. A note at {place.folder}{place.name} shows here.</p>}
      </section>
      <section className="talk" aria-label={`Talk about ${place.name}`}>
        <Room service={place.service} room={place.room} name={place.name} />
      </section>
      <section className="list" aria-label={`Notes in ${place.name}`}>
        {failed ? <Problem error={failed} onRetry={() => void read(place.folder)}>Couldn't read {place.folder}</Problem> : null}
        {rest.length > 0 && <List label="Notes" rows={rest.map((r) => ({ key: r.id, title: title(r), aside: when.short(r.updatedAt), current: open?.id === r.id, onPress: () => setOpen(r) }))} />}
      </section>
    </div>
  </Page>;
}
