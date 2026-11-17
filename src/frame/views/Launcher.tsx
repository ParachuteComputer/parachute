import { useEffect, useState } from "react";
import { useHold } from "../../ui/hold";
import { Link } from "react-router";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplet, FrameComponent, FrameParachute, FramePointer, FrameVault } from "../../bridge/protocol";
import { addEmbed, bringIn, pinApplet, readerFor, startApplet, useApplets, useComponents, useHome, usePointers, useVaultQuery, useVaults } from "../data";
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
  const [part, setPart] = useState<{ v: FrameVault; c: FrameComponent } | null>(null);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  // a vault signed out of while the launcher shows leaves the tally with it
  const all = vaults.flatMap((v) => recent[v.key] ?? []);
  const groups = byParachute(vaults, useHome().parachutes ?? []);
  // one Parachute, all of it here: no heading over its chapters
  const grouped = groups.length > 1 || groups.some((g) => g.p && !g.p.signedIn);
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
      {groups.map(({ p, vaults: here, from }) => {
        const chapters = <div className={vaults.length > 1 ? "launcher-spread launcher-pages" : "launcher-spread"}>
          {here.map((v, i) => <Chapter key={v.key} n={from + i} v={v} many={vaults.length > 1} level={p && grouped ? 3 : 2} recent={recent[v.key]} onHold={(a) => setAsked({ v, a })} onPart={(c) => setPart({ v, c })} />)}
        </div>;
        if (!p || !grouped) return <div key={p?.hub ?? "all"}>{chapters}</div>;
        return (
          <section key={p.hub} className="parachute" aria-label={`Parachute: ${p.name}`}>
            <h2 className="parachute-name">{p.name}{p.name !== p.host && <span className="parachute-host"> · {p.host}</span>}</h2>
            {p.signedIn ? chapters
              : <p className="parachute-out">On your list, not signed in on this device. <Link to={`/add?hub=${encodeURIComponent(p.hub)}`} aria-label={`Sign in to ${p.name}`}>Sign in</Link></p>}
          </section>
        );
      })}
      <p className="launcher-foot"><Link to="/add">Add a Parachute</Link><Link to="/settings">Settings</Link></p>
      {asked && <AppletSheet v={asked.v} a={asked.a} onClose={() => setAsked(null)} />}
      {part && <ComponentSheet v={part.v} c={part.c} onClose={() => setPart(null)} />}
    </main>
  );
}

const originOf = (issuer: string) => { try { return new URL(issuer).origin; } catch { return issuer; } };
/** The vaults by Parachute, in the order the shell gives the Parachutes (the home's first); a vault no Parachute
 *  names (a frame on an older shell) goes in a group of its own at the end. `from`: the first chapter's number. */
export function byParachute(vaults: FrameVault[], parachutes: FrameParachute[]): { p: FrameParachute | null; vaults: FrameVault[]; from: number }[] {
  const out: { p: FrameParachute | null; vaults: FrameVault[]; from: number }[] = [];
  let n = 0;
  for (const p of parachutes) {
    const here = vaults.filter((v) => originOf(v.issuer) === p.hub);
    out.push({ p, vaults: here, from: n });
    n += here.length;
  }
  const rest = vaults.filter((v) => !parachutes.some((p) => originOf(v.issuer) === p.hub));
  if (rest.length || !out.length) out.push({ p: null, vaults: rest, from: n });
  return out;
}

/** Whose a chapter is, under its name: the home, or someone else's (and where). The person's other vaults need no word. */
export function whoseLine(v: FrameVault, many: boolean): string | null {
  if (v.home) return many ? "your home" : null;
  if (v.whose === "trusted") return `someone else's, trusted · at ${v.host}`;
  if (v.whose === "theirs") return `someone else's · at ${v.host}`;
  return null;
}

