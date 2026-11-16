// An applet starts only on a person's tap inside the app. One listener at the app's root sees a real tap (trusted, with
// live user activation where the webview reports it) on a link to a note or an applet, and marks that address. The
// screen the address leads to may start an applet for it once. The mark is in memory only, lives 10 seconds, and is
// gone when the person goes anywhere else first. A link from outside, a typed address or a screen restored at launch
// has no mark: the applet waits, stopped, for a tap on its Open button. (One exception, the shell's: the home the person
// chose on this device runs on any arrival while their settings still name it. See shell/start.ts.)

export const MARK_TTL_MS = 10_000;
type Mark = { path: string; at: number };
let mark: Mark | null = null;
let clock: () => number = () => Date.now();

/** For tests: a fake clock. */
export const setClock = (f: () => number) => { clock = f; };

/** Is this event a real tap by the person (not a script's `click()` or a dispatched event)? */
export function isRealTap(e: { isTrusted: boolean }): boolean {
  if (!e.isTrusted) return false;
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return !ua || ua.isActive;
}

/** The app paths a tap can start something at: a note's (`/v/<vault>/n/<id>`) or an applet's (`/v/<vault>/a/<id>`). */
export const isStartable = (path: string) => /^\/v\/[^/]+\/[na]\/[^/]+$/.test(path);

/** Mark `path` as tapped now. */
export function markTap(path: string) { mark = isStartable(path) ? { path, at: clock() } : null; }

/** Move the mark from where it was to where the app sends the person next (the note's route deciding on an applet). */
export function carryMark(from: string, to: string): boolean {
  if (!mark || mark.path !== from) return false;
  if (clock() - mark.at > MARK_TTL_MS) { mark = null; return false; }
  mark = { path: to, at: mark.at };
  return true;
}

/** Use the mark for `path`, once: true only for a live mark made for exactly this address. */
export function takeMark(path: string): boolean {
  const ok = !!mark && mark.path === path && clock() - mark.at <= MARK_TTL_MS;
  mark = null;
  return ok;
}

/** Drop the mark: a move that wasn't a tap. */
export function clearMark() { mark = null; }

/** The person is now at `path`: a mark for anywhere else is dropped. */
export function arrived(path: string) { if (mark && mark.path !== path) mark = null; }

/** The listener at the app's root: a real tap on a link inside the app marks where it goes. */
export function installTapListener(doc: Document = document): () => void {
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    let url: URL;
    try { url = new URL((a as HTMLAnchorElement).href, location.href); } catch { return; }
    if (url.origin !== location.origin) return;
    if (isRealTap(e)) markTap(url.pathname);
    else mark = null;
  };
  // Back and Forward are never a tap on the place they land: a mark made just before is dropped (a quick tap and Back
  // can land without the tapped screen ever drawing, so `arrived` alone would miss it)
  const onPop = () => { mark = null; };
  doc.addEventListener("click", onClick, true);
  doc.defaultView?.addEventListener("popstate", onPop);
  return () => { doc.removeEventListener("click", onClick, true); doc.defaultView?.removeEventListener("popstate", onPop); };
}
