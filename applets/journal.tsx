// Journal: write a line, see your days. The Uni app's journal, as an applet on the vault it lives in: entries are notes
// in Journal/YYYY/MM-DD/HH-MM <first words>, tagged journal (the app tags what it adds there: its `opens`), so the Uni
// app, the vault and your agent read the same notes. Voice entries made elsewhere show with their transcript.
// Written on the kit (docs/WRITE-AN-APPLET.md): a voice entry is recorded on the app's own sheet (Record), made a note
// with the Uni app's time-only path (voiceNote: the hub puts the words in), and read again while it waits
// (useTranscripts). Dates are the kit's (when), as is the page, the box, the list's states and the toasts.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Days, Empty, Loading, Note, onOpen, Page, Problem, ready, Record, toast, useSaved, useTranscripts, vault, voiceNote, when, Write } from "parachute";

type Entry = { id: string; path: string; updatedAt: string | null; createdAt?: string | null; body?: string; tags?: string[]; fields?: Record<string, unknown> };

/** Journal/2026/11-17/09-41: a voice entry's path until its transcript lands, as the Uni app's */
const voicePath = (at: Date, seconds = false) => `Journal/${when.path(at, seconds)}`;
/** Journal/2026/11-17/09-41 First words of it */
export function pathFor(text: string, at = new Date()) {
  const words = text.replace(/[#*_`>\[\]\\/:?"<>|]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6).join(" ").slice(0, 48).trim() || "Entry";
  return `Journal/${when.path(at)} ${words}`;
}
/** When an entry was written: from its path (the Uni app's and this one's), else when it changed. */
function whenOf(e: Entry): Date {
  const m = /^(?:Journal|Notes)\/(\d{4})\/(\d{2})-(\d{2})\/(\d{2})-(\d{2})/.exec(e.path);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return when.parse(e.createdAt ?? e.updatedAt) ?? new Date();
}

const CSS = `
.day { margin: calc(var(--gap) * 1.8) 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--line); font: italic var(--fs-body) var(--serif); color: var(--muted); }
.entry { padding: 6px 0 10px; }
.entry .when, .opened .when { font: 600 var(--fs-label) var(--sans); color: var(--muted); letter-spacing: .03em; }
.entry .voice { margin-left: 8px; font-size: var(--fs-label); color: var(--muted); }
.entry .wait { font-style: italic; color: var(--muted); }
.opened { margin: 0 0 18px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.opened .when { display: flex; justify-content: space-between; align-items: center; }
.more { display: flex; justify-content: center; margin-top: var(--gap); }
`;

export default function Journal() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  // what is being written is kept on this device as it is typed: leaving, closing the app or a restart loses none of it
  const [text, setText] = useSaved("draft", "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const [limit, setLimit] = useState(60);
  const load = async (n = limit) => {
    const rows: Entry[] = await vault.queryRecords({ pathPrefix: "Journal/", includeBody: true, limit: n });
    setEntries(rows);
    setFailed(null);
  };
  const start = () => ready().then(() => load()).catch((e: unknown) => setFailed(e));
  useEffect(() => { void start(); }, []);
  // an entry opened from a link (a room's uni:<id>, a wikilink): shown under the box, however old it is
  // (which one is kept too, so it is still open when Journal starts again)
  const [opened, setOpened] = useState<Entry | null>(null);
  const [openId, setOpenId] = useSaved<string | null>("open", null);
  const shown = useRef<HTMLElement>(null);
  useEffect(() => onOpen((o: { note: { id: string } }) => setOpenId(o.note.id)), []);
  useEffect(() => {
    if (!openId) { setOpened(null); return; }
    if (opened?.id === openId) return;
    ready().then(() => vault.getRecord(openId)).then((r: Entry) => setOpened(r), () => setOpenId(null));
  }, [openId]);
  useEffect(() => { if (opened) shown.current?.scrollIntoView({ block: "start" }); }, [opened]);
  // while a transcript is awaited, the entries are read again a few times
  const words = useTranscripts((entries ?? []).map((e) => e.body), () => load());
  // a voice entry: recorded on the app's own sheet, written as the Uni app writes one (the time-only path), its words
  // put in by the hub
  const recorded = async (r: { bytes: ArrayBuffer; type: string; duration: number }) => {
    setBusy(true);
    try {
      const at = new Date();
      await voiceNote(r, (body) => vault.createRecord({ path: voicePath(at), body }).catch(() => vault.createRecord({ path: voicePath(at, true), body })));
      words.again();
      await load();
    } catch (e: any) { toast(`Voice entry not saved: ${e?.message ?? e}`, { error: true }); }
    setBusy(false);
  };
  const sorted = useMemo(() => (entries ?? []).map((e) => ({ e, at: whenOf(e) })).sort((a, b) => b.at.getTime() - a.at.getTime()), [entries]);
  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await vault.createRecord({ path: pathFor(body), body });
      setText("");
      toast("Saved to Journal.");
      await load();
    } catch (e: any) { toast(`Not saved: ${e?.message ?? e}. Your words are still here.`, { error: true }); }
    setBusy(false);
  };
  let last = "";
  return <Page title="Journal" onRefresh={() => load()}>
    <style>{CSS}</style>
    <Write label="Write in your journal" placeholder="What's on your mind?" value={text} onChange={setText} onSend={save} send={busy ? "Saving…" : "Save"} busy={busy}>
      <Record onRecorded={recorded} disabled={busy} label="Record a voice entry" />
    </Write>
    {opened && <section className="opened" aria-label="The entry you opened" ref={shown}>
      <div className="when">{when.day(whenOf(opened))}, {when.time(whenOf(opened))}<Button kind="quiet" small onClick={() => setOpenId(null)}>Close</Button></div>
      <Note body={words.strip(opened.body)} path={opened.path} tags={opened.tags} />
    </section>}
    <Days times={sorted.map((x) => x.at.toISOString())} label="entries, the last four weeks" />
    {failed ? <Problem error={failed} onRetry={() => void start()}>Couldn't read your journal</Problem>
      : entries === null ? <Loading /> : !sorted.length ? <Empty>Nothing yet. Write the first line above.</Empty> : null}
    {sorted.map(({ e, at }) => {
      const day = when.day(at);
      const head = day !== last ? <h2 className="day" key={`d${e.id}`}>{day}</h2> : null;
      last = day;
      // a voice entry: the Uni app's says so in its fields; the hub marks one it was asked to transcribe
      const spoken = (e.fields as any)?.source === "voice" || (e.fields as any)?.transcribe_stub === true;
      const body = words.strip(e.body);
      const waiting = words.say(e.body);
      return [head, <article className="entry" key={e.id} aria-label={`Entry at ${when.time(at)}`}>
        <div className="when">{when.time(at)}{spoken && <span className="voice">voice</span>}</div>
        {body && <Note body={body} path={e.path} tags={e.tags} />}
        {waiting && <p className="wait">{waiting}</p>}
      </article>];
    })}
    {entries && entries.length >= limit && <div className="more"><Button onClick={() => { const n = limit + 60; setLimit(n); void load(n); }}>Older entries</Button></div>}
  </Page>;
}
