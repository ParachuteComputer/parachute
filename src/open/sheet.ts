// Which note the "Open with…" sheet is open on (one sheet for the whole app), and the listeners that open it: a
// long-press on any link to a note (a right-click on desktop). No call site changes.
import { useSyncExternalStore } from "react";

export type SheetTarget = { vault: string; note: string; asked: boolean };
let target: SheetTarget | null = null;
const listeners = new Set<() => void>();
const set = (t: SheetTarget | null) => { target = t; listeners.forEach((f) => f()); };
export const openSheet = (vault: string, note: string, asked = false) => set({ vault, note, asked });
export const closeSheet = () => set(null);
export const useSheet = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => target, () => null);

/** The vault and note a link inside the app leads to, or null. */
export function noteLink(el: EventTarget | null): { vault: string; note: string } | null {
  const a = (el as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return null;
  let url: URL;
  try { url = new URL(a.href, location.href); } catch { return null; }
  if (url.origin !== location.origin) return null;
  const m = url.pathname.match(/^\/v\/([^/]+)\/n\/([^/]+)$/);
  if (!m) return null;
  try { return { vault: decodeURIComponent(m[1]), note: decodeURIComponent(m[2]) }; } catch { return null; }
}

const HOLD_MS = 500;

export function installLongPress(doc: Document = document): () => void {
  // `fired`: the link a held press opened the sheet for; the click that ends that press (on that link) opens nothing
  let timer = 0, startX = 0, startY = 0, held: { vault: string; note: string } | null = null, fired: Element | null = null;
  const cancel = () => { window.clearTimeout(timer); timer = 0; held = null; };
  const onContext = (e: MouseEvent) => {
    const link = noteLink(e.target);
    if (!link) return;
    e.preventDefault();
    cancel();
    openSheet(link.vault, link.note);
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    fired = null;
    held = noteLink(e.target);
    if (!held) return;
    startX = e.clientX; startY = e.clientY;
    const h = held, a = (e.target as Element).closest("a[href]");
    timer = window.setTimeout(() => { fired = a; openSheet(h.vault, h.note); timer = 0; }, HOLD_MS);
  };
  const onMove = (e: PointerEvent) => { if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel(); };
  // the click that ends a long-press opens nothing
  const onClick = (e: MouseEvent) => {
    if (fired && (e.target as Element | null)?.closest?.("a[href]") === fired) { e.preventDefault(); e.stopPropagation(); }
    fired = null;
  };
  doc.addEventListener("contextmenu", onContext);
  doc.addEventListener("pointerdown", onDown);
  doc.addEventListener("pointermove", onMove);
  doc.addEventListener("pointerup", cancel);
  doc.addEventListener("pointercancel", cancel);
  doc.addEventListener("click", onClick, true);
  return () => {
    doc.removeEventListener("contextmenu", onContext); doc.removeEventListener("pointerdown", onDown); doc.removeEventListener("pointermove", onMove);
    doc.removeEventListener("pointerup", cancel); doc.removeEventListener("pointercancel", cancel); doc.removeEventListener("click", onClick, true);
  };
}
