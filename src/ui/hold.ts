// The long-press (touch) or right-click that opens a sheet, for the launcher's entries and the bar's places: one
// gesture, one implementation. The click that ends a long-press opens nothing (`ended` is told, so the shell can drop
// the tap mark its document listener made for that click).
import { useEffect, useRef } from "react";

export const HOLD_MS = 500;

export function useHold(f: () => void, ended?: () => void) {
  const timer = useRef(0), fired = useRef(false), at = useRef({ x: 0, y: 0 });
  const cancel = () => { window.clearTimeout(timer.current); timer.current = 0; };
  useEffect(() => cancel, []);
  return {
    draggable: false,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); cancel(); if (e.isTrusted) f(); },
    onPointerDown: (e: React.PointerEvent) => {
      cancel(); fired.current = false;
      if (e.pointerType === "mouse" || !e.isPrimary || !e.isTrusted) return;
      at.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => { fired.current = true; timer.current = 0; f(); }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => { if (timer.current && Math.hypot(e.clientX - at.current.x, e.clientY - at.current.y) > 10) cancel(); },
    onPointerUp: cancel, onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); ended?.(); fired.current = false; } },
  };
}

/** Is this the first entry of the tab's history (a start, a link from outside)? Back there goes to the launcher. */
export const atFirstEntry = () => ((history.state as { idx?: number } | null)?.idx ?? 0) === 0;
