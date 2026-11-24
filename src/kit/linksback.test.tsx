// A note link the shell couldn't place yet is asked again when the person is back (T-476): the applet shown again, or
// the app back in front. Before, a link that once led nowhere stayed text for as long as the room was open.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGAIN_MS, Linked, useAnswers } from "./links";

const ID = "01KA3Z9V6B2W8XQJ4M7N5P0R1S";
const g = globalThis as unknown as { parachute?: unknown };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { delete g.parachute; vi.useRealTimers(); });
/** A minute on: the person back asks again only after AGAIN_MS. */
const later = () => vi.setSystemTime(Date.now() + AGAIN_MS + 1);

describe("Linked, when the person is back", () => {
  it("a link that led nowhere is asked again, and drawn once it leads to a note; one already drawn isn't asked again", async () => {
    let there = false;
    const asked: string[][] = [];
    const shown: ((on: boolean) => void)[] = [];
    g.parachute = {
      app: { links: async (links: string[]) => { asked.push(links); return links.map((l) => (l.endsWith(ID) ? (there ? "note" : null) : "note")); } },
      onShown: (cb: (on: boolean) => void) => { shown.push(cb); return () => {}; },
    };
    const other = "01KA3Z9V6B2W8XQJ4M7N5P0R1T";
    const { container } = render(<Linked text={`See uni:${ID} and uni:${other}.`} />);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect([...container.querySelectorAll("a")].map((a) => a.textContent)).toEqual([`uni:${other}`]);
    // back at once: nothing is asked again yet (each link asked costs the frame's reads)
    const first = asked.length;
    await act(async () => { shown.forEach((f) => f(true)); await new Promise((r) => setTimeout(r, 20)); });
    expect(asked.length).toBe(first);
    // the hub has it now; the person comes back to the applet a minute on
    there = true;
    later();
    await act(async () => { shown.forEach((f) => f(true)); await new Promise((r) => setTimeout(r, 20)); });
    expect([...container.querySelectorAll("a")].map((a) => a.textContent)).toEqual([`uni:${ID}`, `uni:${other}`]);
    expect(asked.flat().filter((l) => l.endsWith(other))).toHaveLength(1);
    // nothing left that led nowhere: the person back again asks nothing
    later();
    const before = asked.length;
    await act(async () => { shown.forEach((f) => f(true)); await new Promise((r) => setTimeout(r, 20)); });
    expect(asked.length).toBe(before);
  });
  it("the app back in front (a phone unlocked, the tailnet back) asks again too", async () => {
    let there = false;
    const LATER = "01KA3Z9V6B2W8XQJ4M7N5P0R1V";
    g.parachute = { app: { links: async (links: string[]) => links.map(() => (there ? "note" : null)) } };
    const { container } = render(<Linked text={`In uni:${LATER}`} />);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(container.querySelector("a")).toBeNull();
    there = true;
    later();
    expect(document.visibilityState).toBe("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await new Promise((r) => setTimeout(r, 20)); });
    expect(container.querySelector("a")?.textContent).toBe(`uni:${LATER}`);
  });
  it("after a round, a link still on its way or new to the list is still asked (review finding 2)", async () => {
    const A = "uni:01KA3Z9V6B2W8XQJ4M7N5P0R3A", B = "uni:01KA3Z9V6B2W8XQJ4M7N5P0R3B", C = "uni:01KA3Z9V6B2W8XQJ4M7N5P0R3C";
    let hold: (() => void) | null = null;
    g.parachute = {
      app: { links: async (links: string[]) => {
        // B's first asking waits (a busy shell); A leads nowhere at first
        if (links.includes(B) && !hold) await new Promise<void>((r) => { hold = r; });
        return links.map((l) => (l === A ? null : "note"));
      } },
    };
    let seen = new Map<string, unknown>();
    function Probe({ links }: { links: string[] }) { seen = useAnswers(links); return null; }
    const { rerender } = render(<Probe links={[A]} />);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(seen.get(A)).toBeNull();
    rerender(<Probe links={[A, B]} />);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    // a round while B is still on its way, then a link new to the list
    later();
    // (the app back in front: the kit hears the shell's onShown once a frame, so a test after the first uses this)
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await new Promise((r) => setTimeout(r, 20)); });
    rerender(<Probe links={[A, B, C]} />);
    await act(async () => { hold?.(); await new Promise((r) => setTimeout(r, 40)); });
    expect(seen.get(B)).toBe("note");
    expect(seen.get(C)).toBe("note");
  });
});
