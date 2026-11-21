import { describe, expect, it } from "vitest";
import { KEYBOARD_MIN, keyboardUp } from "./keyboard";

const el = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild!; };

describe("the on-screen keyboard", () => {
  it("is up when the window got much shorter and the focus is where one types (a field, or a frame's)", () => {
    for (const f of ['<input type="text">', "<input>", '<input type="search">', "<textarea></textarea>", "<iframe></iframe>"]) {
      expect(keyboardUp(800, 800 - KEYBOARD_MIN, el(f)), f).toBe(true);
    }
  });
  it("is not up for a small shrink (a toolbar), nor with the focus on a button, a box or nothing", () => {
    expect(keyboardUp(800, 800 - KEYBOARD_MIN + 1, el("<textarea></textarea>"))).toBe(false);
    for (const f of ["<button>x</button>", '<input type="checkbox">', '<input type="radio">', "<a href='#'>x</a>"]) {
      expect(keyboardUp(800, 400, el(f)), f).toBe(false);
    }
    expect(keyboardUp(800, 400, null)).toBe(false);
  });
});
