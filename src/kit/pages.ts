// The pages (docs/LOOK.md, "Structure"): a place is a short run of pages you turn, not a column you scroll. The kit's
// Page lays what it holds into page-sized columns (CSS multi-column, a fixed height, column-fill auto), so content that
// doesn't fit runs on to the next page, sideways; the book shows one page on a phone and two (an open book) once it has
// 900 px of room (a Mac, a tablet on its side).
//
//   turning   flowing: the book is a sideways scroller that snaps to whole pages, so a finger drags the page 1:1 and the
//             device settles it on a page (a flick turns); an arrow turns it on --t-turn and --ease-drawer. Still (the
//             kit's still()): nothing follows the finger; a swipe of 48 px, a sideways wheel past 40 px (once a gesture)
//             or an arrow turns at once. ← → PageUp PageDown turn at once, flowing or not (never animate the keyboard).
//   the head  the first page carries the hour's sky behind the place's name; every later page a running head, the
//             place's name over a thin strip of the same sky. Both hang outside the flow, so they never change a count.
//   where     a place opens on its first page, or its last (`start: "last"`, a room: the newest); on the last page it
//             stays with the newest as more comes in. A thing given focus on another page brings its page.
// Pure DOM: React draws the page once, this moves it, so a turn or a swipe never renders anything.
import { still, STILL_DRAG } from "./still";

export type PagesOptions = { start: "first" | "last"; /** the running heads' words (else the page's title) */ name?: string };
export type Pages = { turn(by: number, how?: "motion" | "cut"): void; to(page: number): void; toStart(): void; toEnd(): void; toElement(el: Element): void; setName(name: string | undefined): void; destroy(): void; readonly at: number; readonly count: number };

/** A spread is two pages from this book width on. */
export const SPREAD_FROM = 900;
/** How far the sky fades into the paper under a place's head. */
const SKY_FADE = 36;
/** A page is never wider than this (a reading measure, with its margins). */
const MOST = 720;

const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])");

