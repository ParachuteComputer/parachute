// Journal: write a line, see your days. The Uni app's journal, as an applet on the vault it lives in: entries are notes
// in Journal/YYYY/MM-DD/HH-MM <first words>, tagged journal (the app tags what it adds there: its `opens`), so the Uni
// app, the vault and your agent read the same notes. Voice entries made elsewhere show with their transcript.
// Written on the kit (docs/WRITE-AN-APPLET.md): a voice entry is recorded on the app's own sheet (Record), made a note
// with the Uni app's time-only path (voiceNote: the hub puts the words in), and read again while it waits
// (useTranscripts). Dates are the kit's (when), as is the page, the box, the list's states and the toasts.
// Offline: a line the vault doesn't take is kept on this device (the outbox, the app's storage), listed as waiting, and
// sent, under the time it was written, when Journal is next shown or on Try now.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Days, Empty, List, Loading, Note, onOpen, onShown, Page, Problem, ready, Record, shown as onScreen, toast, useSaved, useTranscripts, vault, voiceNote, when, Write } from "parachute";

type Entry = { id: string; path: string; updatedAt: string | null; createdAt?: string | null; body?: string; tags?: string[]; fields?: Record<string, unknown> };

/** Journal/2026/11-17/09-41: a voice entry's path until its transcript lands, as the Uni app's */
const voicePath = (at: Date, seconds = false) => `Journal/${when.path(at, seconds)}`;
/** An entry's name: its first line with words, up to six of them, ending at the first sentence's end when that comes
 *  sooner ("Walked to the bakery", "How was today"). A number, an initial, a short title or a dotted abbreviation (1.
 *  J. Dr. U.S. p.m.) doesn't end a sentence, nor does punctuation alone (... !!!). The same in Journal and Home
 *  (src/vault/naming.test.ts checks both copies). */
