// Opening a place from its tab (docs/LOOK.md, "Motion"): the place rises from the tab that was tapped, fading in from
// 98 % size on --t-state and --ease-out, so you see where it came from. Only a tap on a tab does this (a link, Back or
// the keyboard lands at once), and nothing moves under still.
import { still } from "../kit/still";

let from: { x: number; y: number; at: number } | null = null;
/** A tab was tapped: the next place to show rises from it. */
export function fromTab(el: Element) {
  const r = el.getBoundingClientRect();
  from = { x: r.left + r.width / 2, y: r.top + r.height / 2, at: performance.now() };
}
/** The place now on screen arrives, if a tab's tap led to it a moment ago. */
export function arrivePlace() {
  const f = from;
  from = null;
  if (!f || performance.now() - f.at > 800 || still()) return;
  requestAnimationFrame(() => {
    // the screen now shown: a running applet's, the frame's (a fixed iframe: moved itself, its holder has no box), or one of the shell's
    const el = document.querySelector<HTMLElement>(".kept-applet:not([hidden]) .applet-screen, .kept-frame:not([hidden]) .app-frame, .with-bar > main.screen");
    if (!el || typeof el.animate !== "function") return;
    const root = getComputedStyle(document.documentElement);
    const ms = parseFloat(root.getPropertyValue("--t-state")) || 0;
    if (!ms) return;
    const r = el.getBoundingClientRect();
    el.animate([{ opacity: 0.85, transform: "scale(.98)", transformOrigin: `${f.x - r.left}px ${f.y - r.top}px` }, { opacity: 1, transform: "none", transformOrigin: `${f.x - r.left}px ${f.y - r.top}px` }],
      { duration: ms, easing: root.getPropertyValue("--ease-out").trim() || "ease-out" });
  });
}
