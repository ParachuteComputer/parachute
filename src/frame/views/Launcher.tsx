import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Note } from "@openparachute/surface-client";
import type { FrameApplet, FrameVault } from "../../bridge/protocol";
import { pinApplet, startApplet, useApplets, useHome, useVaultQuery, useVaults } from "../data";
import { titleOf } from "../../vault/notes";
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

/**
 * The launcher: every applet in every vault this device holds, and the vaults themselves, laid out like the contents of
 * a book (design/WHY.md). Beside each applet, a line of what changed lately in what it opens. A long-press (or a
 * right-click) on an applet offers pinning it to the bar and opening it on start.
 */
export default function Launcher() {
  const vaults = useVaults();
  const [asked, setAsked] = useState<{ v: FrameVault; a: FrameApplet } | null>(null);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return (
    <main className={vaults.length > 1 ? "screen launcher launcher-wide" : "screen launcher"}>
      <header className="launcher-head"><h1>Parachute</h1><span className="launcher-when">{today}</span></header>
      <div className={vaults.length > 1 ? "launcher-spread launcher-pages" : "launcher-spread"}>
        {vaults.map((v) => <Chapter key={v.key} v={v} onHold={(a) => setAsked({ v, a })} />)}
      </div>
      <p className="launcher-foot"><Link to="/add">Add a vault</Link><Link to="/settings">Settings</Link></p>
      {asked && <AppletSheet v={asked.v} a={asked.a} onClose={() => setAsked(null)} />}
    </main>
  );
}

function Chapter({ v, onHold }: { v: FrameVault; onHold: (a: FrameApplet) => void }) {
  const applets = useApplets(v.key);
  const home = useHome();
  const shown = applets?.ok ? applets.entries : [];
  return (
    <section className="chapter" aria-label={v.vault}>
      <h2><span>{v.vault}</span><Link to={`/v/${encodeURIComponent(v.key)}`}>Open the vault</Link></h2>
      <ol className="entries" aria-label={`Applets in ${v.vault}`}>
        {shown.map((a) => {
          const isHome = home.start?.vault === v.key && home.start.noteId === a.noteId;
          const pinned = home.bar.some((p) => p.vault === v.key && p.noteId === a.noteId);
          return <Entry key={a.noteId} v={v} a={a} home={isHome} pinned={pinned} onHold={() => onHold(a)} />;
        })}
        {applets && !applets.ok && <li className="entry-quiet">Its applets couldn't be read.</li>}
        {applets?.ok && !shown.length && <li className="entry-quiet">No applets here yet.</li>}
      </ol>
    </section>
  );
}

function Entry({ v, a, home, pinned, onHold }: { v: FrameVault; a: FrameApplet; home: boolean; pinned: boolean; onHold: () => void }) {
  const hold = useHold(onHold);
  return (
    <li>
      <Link className="entry" to={appletPath(v.key, a.noteId)} {...hold}>
        <span className="entry-glyph" aria-hidden="true">{a.manifest.glyph}{"\uFE0E"}</span>
        <span className="entry-name">{a.manifest.name}{home && <span className="entry-home">home</span>}{pinned && !home && <span className="entry-pinned"><span aria-hidden="true">●</span> pinned</span>}</span>
        <span className="entry-dots" aria-hidden="true" />
        <Life v={v} a={a} home={home} />
      </Link>
    </li>
  );
}

/** What changed lately in what the applet opens: the newest such note and when. Else its own one-line note. */
function Life({ v, a, home }: { v: FrameVault; a: FrameApplet; home: boolean }) {
  const o = a.opens[0];
  const load = useVaultQuery<Note[]>(o ? v : null, (r) => r.queryNotes({ tag: o!.type, pathPrefix: o!.path, orderBy: "updated_at", sort: "desc", limit: 1 }), [o?.type, o?.path]);
  let text = home ? "opens on start" : a.manifest.note ?? "";
  if (o && load.state === "ok") {
    const n = load.data[0];
    text = n ? `${titleOf(n)}, ${ago((n as { updatedAt?: string }).updatedAt)}` : "nothing in it yet";
  }
  return <span className="entry-life">{text}</span>;
}

/** A long-press (touch) or a right-click calls `f`; the click that ends a long-press opens nothing. */
export function useHold(f: () => void) {
  const timer = useRef(0), fired = useRef(false), at = useRef({ x: 0, y: 0 });
  const cancel = () => { window.clearTimeout(timer.current); timer.current = 0; };
  useEffect(() => cancel, []);
  return {
    draggable: false,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); cancel(); f(); },
    onPointerDown: (e: React.PointerEvent) => {
      cancel(); fired.current = false;
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      at.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => { fired.current = true; timer.current = 0; f(); }, 500);
    },
    onPointerMove: (e: React.PointerEvent) => { if (timer.current && Math.hypot(e.clientX - at.current.x, e.clientY - at.current.y) > 10) cancel(); },
    onPointerUp: cancel, onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } },
  };
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