function entryWords(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => /[\p{L}\p{N}]/u.test(l)) ?? "";
  const all = line.replace(/[#*_`>\[\]\\/:"<>|]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6);
  const end = all.findIndex((w) => {
    const bare = w.replace(/[.!?…。]+$/, "");
    return /[.!?…。]$/.test(w) && /[^\p{P}\s]/u.test(w) && !/\.\p{L}/u.test(bare)
      && !/^(\d+|\p{L}|dr|mr|mrs|ms|st|mt|vs|etc|no|jr|sr|prof|sen|rep|gov|gen|approx|fig|inc|mon|tue|tues|thu|thur|thurs|fri|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/iu.test(bare);
  });
  const words = (end >= 0 ? all.slice(0, end + 1) : all).join(" ").replace(/\?/g, "").replace(/[.!…。]+$/, "").replace(/\s+/g, " ").trim();
  // never a code note's name (the vault keeps .html, .tsx, .jsx for code): "index.html" is filed "index html"
  return Array.from(words).slice(0, 48).join("").trim().replace(/\.(html?|tsx|jsx)$/i, " $1") || "Entry";
}
/** Journal/2026/11-17/09-41 First words of it */
export function pathFor(text: string, at = new Date()) {
  const words = entryWords(text);
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
  // how many entries are shown, for a read started from a callback set up at the start (the outbox's)
  const shownLimit = useRef(limit);
  shownLimit.current = limit;
  const load = async (n = shownLimit.current) => {
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
  // lines written while the vault couldn't be reached, oldest first, each with the moment it was written
  // `tried`: the path its first write went to, when that write failed without an answer (it may have landed there)
  type Waiting = { at: string; body: string; tried?: string };
  const [outbox, setOutbox] = useSaved<Waiting[]>("outbox", []);
  const box = useRef(outbox);
  /** The outbox, now (the ref at once, for a flush already running; the state for the screen and the device's disk). */
  const setBox = (next: Waiting[]) => {
    box.current = next;
    setOutbox(next);
    // written to the device's disk now, not in the kit's next 250 ms (the app may be closed right after): set here at
    // once (useSaved sets it again when React runs its update), then sent
    const saved = (globalThis as any).parachute?.saved;
    saved?.set?.("outbox", next.length ? next : null);
    void saved?.flush?.();
  };
  const sending = useRef(false);
  // what is in the box now, for the outbox's callbacks (set up at the start)
  const draft = useRef(text);
  draft.current = text;
  /** The vault couldn't be reached (no connection, the hub down): the line waits. What the app itself refuses (out of
   *  scope, bad words) is said. (The app answers any failure at the hub as one 502, so a line the hub itself refused
   *  waits too, and Try now says it still can't reach the vault.) */
  const unreachable = (e: any) => /^Vault(Unreachable|Server)Error$/.test(String(e?.name ?? "")) || e?.status === 0 || e?.status === 429
    || e instanceof TypeError || /rate_limited/i.test(String(e?.message ?? ""));
  const taken = (e: any) => e?.status === 409 || /^Vault(Conflict|TargetExists)Error$/.test(String(e?.name ?? "")) || /conflict|already exists|elsewhere/i.test(String(e?.message ?? e));
  /** One line into the vault under the time it was written: the same words in the same minute get the seconds. `tried`
   *  (a waiting line whose write got no answer): if a note with its words is at that very path and was made after the
   *  line was written, that write landed, and it counts as sent. Otherwise the same words twice in a minute are two
   *  entries (written offline or not). A failure says which path it was trying (`e.tried`). */
  const put = async (body: string, at: Date, tried?: string) => {
    const paths = [pathFor(body, at), pathFor(body, at).replace(/^(Journal\/[^ ]+)/, `Journal/${when.path(at, true)}`)];
    for (const path of paths) {
      try { await vault.createRecord({ path, body }); return; } catch (e: any) {
        if (e && typeof e === "object") e.tried = path;
        if (!taken(e)) throw e;
        if (path !== tried) continue;
        // the day's folder (a query names a folder), then the one at that path
        const there = (await vault.queryRecords({ pathPrefix: path.slice(0, path.lastIndexOf("/") + 1), includeBody: true, limit: 200 })) as Entry[];
        // made at or after the moment the line was written: an earlier note is another entry. (A hub clock behind the
        // phone's can make its own landed write look earlier: then it is sent again, a duplicate, never a lost line.)
        const mine = (r: Entry) => r.path === path && (r.body ?? "").trim() === body && (Date.parse(r.createdAt ?? "") || 0) >= at.getTime();
        if (there.some(mine)) return;
      }
    }
    throw new Error("a note with those words at that time is there already, and says something else");
  };
  /** Sends what waits, oldest first. One the vault refuses comes off the list and its words go back in the box, said;
   *  one it can't reach stops the rest. Runs again if more was added meanwhile. */
  const flush = async (asked = false): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    let sent = 0, refused = "", reached = true;
    try {
      for (const item of [...box.current]) {
        const off = () => setBox(box.current.filter((x) => !(x.at === item.at && x.body === item.body)));
        try { await put(item.body, new Date(item.at), item.tried); }
        catch (e: any) {
          if (unreachable(e)) {
            // no answer: this write may have landed; the next try looks there first
            if (typeof e?.tried === "string" && e.tried !== item.tried) setBox(box.current.map((x) => (x.at === item.at && x.body === item.body ? { ...x, tried: e.tried } : x)));
            reached = false; break;
          }
          refused = e?.message ?? String(e);
          // its words back in the box, on disk first, then off the list: never in neither place
          const words = draft.current.trim() ? `${draft.current}\n\n${item.body}` : item.body;
          draft.current = words;
          setText(words);
          (globalThis as any).parachute?.saved?.set?.("draft", words);
          off();
          continue;
        }
        sent++;
        off();
      }
    } finally { sending.current = false; }
    if (sent) { toast(sent === 1 ? "A waiting entry is saved." : `${sent} waiting entries are saved.`); await load().catch(() => {}); }
    if (refused) toast(`Your vault didn't take a waiting entry (${refused}); its words are back in the box.`, { error: true });
    else if (asked && !reached) toast("Still can't reach your vault. They wait here.");
    if (reached && !refused && box.current.length) return flush(asked);
  };
  useEffect(() => {
    void ready().then(() => flush());
    // when Journal is in front again: shown in the app, or the app back from the background
    const back = () => { if ((typeof onScreen === "function" ? onScreen() : true) && document.visibilityState === "visible") void flush(); };
    const off = typeof onShown === "function" ? onShown(back) : () => {};
    document.addEventListener("visibilitychange", back);
    return () => { off(); document.removeEventListener("visibilitychange", back); };
  }, []);
  const sorted = useMemo(() => (entries ?? []).map((e) => ({ e, at: whenOf(e) })).sort((a, b) => b.at.getTime() - a.at.getTime()), [entries]);
  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const at = new Date();
    // behind lines still waiting, it waits with them (the order they were written in is kept), and all are tried now
    if (box.current.length) {
      setBox([...box.current, { at: at.toISOString(), body }]);
      setText("");
      setBusy(false);
      // tried now with them: a toast says whether they went in, or still can't (while a send runs, it joins it)
      if (sending.current) toast("Kept on this device: it goes in after the ones being sent.");
      else void flush(true);
      return;
    }
    try { await put(body, at); } catch (e: any) {
      if (!unreachable(e)) { toast(`Not saved: ${e?.message ?? e}. Your words are still here.`, { error: true }); setBusy(false); return; }
      setBox([...box.current, { at: at.toISOString(), body, ...(typeof e?.tried === "string" ? { tried: e.tried } : {}) }]);
      setText("");
      toast("Kept on this device: it goes to your journal when it can.");
      setBusy(false);
      return;
    }
    setText("");
    toast("Saved to Journal.");
    // (saved: a list that can't be read just now doesn't make it unsaved)
    await load().catch(() => {});
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
    {outbox.length > 0 && <List label="Waiting to be saved" rows={outbox.map((x) => ({ key: x.at, title: entryWords(x.body), meta: `${when.day(x.at)}, ${when.time(x.at)}` }))}
      more={{ label: "Try now", onPress: () => void flush(true) }} />}
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
