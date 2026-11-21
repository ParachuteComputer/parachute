// Drawer: a panel that rises from the foot of the screen over the page (a choice, a short form, a record's detail), the
// way a phone's own sheets do. Like the other parts, a promise to applets (docs/WRITE-AN-APPLET.md): add with care,
// never change a prop's meaning. Drawn in parts.css ("Drawer") on the theme's curve and time; still under reduce-motion.
//
// It follows the finger: drag it down by its grip (with a finger, also anywhere on it while its content fits, so it
// doesn't scroll) and it goes with you, 1:1; let go far enough (a quarter of its height) or fast enough and it goes,
// else it settles back. Upward it gives only a little. Tap outside or press Escape to put it away. Focus moves into it
// and back to where it was. The numbers are Vaul's (MIT, Emil Kowalski): 0.4 px/ms, a quarter, 10 px before a touch
// counts as a drag, and its damping past the edge.
// In a page drawn at its content's height (one with embeds) there is no screen's foot to rise from: it opens in place,
// where it is in the page.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { arrive, settled } from "./screen";

const FLICK = 0.4, SHARE = 0.25, SLOP_TOUCH = 10, SLOP_MOUSE = 2;
/** Past the edge, a drag goes less and less far (Vaul's dampenValue). */
const damp = (v: number) => Math.max(0, 8 * (Math.log(v + 1) - 2));
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
/** A frame drawn at its content's height never scrolls itself (Page's pull to refresh asks the same). */
const sized = () => typeof document !== "undefined" && (getComputedStyle(document.documentElement).overflowY === "hidden" || getComputedStyle(document.body).overflowY === "hidden");

/** A panel over the page, from the foot of the screen. `open` shows it; `onClose` is asked to put it away (a drag down,
 *  a tap outside, Escape, or your own button), and it goes once `open` is false. `title` heads it (else give `label`,
 *  what a screen reader calls it). */
export function Drawer({ open, onClose, title, label, children }: { open: boolean; onClose: () => void; title?: ReactNode; label?: string; children?: ReactNode }) {
  // shown: drawn (while open, and while it goes)
  const [shown, setShown] = useState(open);
  const [inline] = useState(sized);
  const scrim = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();

  if (open && !shown) setShown(true);
  // arriving: from below, on the theme's curve, from where it rests; going: back down, then gone
  useLayoutEffect(() => {
    const el = scrim.current;
    if (!el) { if (!open && shown) setShown(false); return; }
    if (open) {
      if (el.dataset.state !== "open") { el.style.removeProperty("--pa-scrim"); sheet.current?.style.removeProperty("--pa-drag"); arrive(el); }
      return;
    }
    el.dataset.state = "gone";
    let live = true;
    void settled(el, 800).then(() => { if (live) setShown(false); });
    return () => { live = false; };
  }, [open, shown]);

  // while open: Escape, the keyboard kept inside, the page under it held still, and focus back where it was after
  useEffect(() => {
    if (!open || !shown) return;
    const before = document.activeElement as HTMLElement | null;
    const root = document.documentElement, was = root.style.overflow;
    if (!inline) root.style.overflow = "hidden";
    const el = sheet.current;
    // a field that took focus as it was drawn (autoFocus) keeps it; else the drawer itself
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>("[autofocus]") ?? el).focus({ preventScroll: true });
    if (el) { if (el.scrollHeight > el.clientHeight) el.dataset.scrolls = ""; else delete el.dataset.scrolls; }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close.current(); return; }
      if (inline || e.key !== "Tab" || !el) return;
      const all = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!all.length) { e.preventDefault(); return; }
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); root.style.overflow = was; if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, [open, shown, inline]);

  // the drag
  useEffect(() => {
    const el = sheet.current, sc = scrim.current;
    if (!open || !el || !sc) return;
    let y0: number | null = null, t0 = 0, dy = 0, dragging = false, id = -1, slop = SLOP_TOUCH;
    const set = (v: number) => {
      const h = el.offsetHeight || 1;
      el.style.setProperty("--pa-drag", `${v}px`);
      sc.style.setProperty("--pa-scrim", String(Math.max(0, Math.min(1, 1 - v / h))));
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || sc.dataset.state !== "open") return;
      const t = e.target as Element;
      // by the grip always; a finger also from anywhere on it while its content fits (no scroll to fight), but not from
      // something to press, write in or choose; a mouse only by the grip (a click stays a click, a selection a selection)
      if (!t.closest(".pa-drawer-grip")) {
        if (e.pointerType === "mouse" || "scrolls" in el.dataset) return;
        if (t.closest("button, a, input, textarea, select, label, [contenteditable], [role=button], .pa-no-drag")) return;
      }
      y0 = e.clientY; t0 = e.timeStamp; dy = 0; dragging = false; id = e.pointerId;
      slop = e.pointerType === "touch" ? SLOP_TOUCH : SLOP_MOUSE;
    };
    const move = (e: PointerEvent) => {
      if (y0 === null || e.pointerId !== id) return;
      const d = e.clientY - y0;
      if (!dragging) {
        if (Math.abs(d) < slop) return;
        dragging = true;
        sc.dataset.dragging = "";
        el.setPointerCapture?.(id);
      }
      dy = d >= 0 ? d : -damp(-d);
      set(dy);
    };
    const up = (e: PointerEvent) => {
      if (y0 === null || e.pointerId !== id) return;
      y0 = null;
      if (!dragging) return;
      dragging = false;
      delete sc.dataset.dragging;
      const h = el.offsetHeight || 1;
      const fast = dy / Math.max(1, e.timeStamp - t0) > FLICK;
      // going: the shade fades from where the drag left it (its own value gives way to the leaving state's)
      if (e.type === "pointerup" && dy > 0 && (dy >= h * SHARE || fast)) { sc.style.removeProperty("--pa-scrim"); close.current(); return; }
      set(0);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
  }, [open, shown]);

  if (!shown || typeof document === "undefined") return null;
  const head = title && <header className="pa-drawer-head"><h2 className="pa-drawer-title" id={titleId}>{title}</h2></header>;
  if (inline) {
    if (!open) return null;
    return (
      <section ref={sheet} className="pa-drawer pa-drawer-inline" role="dialog" tabIndex={-1} aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : label}>
        {head}{children}
      </section>
    );
  }
  return createPortal(
    <div ref={scrim} className="pa-drawer-scrim" data-state="before" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) close.current(); }}>
      <section ref={sheet} className="pa-drawer" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : label}>
        <button type="button" className="pa-drawer-grip" aria-label="Close" onClick={() => close.current()} />
        {head}{children}
      </section>
    </div>,
    document.body,
  );
}
