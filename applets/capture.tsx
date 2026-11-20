// Capture: the simple app's quick way in (docs/SIMPLE.md). Write a line or say it; it lands in Inbox/ of this vault as
// a note of its own, named by its first words (a voice note: "Voice note" and when), where Notes, the vault and your AI
// read it. Written on the kit: a voice note is recorded on the app's own sheet (Record) and made a note the hub writes
// the words into (voiceNote, useTranscripts). Below the box, the latest captures; a tap opens one in the app, where it
// can be edited (link.open).
import { useEffect, useState } from "react";
import { Empty, link, List, Loading, Page, Problem, ready, Record, toast, useSaved, useTranscripts, vault, voiceNote, when, Write } from "parachute";

type Rec = { id: string; path: string; updatedAt: string | null; createdAt?: string | null; body?: string };
/** Inbox/<the first words>: a capture is named by what it says (the same words again also get the time: make) */
export function pathFor(text: string, at = new Date()) {
  const words = text.replace(/[#*_`>\[\]\\/:?"<>|^]/g, " ").split(/\s+/).filter(Boolean).slice(0, 10).join(" ").slice(0, 80).replace(/^[.\s]+/, "").trim();
  return `Inbox/${words || `Note ${when.stamp(at)}`}`;
}
const voicePath = (at: Date) => `Inbox/Voice note ${when.stamp(at)}`;
/** The vault refused the name: a note is there already (the kit's vault client says 409, "edited elsewhere"). */
const clash = (e: any) => e?.status === 409 || /conflict|elsewhere/i.test(String(e?.message ?? e));
/** A new note at this path; a name already taken (the same words again) gets the time, then a number:
 *  "milk", "milk 2026-11-18 14-05", "milk 2026-11-18 14-05 2", … so only the same words ten times in one minute fail. */
async function make(path: string, body: string, at = new Date(), timed = false): Promise<Rec> {
  // (a name that has the time already, a voice note's, gets only the number)
  const base = timed ? path : `${path} ${when.stamp(at)}`;
  const names = [path, ...(timed ? [] : [base]), ...Array.from({ length: 8 }, (_, i) => `${base} ${i + 2}`)];
  for (const [i, name] of names.entries()) {
    try { return await vault.createRecord({ path: name, body }); } catch (e) { if (!clash(e) || i === names.length - 1) throw e; }
  }
  throw new Error("no free name");
}
// (a capture made before it was named by its words starts with the time: shown without it)
const nameOf = (r: Rec) => r.path.replace(/^Inbox\//, "").replace(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2}(-\d{2})? ?/, "") || "Note";


export default function Capture() {
  const [items, setItems] = useState<Rec[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  // what is being written is kept on this device as it is typed
  const [text, setText] = useSaved("draft", "");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const rows: Rec[] = await vault.queryRecords({ pathPrefix: "Inbox/", includeBody: true, limit: 12 });
    setItems(rows);
    setFailed(null);
  };
  const start = () => ready().then(load).catch((e: unknown) => setFailed(e));
  useEffect(() => { void start(); }, []);
  // a transcript awaited: read again a few times
  const words = useTranscripts((items ?? []).map((r) => r.body), load);

  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await make(pathFor(body), body);
    } catch (e: any) { toast(`Not saved: ${e?.message ?? e}. Your words are still here.`, { error: true }); setBusy(false); return; }
    setText(""); toast("Saved to Inbox.");
    // (saved: a list that can't be read just now doesn't make it unsaved)
    await load().catch(() => {});
    setBusy(false);
  };
  const recorded = async (r: { bytes: ArrayBuffer; type: string; duration: number }) => {
    setBusy(true);
    try {
      const at = new Date();
      await voiceNote(r, (body) => make(voicePath(at), body, at, true));
    } catch (e: any) { toast(`Voice note not saved: ${e?.message ?? e}`, { error: true }); setBusy(false); return; }
    words.again(); toast(`Saved ${Math.round(r.duration)} s of voice. The words follow in a moment.`);
    await load().catch(() => {});
    setBusy(false);
  };

  return <Page title="Capture" onRefresh={load}>
    <Write label="Write it down" placeholder="What's on your mind?" value={text} onChange={setText} onSend={save} send={busy ? "Saving…" : "Save"} busy={busy}>
      <Record onRecorded={recorded} disabled={busy} label="Say it: record a voice note">Say it</Record>
    </Write>
    {failed ? <Problem error={failed} onRetry={() => void start()}>Couldn't read Inbox</Problem>
      : items === null ? <Loading /> : !items.length ? <Empty>Nothing captured yet.</Empty> : (
      // a tap opens the note in the app, where it can be edited
      <List label="Captured" rows={items.map((r) => {
        const first = words.strip(r.body).split("\n")[0].slice(0, 140);
        return { key: r.id, title: nameOf(r), aside: when.short(r.createdAt ?? r.updatedAt), onPress: () => void link.open(r),
          meta: words.say(r.body) ?? (first && !first.startsWith(nameOf(r)) ? first : "") };
      })} />
    )}
  </Page>;
}
