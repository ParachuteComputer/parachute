// The on-screen keyboard (a phone's): while it is up the bar steps aside, so what is being written keeps the screen.
// Android resizes the app's window for the keyboard (the window gets much shorter at the same width); the shell sees
// that, and a text field with the focus (its own, or inside a frame, when the frame is what has the focus), and marks
// the root `keyboard-up`: the bar is hidden and `--bar-h` is 0 (styles.css), so frames and pages reach the foot.
import { useEffect } from "react";

/** Shorter than this (px) than the tallest the window was at this width: a keyboard, not a toolbar or a resize. */
export const KEYBOARD_MIN = 150;

/** Whether this element having the focus means typing: a text field, an editable area, or a frame (an applet's field). */
export function typing(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "IFRAME" || (el as HTMLElement).isContentEditable) return true;
  if (tag !== "INPUT") return false;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image", "hidden"].includes(type);
}

/** The keyboard is up: the window is at least KEYBOARD_MIN shorter than the tallest it was at the same width, and the
 *  focus is where one types. */
export function keyboardUp(tallest: number, height: number, focused: Element | null): boolean {
  return tallest - height >= KEYBOARD_MIN && typing(focused);
}

/** Watches the window while mounted (the bar is), and marks the root while the keyboard is up. */
export function useKeyboard() {
  useEffect(() => {
    const root = document.documentElement;
    let width = 0, tallest = 0;
    const read = () => {
      const h = Math.min(window.innerHeight, window.visualViewport?.height ?? Infinity);
      if (window.innerWidth !== width) { width = window.innerWidth; tallest = h; }
      tallest = Math.max(tallest, h);
      root.classList.toggle("keyboard-up", keyboardUp(tallest, h, document.activeElement));
    };
    read();
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    // the focus leaving the field (the keyboard closed by a tap elsewhere, or Send) is read too
    const left = () => setTimeout(read, 0);
    document.addEventListener("focusout", left);
    return () => {
      document.removeEventListener("focusout", left);
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
      root.classList.remove("keyboard-up");
    };
  }, []);
}