/** The cubic-bézier y for an x (the curve's own ease), by bisection: enough for a turn's few frames. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; if (at(x1, x2, t) < x) lo = t; else hi = t; }
    return at(y1, y2, t);
  };
}
const curveOf = (v: string) => { const m = /cubic-bezier\(([^)]+)\)/.exec(v); const n = m ? m[1].split(",").map(Number) : [0.32, 0.72, 0, 1]; return bezier(n[0], n[1], n[2], n[3]); };

export function pages(book: HTMLElement, flow: HTMLElement, line: { at: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement }, opts: PagesOptions): Pages {
  let per = 1, pageW = 0, count = 1, at = 0, touched = false, follow = opts.start === "last", raf = 0, anim = 0, held = false, name = opts.name, pending = false, pinned = false;
  const marks: HTMLElement[] = [];
  const sky = document.createElement("div");
  sky.className = "pa-sky";
  sky.setAttribute("aria-hidden", "true");
  book.prepend(sky);

  const spreads = () => Math.max(1, Math.ceil(count / per));
  const spreadW = () => per * pageW;
  /** Where the book is, as a spread, from its scroll. */
  const here = () => (spreadW() ? Math.max(0, Math.min(spreads() - 1, Math.round(book.scrollLeft / spreadW()))) : 0);

  function say() {
    const first = at * per + 1, last = Math.min(count, first + per - 1);
    line.at.textContent = count > 1 ? `${first === last ? first : `${first}–${last}`} of ${count}` : "";
    line.prev.hidden = count <= 1; line.next.hidden = count <= 1;
    line.prev.disabled = at === 0; line.next.disabled = at >= spreads() - 1;
    book.dataset.page = String(at + 1);
  }

  /** The book's geometry, the page count, the marks (a snap point per spread, a running head per page after the first). */
  function measure() {
    raf = 0;
    const root = getComputedStyle(document.documentElement);
    const pad = parseFloat(root.getPropertyValue("--pad")) || 14;
    const room = (book.parentElement ?? book).clientWidth;
    // hidden (a kept applet behind another screen): nothing to measure; measured again when shown
    if (!room) return;
    per = room >= SPREAD_FROM ? 2 : 1;
    pageW = Math.floor(Math.min(MOST, room / per));
    const side = Math.round(per === 2 ? pad * 2.4 : pad * 1.2);
    book.style.width = `${per * pageW}px`;
    flow.style.width = `${per * pageW}px`;
    flow.style.paddingInline = `${side}px`;
    flow.style.columnWidth = `${pageW - 2 * side}px`;
    flow.style.columnGap = `${2 * side}px`;
    // what can't be split across pages (a code block, a table that scrolls sideways) is at most a page tall, and scrolls
    const cs = getComputedStyle(flow);
    flow.style.setProperty("--pa-col-h", `${Math.max(120, flow.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 8)}px`);
    // the sky over the first page; on a Mac over the open book's first spread, under the bar's own sky
    sky.style.width = `${per * pageW}px`;
    // as tall as the place's head (its name, what sits over and beside it) and a short fade: the rows under it are on paper
    const head = flow.querySelector<HTMLElement>(":scope > .pa-page-head");
    // (watched itself: a face drawn in, a density changed, grow it with no change the flow's observers see)
    if (head && head !== watchedHead) { if (watchedHead) ro?.unobserve(watchedHead); ro?.observe(head); watchedHead = head; }
    if (head) sky.style.height = `${Math.round(head.getBoundingClientRect().bottom - book.getBoundingClientRect().top + SKY_FADE)}px`;
    else sky.style.removeProperty("height");
    const before = count;
    // the content's extent: the column the end of the flow (a mark after everything in it) falls in
    const end = flow.querySelector<HTMLElement>(":scope > .pa-end");
    const x = end ? end.getBoundingClientRect().left - flow.getBoundingClientRect().left : flow.scrollWidth - 1;
    count = Math.max(1, Math.floor(x / pageW) + 1);
    // a mark per page of every spread (a spread's second page is part of the book even when blank, so the book scrolls
    // to its last spread): a snap point at each spread, and a running head on every page after the first that has words
    const said = name ?? flow.querySelector(".pa-title")?.textContent?.trim() ?? "";
    const all = spreads() * per;
    while (marks.length > all) marks.pop()!.remove();
    for (let i = 0; i < all; i++) {
      let m = marks[i];
      if (!m) {
        m = document.createElement("div");
        m.setAttribute("aria-hidden", "true");
        book.appendChild(m);
        marks.push(m);
      }
      const head = i > 0 && i < count;
      m.className = `pa-leaf${head ? " pa-runhead" : ""}${i % per === 0 ? " pa-snap" : ""}`;
      m.style.left = `${i * pageW}px`;
      m.style.width = `${pageW}px`;
      const words = head ? said : "";
      if (m.textContent !== words) m.textContent = words;
    }
    const was = at;
    // asked for while hidden (shown again: toStart): that page, whatever scroll the browser kept for the hidden book
    // (and while pinned there, a measure keeps it: the scroll the browser gives a book shown again is not the person's)
    const to = pending ? (opts.start === "last" ? spreads() - 1 : 0)
      : follow && (!touched || was >= Math.ceil(before / per) - 1) ? spreads() - 1 : Math.min(anim || (pinned && !held) ? at : here(), spreads() - 1);
    pending = false;
    // a glide on its way goes on to where it was going; a finger on the book keeps it; else the book is set where it is
    if (anim) { if (to !== at) glide(to); }
    else if (!held) jump(to);
    say();
  }
  const soon = () => { if (!raf) raf = requestAnimationFrame(measure); };

  /** At once: no motion. */
  function jump(s: number) {
    cancelAnimationFrame(anim); anim = 0; book.style.removeProperty("scroll-snap-type");
    at = Math.max(0, Math.min(spreads() - 1, s));
    book.scrollLeft = at * spreadW();
    say();
  }
  /** To a spread on the theme's turn (or at once, under still). */
  function glide(s: number) {
    const to = Math.max(0, Math.min(spreads() - 1, s));
    const root = getComputedStyle(document.documentElement);
    const ms = parseFloat(root.getPropertyValue("--t-turn")) || 0;
    if (still() || !ms) { jump(to); return; }
    cancelAnimationFrame(anim);
    const from = book.scrollLeft, dest = to * spreadW(), t0 = performance.now(), ease = curveOf(root.getPropertyValue("--ease-drawer"));
    at = to; say();
    // the snap would pull every step back to a page: off while it glides, on again where it lands
    book.style.scrollSnapType = "none";
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      book.scrollLeft = from + (dest - from) * ease(k);
      if (k < 1) anim = requestAnimationFrame(step); else { anim = 0; book.style.removeProperty("scroll-snap-type"); }
    };
    anim = requestAnimationFrame(step);
  }
  const turn = (by: number, how: "motion" | "cut" = "motion") => { touched = true; pinned = false; follow = opts.start === "last" && here() + by >= spreads() - 1; (how === "cut" ? jump : glide)(at + by); };

  // where the book is, as the person scrolls it (a finger, a trackpad): the line follows
  const onScroll = () => {
    if (anim) return;
    const h = here();
    // pinned to where it opens (toStart) and no one has touched it since: a scroll the browser gave it goes back
    if (pinned && !held) { if (h !== at) jump(at); return; }
    if (h !== at) { at = h; touched = true; follow = opts.start === "last" && at >= spreads() - 1; say(); }
  };
  // the person's own hand on the book (a finger, a wheel) ends the pin
  const unpin = () => { pinned = false; };
  book.addEventListener("wheel", unpin, { passive: true });
  book.addEventListener("scroll", onScroll, { passive: true });
  // a finger on the book stops a glide where it is
  const stop = () => { held = true; pinned = false; if (anim) { cancelAnimationFrame(anim); anim = 0; book.style.removeProperty("scroll-snap-type"); at = here(); say(); } };
  const lift = () => { held = false; };
  book.addEventListener("pointerdown", stop);
  addEventListener("pointerup", lift, true);
  addEventListener("pointercancel", lift, true);

  // still: the book doesn't follow the finger (it scrolls only from code); a swipe past 48 px turns once
  let sx: number | null = null, sy = 0, swiped = false;
  const down = (e: PointerEvent) => { if (!still() || e.pointerType === "mouse") return; sx = e.clientX; sy = e.clientY; swiped = false; };
  const move = (e: PointerEvent) => {
    if (sx === null || swiped) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) >= STILL_DRAG && Math.abs(dx) > Math.abs(dy)) { swiped = true; turn(dx < 0 ? 1 : -1, "cut"); }
  };
  const up = () => { sx = null; };
  // the click that ends a swipe opens nothing
  const click = (e: MouseEvent) => { if (swiped) { e.preventDefault(); e.stopPropagation(); swiped = false; } };
  book.addEventListener("pointerdown", down);
  book.addEventListener("pointermove", move);
  book.addEventListener("pointerup", up);
  book.addEventListener("pointercancel", up);
  book.addEventListener("click", click, true);
  // still: a sideways wheel (a trackpad) turns once a gesture, past 40 px; a gesture ends when its events stop coming
  let wheeled = 0, wheelAt = 0, wheelDone = false;
  const wheel = (e: WheelEvent) => {
    if (!still() || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (e.timeStamp - wheelAt > 200) { wheeled = 0; wheelDone = false; }
    wheelAt = e.timeStamp;
    if (wheelDone) return;
    wheeled += e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageW : 1);
    if (Math.abs(wheeled) > 40) { wheelDone = true; turn(wheeled > 0 ? 1 : -1, "cut"); }
  };
  book.addEventListener("wheel", wheel, { passive: false });
  // the keyboard turns at once, outside a box being written in, and not past an open drawer
  const key = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || editable(e.target) || document.querySelector(".pa-drawer-scrim[data-state=open]")) return;
    // the keys are the book's only from the page itself (nothing focused, or something on its pages or its line), and
    // never from a control that has its own use for them (a voice note's seek, a slider, a list to choose in)
    const t = e.target as Element | null;
    if (t && t !== document.body && t !== document.documentElement && !book.contains(t) && !line.at.parentElement?.contains(t)) return;
    if (t instanceof Element && t.closest("audio, video, [role=slider], [role=listbox], [role=tablist], [role=menu], [role=radiogroup], [role=grid]")) return;
    const by = e.key === "ArrowRight" || e.key === "PageDown" ? 1 : e.key === "ArrowLeft" || e.key === "PageUp" ? -1 : 0;
    if (!by || count <= 1) return;
    e.preventDefault();
    turn(by, "cut");
  };
  document.addEventListener("keydown", key);
  // something given focus on another page (Tab, a screen reader): its page, at once
  const focus = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (!flow.contains(t) || !spreadW()) return;
    const x = t.getBoundingClientRect().left - book.getBoundingClientRect().left + book.scrollLeft;
    const s = Math.floor(x / spreadW());
    if (s !== at) { touched = true; pinned = false; jump(s); }
  };
  flow.addEventListener("focusin", focus);
  const prev = () => turn(-1, "motion"), next = () => turn(1, "motion");
  line.prev.addEventListener("click", prev);
  line.next.addEventListener("click", next);

  // the count again when the screen or what is on it changes (a list arrives, a line is added, the faces load)
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(soon) : null;
  let watchedHead: HTMLElement | null = null;
  ro?.observe(book.parentElement ?? book);
  // the book itself: it shrinks when what sits under it grows (a docked line wrapping to two or three lines)
  if (book.parentElement) ro?.observe(book);
  // what grows without the DOM changing: a picture or a video arriving, a fold opened
  for (const ev of ["load", "error", "loadedmetadata", "toggle"]) flow.addEventListener(ev, soon, true);
  const mo = new MutationObserver(soon);
  mo.observe(flow, { childList: true, subtree: true, characterData: true });
  void document.fonts?.ready.then(soon);
  measure();
  if (opts.start === "last") jump(spreads() - 1);

  return {
    turn, to: (p: number) => { touched = true; pinned = false; jump(Math.floor(p / per)); },
    // (and pinned there until the person turns it: a browser may give a book shown again the scroll it had when it was
    // hidden, after it has been measured)
    toStart() { touched = false; follow = opts.start === "last"; jump(opts.start === "last" ? spreads() - 1 : 0); pending = true; pinned = true; soon(); },
    toEnd() { follow = true; jump(spreads() - 1); },
    setName(n) { if (n !== name) { name = n; soon(); } },
    toElement(el: Element) {
      pinned = false;
      measure();
      const x = el.getBoundingClientRect().left - book.getBoundingClientRect().left + book.scrollLeft;
      touched = true; follow = false;
      jump(Math.floor(x / Math.max(1, spreadW())));
    },
    get at() { return at * per; }, get count() { return count; },
    destroy() {
      cancelAnimationFrame(raf); cancelAnimationFrame(anim); ro?.disconnect(); mo.disconnect();
      book.removeEventListener("scroll", onScroll); book.removeEventListener("pointerdown", stop); book.removeEventListener("wheel", unpin);
      book.removeEventListener("pointerdown", down); book.removeEventListener("pointermove", move); book.removeEventListener("pointerup", up); book.removeEventListener("pointercancel", up);
      book.removeEventListener("click", click, true); book.removeEventListener("wheel", wheel); document.removeEventListener("keydown", key);
      removeEventListener("pointerup", lift, true); removeEventListener("pointercancel", lift, true);
      for (const ev of ["load", "error", "loadedmetadata", "toggle"]) flow.removeEventListener(ev, soon, true);
      flow.removeEventListener("focusin", focus); line.prev.removeEventListener("click", prev); line.next.removeEventListener("click", next);
      sky.remove(); marks.forEach((m) => m.remove());
    },
  };
}
