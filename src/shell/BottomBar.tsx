// The bar (docs/NAVIGATION.md): at the foot of the launcher, a vault, a note, an applet and Settings. The launcher
// always; the home applet, if there is one; then the pinned applets this device can find, in the person's order. The
// shell draws it, under the frame and under applets, so it is there on every screen, under a frame of the person's own
// too. What is on it is the settings note's (homeSettings.ts). A tap on a place is a real tap on a link inside the app:
// it marks that address, so an allowed applet starts. A long-press (or a right-click) on a place offers moving it,
// unpinning it, and open on start.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { move, pin, setStart, useSettings, type Found, type Place } from "./homeSettings";
import { chooseStart, forgetStart } from "./start";
import { clearMark } from "../open/mark";

const HOLD_MS = 500;
type Item = Found & { place: Place; home: boolean };

export default function BottomBar() {
  const { bar } = useSettings();
  const { pathname } = useLocation();
  const [asked, setAsked] = useState<Item | null>(null);
  const items: Item[] = [...(bar.start ? [{ ...bar.start, home: true }] : []), ...bar.pins.map((p) => ({ ...p, home: false }))];
  const here = (href: string) => pathname === href;
  useEffect(() => { setAsked(null); }, [pathname]);
  return (
    <>
      <nav className="home-bar" aria-label="Bar">
        <Link className="home-bar-place" to="/" aria-current={pathname === "/" ? "page" : undefined}><span className="home-bar-glyph" aria-hidden="true">⁂</span>Launcher</Link>
        {items.length > 0 && <span className="home-bar-sep" aria-hidden="true" />}
        {items.map((it) => <Place key={it.href} item={it} current={here(it.href)} onHold={() => setAsked(it)} />)}
      </nav>
      {asked && <PlaceSheet item={asked} first={items.filter((x) => !x.home)[0]?.href === asked.href} last={items.filter((x) => !x.home).at(-1)?.href === asked.href} onClose={() => setAsked(null)} />}
    </>
  );
}

function Place({ item, current, onHold }: { item: Item; current: boolean; onHold: () => void }) {
  const timer = useRef(0);
  const fired = useRef(false);
  const at = useRef({ x: 0, y: 0 });
  const cancel = () => { window.clearTimeout(timer.current); timer.current = 0; };
  useEffect(() => cancel, []);
  return (
    <Link className="home-bar-place" to={item.href} aria-current={current ? "page" : undefined} draggable={false}
      onContextMenu={(e) => { e.preventDefault(); cancel(); if (e.isTrusted) onHold(); }}
      onPointerDown={(e) => {
        cancel(); fired.current = false;
        if (e.pointerType === "mouse" || !e.isPrimary || !e.isTrusted) return;
        at.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => { fired.current = true; timer.current = 0; onHold(); }, HOLD_MS);
      }}
      onPointerMove={(e) => { if (timer.current && Math.hypot(e.clientX - at.current.x, e.clientY - at.current.y) > 10) cancel(); }}
      onPointerUp={cancel} onPointerCancel={cancel}
      // the click that ends a long-press opens nothing, and the mark the tap listener (on the document, first) made for it goes
      onClickCapture={(e) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); clearMark(); fired.current = false; } }}>
      <span className="home-bar-glyph" aria-hidden="true">{item.glyph}{"\uFE0E"}</span>{item.home ? "Home" : item.name}
    </Link>
  );
}

/** What a long-press on a place offers. Every choice is a tap here, in the shell. */
function PlaceSheet({ item, first, last, onClose }: { item: Item; first: boolean; last: boolean; onClose: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = (f: () => Promise<void>) => (e: React.MouseEvent) => {
    if (!e.isTrusted || busy) return;
    setBusy(true); setError("");
    f().then(onClose, (err: unknown) => { setError(err instanceof Error ? err.message : "That couldn't be saved."); setBusy(false); });
  };
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={item.name}>
        <h2><span aria-hidden="true">{item.glyph}</span> {item.name}</h2>
        <ul className="plain sheet-list">
          {!item.home && !first && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => move(item.place, -1))}>Move left</button></li>}
          {!item.home && !last && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => move(item.place, 1))}>Move right</button></li>}
          {!item.home && <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(() => pin(item.place, false))}>Unpin</button></li>}
          {item.home
            ? <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(async () => { await setStart(null); forgetStart(); })}>Don't open on start</button></li>
            : <li><button type="button" className="sheet-choice" disabled={busy} onClick={act(async () => { await setStart(item.place); chooseStart(item.vault, item.noteId); })}>Open on start</button></li>}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="grant-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}
