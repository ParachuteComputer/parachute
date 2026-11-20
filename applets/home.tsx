// Home, the starter one (Parachute Simplified's, docs/SIMPLE.md; any app can name it): today's date, a line that lands in
// Inbox/ (as Capture names it), your newest notes across your vaults, and your pins. An ordinary applet: it asks the app
// for the newest notes' titles, the bar and a way to go somewhere on a tap, and adds notes in Inbox/ only. Change it, or
// ask your AI to: it is a note in your vault (Applets/Home), and its card asks again when its code changes.
import { useEffect, useState } from "react";
import { app, ready, vault } from "parachute";

type Recent = { vaultName: string; title: string; updatedAt: string | null; href: string };
type Place = { name: string; glyph: string; href: string; home: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
/** Inbox/<the first words>, as Capture names a note; the same words again get the time. */
const pathFor = (text: string, at = new Date()) => `Inbox/${text.replace(/[#*_`>\[\]\\/:?"<>|^]/g, " ").split(/\s+/).filter(Boolean).slice(0, 10).join(" ").slice(0, 80).replace(/^[.\s]+/, "").trim() || `Note ${stamp(at)}`}`;
const clash = (e: any) => e?.status === 409 || /conflict|elsewhere/i.test(String(e?.message ?? e));
const hello = () => { const h = new Date().getHours(); return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."; };
const when = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso), days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : days === 1 ? "yesterday" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const CSS = `
main { max-width: 720px; margin: 0 auto; padding: 18px var(--pad, 16px) 40px; color: var(--text); }
.kick { margin: 0; font: 600 calc(var(--size, 16px) * .72) var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }
h1 { margin: 2px 0 12px; font: 400 calc(var(--size, 16px) * 2.4)/1.05 var(--serif); }
.line { display: flex; gap: 8px; margin: 0 0 4px; }
input { flex: 1; min-width: 0; box-sizing: border-box; padding: 10px 14px; font: 1.02em var(--serif); color: var(--text); background: var(--surface); border: 1.5px solid var(--text); border-radius: 999px; }
.save { border: 0; background: var(--text); color: var(--bg); border-radius: 999px; padding: 0 18px; font: inherit; cursor: pointer; }
.save:disabled { opacity: .5; }
.said { margin: 4px 0 0; font: italic .95em var(--serif); color: var(--muted); }
h2 { margin: 18px 0 2px; padding-bottom: 4px; border-bottom: 1px solid var(--text); font: 600 .72em var(--sans); letter-spacing: .14em; text-transform: uppercase; }
ul { list-style: none; margin: 0; padding: 0; }
li button { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 10px; width: 100%; padding: 9px 0; border: 0; border-bottom: 1px dotted var(--muted); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.what { font: 1.02em/1.35 var(--serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.where { font-size: .82em; color: var(--muted); }
.pins { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.pin { border: 1px solid var(--line); border-radius: 999px; background: var(--surface); padding: 6px 14px; font: 1em var(--serif); color: var(--text); cursor: pointer; }
.quiet { margin: 8px 0; font: italic .98em var(--serif); color: var(--muted); }
`;

export default function Home() {
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [pins, setPins] = useState<Place[]>([]);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const load = () => Promise.all([app.recent({ limit: 12 }), app.pins()]).then(([r, p]: [Recent[], Place[]]) => { setRecent(r); setPins(p.filter((x) => !x.home)); }, () => setRecent([]));
  useEffect(() => { ready().then(load, () => setRecent([])); }, []);
  // a button and Enter, not a form: an applet's frame is sandboxed without forms, so a form's submit never fires
  const save = async () => {
    const body = line.trim();
    if (!body || busy) return;
    setBusy(true); setSaid("");
    const path = pathFor(body), at = new Date();
    try {
      await vault.createRecord({ path, body }).catch((e: unknown) => { if (clash(e)) return vault.createRecord({ path: `${path} ${stamp(at)}`, body }); throw e; });
      setLine(""); setSaid("Saved to Inbox."); void load();
    } catch (e: any) { setSaid(`Not saved: ${e?.message ?? e}. Your words are still here.`); }
    setBusy(false);
  };
  return (
    <main>
      <style>{CSS}</style>
      <p className="kick">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      <h1>{hello()}</h1>
      <div className="line">
        <input aria-label="Write something down" placeholder="Write something down" value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }} />
        <button className="save" type="button" onClick={() => void save()} disabled={busy || !line.trim()}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {said && <p className="said" role="status">{said}</p>}
      <section aria-label="Lately"><h2>Lately</h2>
        {recent?.length ? <ul>{recent.map((n) => <li key={n.href}><button type="button" onClick={() => void app.open(n.href)}><span className="what">{n.title}</span><span className="where">{when(n.updatedAt)} · {n.vaultName}</span></button></li>)}</ul>
          : <p className="quiet">{recent === null ? "Reading…" : "Nothing written yet. A line above starts it."}</p>}
      </section>
      {pins.length > 0 && <section aria-label="Pinned"><h2>Pinned</h2><div className="pins">{pins.map((p) => <button key={p.href} type="button" className="pin" onClick={() => void app.open(p.href)}>{p.glyph} {p.name}</button>)}</div></section>}
    </main>
  );
}
