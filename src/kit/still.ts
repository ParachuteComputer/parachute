// still(): one switch for motion in code, the same the kit's CSS reads (docs/LOOK.md "Still").
/** Whether nothing should move now: the device asks for less motion, the screen is slow to redraw (e-paper), it shows
 *  Daylight, or the theme is still. It asks the same thing the kit's CSS does (every time is 0, theme.ts MOTION_CSS), so
 *  an applet's own motion, the kit's and the app's agree. Under still, a finger doesn't drag anything: a drag that goes
 *  far enough does what letting go would, at once (docs/LOOK.md, "Still"). */
export function still(): boolean {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return true;
  return getComputedStyle(document.documentElement).getPropertyValue("--t-state").trim() === "0ms";
}
/** How far a finger goes under still before it counts, in px: then the thing goes or closes at once. */
export const STILL_DRAG = 48;
