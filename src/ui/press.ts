// A press that counts only once the question it answers has settled on screen: it must begin at least `holdMs` after
// the question was painted, so the second tap of a double tap, or a tap a frame slid under the finger, can't answer it
// (shell/frameSource.ts LINK_OUT_HOLD_MS). A click from the keyboard began when its key went down; a key already held
// when it reached the button counts as begun before anything.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

/** `epoch`: when it changes (what the question shows moved, say), the press settles again from that paint. */
export function useSettledPress(holdMs: number, epoch: unknown = null) {
  const paintedAt = useRef(Infinity), downAt = useRef(-Infinity), keyAt = useRef(Infinity);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    paintedAt.current = Infinity; setArmed(false);
    let id = requestAnimationFrame(() => { id = requestAnimationFrame(() => { paintedAt.current = performance.now(); }); });
    const t = window.setTimeout(() => setArmed(true), holdMs + 50);
    return () => { cancelAnimationFrame(id); window.clearTimeout(t); };
  }, [holdMs, epoch]);
  return {
    armed,
    /** Spread on the button that answers. */
    bind: {
      "aria-disabled": !armed,
      onPointerDown: (e: PointerEvent) => { downAt.current = e.timeStamp; },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (!e.repeat) keyAt.current = e.timeStamp; else if (keyAt.current === Infinity) keyAt.current = -Infinity;
      },
    },
    /** Does this click count? A real one, begun after the question settled. */
    counts(e: MouseEvent): boolean {
      const began = e.detail === 0 ? Math.min(e.timeStamp, keyAt.current) : downAt.current;
      return e.isTrusted && began - paintedAt.current >= holdMs;
    },
  };
}