function Chapter({ n, v, many, level, recent, onHold, onPart }: { n: number; v: FrameVault; many: boolean; level: 2 | 3; recent: Note[] | undefined; onHold: (a: FrameApplet) => void; onPart: (c: FrameComponent) => void }) {
  const H = level === 3 ? "h3" : "h2";
  const parts = useComponents(v.key);
  const applets = useApplets(v.key);
  const home = useHome();
  const pointers = usePointers();
  const shown = applets?.ok ? applets.entries : [];
  const whose = whoseLine(v, many);
  // what the home brings in from other Parachutes sits among its own applets
  const brought = v.home ? pointers.filter((p) => p.kind === "applet") : [];
  return (
    <section className={v.whose && v.whose !== "mine" ? "chapter chapter-theirs" : "chapter"} aria-label={v.vault}>
      <H className="chapter-head"><span className="chapter-n" aria-hidden="true">{ROMAN[n] ?? n + 1}</span><span className="chapter-name">{v.vault}</span><Link to={`/v/${encodeURIComponent(v.key)}`}>Open the vault</Link></H>
      {whose && <p className="chapter-whose">{whose}</p>}
      <ol className="entries" aria-label={`Applets in ${v.vault}`}>
        {shown.map((a) => {
          const isHome = home.start?.vault === v.key && home.start.noteId === a.noteId;
          const pinned = home.bar.some((p) => p.vault === v.key && p.noteId === a.noteId);
          return <Entry key={a.noteId} v={v} a={a} home={isHome} pinned={pinned} onHold={() => onHold(a)} />;
        })}
        {brought.map((p) => <Brought key={p.noteId} p={p} />)}
        {applets && !applets.ok && <li className="entry-quiet">Its applets couldn't be read.</li>}
        {applets?.ok && !shown.length && !brought.length && <li className="entry-quiet">No applets here yet.</li>}
      </ol>
      {parts?.ok && parts.entries.length > 0 && (
        <>
          <h3 className="lately-label">Components in {v.vault}</h3>
          <ul className="parts-list" aria-label={`Components in ${v.vault}`}>
            {parts.entries.map((c) => <li key={c.noteId}><button type="button" className="part-chip" onClick={() => onPart(c)}><span aria-hidden="true">{c.glyph}{"\uFE0E"}</span> {c.name}</button></li>)}
          </ul>
        </>
      )}
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

/** An applet brought in from someone else's Parachute (a pointer in the home vault): it opens where it lives, and says
 *  where that is. Its own screen checks the pin and asks before anything runs. */
function Brought({ p }: { p: FramePointer }) {
  const line = !p.at ? `from ${p.from.vault} · this device isn't signed in there` : p.changed ? `from ${p.from.vault} · changed since you brought it in` : `from ${p.from.vault} · at ${p.from.host}`;
  return (
    <li>
      <Link className="entry entry-brought" to={p.at ? appletPath(p.at, p.record) : "/add"}>
        <span className="entry-glyph" aria-hidden="true">{p.glyph ?? "◇"}{"\uFE0E"}</span>
        <span className="entry-name">{p.name}</span>
        <span className="entry-life">{line}</span>
      </Link>
    </li>
  );
}

/** A component: put it on the home's page, or (from someone else's vault) bring it in. Each a tap here, which the shell
 *  writes; it asks on its own sheet before it runs. */
function ComponentSheet({ v, c, onClose }: { v: FrameVault; c: FrameComponent; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const theirs = !!v.whose && v.whose !== "mine";
  const pointers = usePointers();
  const isBrought = pointers.some((p) => p.kind === "component" && p.at === v.key && p.record === c.noteId);
  const act = (f: () => Promise<string | null>) => () => {
    if (busy) return;
    setBusy(true); setSaid("");
    f().then((done) => { if (done) { setSaid(done); setBusy(false); } else onClose(); }, (e: unknown) => { setSaid(e instanceof Error && e.message !== "not_allowed" ? e.message : "That needs a tap."); setBusy(false); });
  };
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={c.name}>
        <h2><span aria-hidden="true">{c.glyph}{"\uFE0E"}</span> {c.name} <span className="quiet">in {v.vault}</span></h2>
        {c.note && <p className="quiet">{c.note}</p>}
        <ul className="plain sheet-list">
          <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(async () => (await addEmbed(v.key, c.noteId)) === "already" ? "It's on your home already." : "Added to your home. It shows under your home applet, and asks before it runs.")}>Add to home</button></li>
          {theirs && !isBrought && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(async () => { await bringIn(v.key, c.noteId); return null; })}>Bring into my Parachute</button></li>}
        </ul>
        {said && <p role="status">{said}</p>}
        <div className="grant-actions"><button type="button" className="quiet-button" onClick={onClose}>{said ? "Done" : "Cancel"}</button></div>
      </section>
    </div>
  );
}

/** Pin to the bar, and open on start: each a tap here, which the shell writes into the person's settings note. */
function AppletSheet({ v, a, onClose }: { v: FrameVault; a: FrameApplet; onClose: () => void }) {
  const home = useHome();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isHome = home.start?.vault === v.key && home.start.noteId === a.noteId;
  const pinned = home.bar.some((p) => p.vault === v.key && p.noteId === a.noteId);
  const pointers = usePointers();
  const theirs = !!v.whose && v.whose !== "mine";
  const isBrought = pointers.some((p) => p.kind === "applet" && p.at === v.key && p.record === a.noteId);
  const act = (f: () => Promise<unknown>) => () => {
    if (busy) return;
    setBusy(true); setError("");
    f().then(onClose, (e: unknown) => { setError(e instanceof Error && e.message !== "not_allowed" ? e.message : "That needs a tap."); setBusy(false); });
  };
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={a.manifest.name}>
        <h2><span aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span> {a.manifest.name} <span className="quiet">in {v.vault}</span></h2>
        <ul className="plain sheet-list">
          {!isHome && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => pinApplet(v.key, a.noteId, !pinned))}>{pinned ? "Unpin from the bar" : "Pin to the bar"}</button></li>}
          {!theirs && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => startApplet(v.key, isHome ? null : a.noteId))}>{isHome ? "Don't open on start" : "Open on start"}</button></li>}
          {theirs && !isBrought && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => bringIn(v.key, a.noteId))}>Bring into my Parachute</button></li>}
          {theirs && isBrought && <li className="quiet sheet-note">Brought into your Parachute.</li>}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="grant-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}
