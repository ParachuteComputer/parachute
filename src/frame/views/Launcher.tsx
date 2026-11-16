import { useEffect, useState } from "react";
import { useHold } from "../../ui/hold";
import { Link } from "react-router";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplet, FrameVault } from "../../bridge/protocol";
import { pinApplet, readerFor, startApplet, useApplets, useHome, useVaultQuery, useVaults } from "../data";
import { isAppOwn, noteHref, titleOf } from "../../vault/notes";
import { Days, Empty } from "../../kit/parts";
import { appletPath } from "../../open/paths";

/** "2 days ago", from an ISO time. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

const worthShowing = (n: Note) => !isAppOwn(n);
const updated = (n: Note) => (n as { updatedAt?: string }).updatedAt ?? null;

/** The newest notes of every vault, read once per showing of the launcher. */
function useRecent(vaults: FrameVault[]): Record<string, Note[]> {
  const [recent, setRecent] = useState<Record<string, Note[]>>({});
  const keys = vaults.map((v) => v.key).join("|");
  useEffect(() => {
    let live = true;
    for (const v of vaults) {
      readerFor(v).queryNotes({ orderBy: "updated_at", sort: "desc", limit: 120 })
        .then((rows) => { if (live) setRecent((r) => ({ ...r, [v.key]: rows.filter(worthShowing) })); }, () => { /* that vault shows no recent notes */ });
    }
    return () => { live = false; };
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  return recent;
}

const WEEK = 7 * 86_400_000;
const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const counted = (n: number, one: string, many: string) => `${n <= 12 ? NUMBERS[n - 1] ?? "no" : n} ${n === 1 ? one : many}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** One line on the week: how much changed, and where most of it did. */
function weekLine(vaults: FrameVault[], recent: Record<string, Note[]>, now = Date.now()): string {
  const per = vaults.map((v) => ({ v, n: (recent[v.key] ?? []).filter((n) => now - Date.parse(updated(n) ?? "") < WEEK).length }));
  const total = per.reduce((a, b) => a + b.n, 0);
  if (!total) return "Nothing changed this week.";
  const most = [...per].sort((a, b) => b.n - a.n)[0];
  return `${capital(counted(total, "note", "notes"))} changed this week${vaults.length > 1 ? `, most of them in ${most.v.vault}` : ""}.`;
}

/** Hills drawn in ink over a pale wash, under the masthead: ornament only. */
const Hills = () => (
  <svg className="launcher-hills" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
    <path className="h1" d="M0 80 C180 30 320 40 480 64 S820 14 1200 56 V120 H0Z" />
    <path className="h2" d="M0 100 C220 70 400 86 620 92 S960 66 1200 86 V120 H0Z" />
    <path className="h3" d="M0 112 C300 102 640 112 1200 106 V120 H0Z" />
  </svg>
);

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/**
 * The launcher: every applet in every vault this device holds, and the vaults themselves, laid out like an almanac
 * (design/kit/WHY.md): a masthead with a line on the week and its days as a tally, then a chapter per vault with its
 * applets (each with what changed lately in what it opens, and its last seven days) and its newest notes. A long-press
 * (or a right-click) on an applet offers pinning it to the bar and opening it on start.
 */
export default function Launcher() {
  const vaults = useVaults();
  const recent = useRecent(vaults);
  const [asked, setAsked] = useState<{ v: FrameVault; a: FrameApplet } | null>(null);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  // a vault signed out of while the launcher shows leaves the tally with it
  const all = vaults.flatMap((v) => recent[v.key] ?? []);
  return (
    <main className={vaults.length > 1 ? "screen launcher launcher-wide" : "screen launcher"}>
      <header className="launcher-head">
        <Hills />
        <div className="launcher-words">
          <h1>Parachute</h1>
          <p className="launcher-when">{today}</p>
          <p className="launcher-week">{Object.keys(recent).length ? weekLine(vaults, recent) : "\u00a0"}</p>
        </div>
        <Days times={all.map(updated)} label="the last four weeks" />
      </header>
      <div className={vaults.length > 1 ? "launcher-spread launcher-pages" : "launcher-spread"}>
        {vaults.map((v, i) => <Chapter key={v.key} n={i} v={v} recent={recent[v.key]} onHold={(a) => setAsked({ v, a })} />)}
      </div>
      <p className="launcher-foot"><Link to="/add">Add a vault</Link><Link to="/settings">Settings</Link></p>
      {asked && <AppletSheet v={asked.v} a={asked.a} onClose={() => setAsked(null)} />}
    </main>
  );
}

function Chapter({ n, v, recent, onHold }: { n: number; v: FrameVault; recent: Note[] | undefined; onHold: (a: FrameApplet) => void }) {
  const applets = useApplets(v.key);
  const home = useHome();
  const shown = applets?.ok ? applets.entries : [];
  return (
    <section className="chapter" aria-label={v.vault}>
      <h2><span className="chapter-n" aria-hidden="true">{ROMAN[n] ?? n + 1}</span><span className="chapter-name">{v.vault}</span><Link to={`/v/${encodeURIComponent(v.key)}`}>Open the vault</Link></h2>
      <ol className="entries" aria-label={`Applets in ${v.vault}`}>
        {shown.map((a) => {
          const isHome = home.start?.vault === v.key && home.start.noteId === a.noteId;
          const pinned = home.bar.some((p) => p.vault === v.key && p.noteId === a.noteId);
          return <Entry key={a.noteId} v={v} a={a} home={isHome} pinned={pinned} onHold={() => onHold(a)} />;
        })}
        {applets && !applets.ok && <li className="entry-quiet">Its applets couldn't be read.</li>}
        {applets?.ok && !shown.length && <li className="entry-quiet">No applets here yet.</li>}
      </ol>
      {!!recent?.length && (
        <>
          <h3 className="lately-label">Lately in {v.vault}</h3>
          <ul className="lately" aria-label={`Lately in ${v.vault}`}>
            {recent.slice(0, 3).map((note) => <li key={note.id}><Link to={noteHref(v.key, note.id)}><span>{titleOf(note)}</span><i>{ago(updated(note))}</i></Link></li>)}
          </ul>
        </>
      )}
      {recent && !recent.length && <Empty>Nothing written here yet.</Empty>}
    </section>
  );
}

function Entry({ v, a, home, pinned, onHold }: { v: FrameVault; a: FrameApplet; home: boolean; pinned: boolean; onHold: () => void }) {
  const hold = useHold(onHold);
  const o = a.opens[0];
  const load = useVaultQuery<Note[]>(o ? v : null, (r) => r.queryNotes({ tag: o!.type, pathPrefix: o!.path, orderBy: "updated_at", sort: "desc", limit: 30 }), [o?.type, o?.path]);
  let life = home ? "opens on start" : a.manifest.note ?? "";
  if (o && load.state === "ok") {
    const newest = load.data[0];
    life = newest ? `${titleOf(newest)}, ${ago(updated(newest))}` : "nothing in it yet";
  }
  return (
    <li>
      <Link className="entry" to={appletPath(v.key, a.noteId)} {...hold}>
        <span className="entry-glyph" aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span>
        <span className="entry-name">{a.manifest.name}{home && <span className="entry-home">home</span>}{pinned && !home && <span className="entry-pinned"><span aria-hidden="true">●</span> pinned</span>}</span>
        <span className="entry-life">{life}</span>
        {o && load.state === "ok" && <span className="entry-days" aria-hidden="true"><Days times={load.data.map(updated)} days={7} inline /></span>}
      </Link>
    </li>
  );
}

/** Pin to the bar, and open on start: each a tap here, which the shell writes into the person's settings note. */
function AppletSheet({ v, a, onClose }: { v: FrameVault; a: FrameApplet; onClose: () => void }) {
  const home = useHome();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isHome = home.start?.vault === v.key && home.start.noteId === a.noteId;
  const pinned = home.bar.some((p) => p.vault === v.key && p.noteId === a.noteId);
  const act = (f: () => Promise<unknown>) => () => {
    if (busy) return;
    setBusy(true); setError("");
    f().then(onClose, (e: unknown) => { setError(e instanceof Error && e.message !== "not_allowed" ? e.message : "That needs a tap."); setBusy(false); });
  };
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={a.manifest.name}>
        <h2><span aria-hidden="true">{a.manifest.glyph}</span> {a.manifest.name} <span className="quiet">in {v.vault}</span></h2>
        <ul className="plain sheet-list">
          {!isHome && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => pinApplet(v.key, a.noteId, !pinned))}>{pinned ? "Unpin from the bar" : "Pin to the bar"}</button></li>}
          <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => startApplet(v.key, isHome ? null : a.noteId))}>{isHome ? "Don't open on start" : "Open on start"}</button></li>
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="grant-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}
