// Home, the starter one (Parachute Simplified's, docs/SIMPLE.md; any app can name it): a line that lands in
// Inbox/ (as Capture names it), your newest notes across your vaults, and your pins. An ordinary applet: it asks the app
// for the newest notes' titles, the bar and a way to go somewhere on a tap, and adds notes in Inbox/ only. A quiet line
// says how many things your AIs and other apps changed today, and opens Vault's Changes on a tap (`changes`, level 5). Change it, or
// ask your AI to: it is a note in your vault (Applets/Home), and its card asks again when its code changes.
import { useEffect, useState } from "react";
import { app, Button, Empty, List, Loading, Page, Problem, ready, toast, vault, when, Write } from "parachute";

type Recent = { vaultName: string; title: string; updatedAt: string | null; href: string };
type Place = { name: string; glyph: string; href: string; home: boolean };
type Changed = { count: number; names: string[]; more: boolean; href: string | null };

/** Inbox/<the first words>, as Capture names a note; the same words again get the time. */
const pathFor = (text: string) => `Inbox/${text.replace(/[#*_`>\[\]\\/:?"<>|^]/g, " ").split(/\s+/).filter(Boolean).slice(0, 10).join(" ").slice(0, 80).replace(/^[.\s]+/, "").trim() || `Note ${when.stamp(Date.now())}`}`;
const clash = (e: any) => e?.status === 409 || /conflict|elsewhere/i.test(String(e?.message ?? e));
/** "claude changed 3 things today", "claude and Notes changed …", "claude and 2 others changed …". */
const changedLine = (c: Changed) => {
  const n = c.names;
  const who = n.length <= 1 ? (n[0] ?? "Something") : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n[0]} and ${n.length - 1} others`;
  return `${who} changed ${c.count}${c.more ? "+" : ""} ${c.count === 1 ? "thing" : "things"} today.`;
};
const hello = () => { const h = +when.path(Date.now()).slice(-5, -3); return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."; };

const CSS = `
.home .pa-list { margin-top: 14px; }
.home .changed { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin: 12px 0 0; font: var(--fs-small) var(--sans); color: var(--muted); font-variant-numeric: tabular-nums; }
`;

export default function Home() {
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [pins, setPins] = useState<Place[]>([]);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState<Changed | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  // today's changes by others come with the newest notes, so the line never pushes them down; a Parachute before level 5
  // has no app.changes, and a failed count shows no line
  const load = () => Promise.all([app.recent({ limit: 12 }), app.pins(), typeof app.changes === "function" ? app.changes().catch(() => null) : null])
    .then(([r, p, c]: [Recent[], Place[], Changed | null]) => { setRecent(r); setPins(p.filter((x) => !x.home)); setChanged(c); setFailed(null); }, (e: unknown) => setFailed(e));
  useEffect(() => { ready().then(load, (e: unknown) => setFailed(e)); }, []);
  const save = async () => {
    const body = line.trim();
    if (!body || busy) return;
    setBusy(true);
    const path = pathFor(body);
    try {
      await vault.createRecord({ path, body }).catch((e: unknown) => { if (clash(e)) return vault.createRecord({ path: `${path} ${when.stamp(Date.now())}`, body }); throw e; });
      setLine(""); toast("Saved to Inbox."); void load();
    } catch (e: any) { toast(`Not saved: ${e?.message ?? e}. Your words are still here.`, { error: true }); }
    setBusy(false);
  };
  return (
    <Page title={hello()} className="home" onRefresh={load}>
      <style>{CSS}</style>
      <Write line enter="send" label="Write something down" placeholder="Write something down" value={line} onChange={setLine} onSend={save} send={busy ? "Saving…" : "Save"} busy={busy} />
      {changed && changed.count > 0 && changed.href && <p className="changed">
        <span>{changedLine(changed)}</span>
        <Button small kind="quiet" onClick={() => void app.open(changed.href!)}>See what changed</Button>
      </p>}
      <List label="Lately" rows={(recent ?? []).map((n) => ({ key: n.href, title: n.title, meta: n.vaultName, aside: when.short(n.updatedAt), onPress: () => void app.open(n.href) }))} />
      {failed ? <Problem error={failed} onRetry={() => void load()}>Your newest notes couldn't be read</Problem>
        : recent === null ? <Loading /> : !recent.length && <Empty>Nothing written yet. A line above starts it.</Empty>}
      {pins.length > 0 && <List label="Pinned" rows={pins.map((p) => ({ key: p.href, title: p.name, glyph: p.glyph, onPress: () => void app.open(p.href) }))} />}
    </Page>
  );
}
