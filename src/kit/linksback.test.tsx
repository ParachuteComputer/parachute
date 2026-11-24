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
  it("a link that led nowhere is asked again a minute on, and drawn once it leads to a note", async () => {
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
  it("a return asks again no more than one call's worth of links, the rest at a later one (the frame's reads), with real minutes passing", async () => {
    // every timer faked: the kit's own minute after a miss runs as it does in the app
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    // a long room: messages oldest first, each with a link that leads nowhere (another person's vault, say)
    const many = Array.from({ length: 30 }, (_, i) => `nosuch:01KA3Z9V6B2W8XQJ4M7N5P${String(i).padStart(4, "0")}`);
    const asked: string[] = [];
    g.parachute = { app: { links: async (links: string[]) => { asked.push(...links); return links.map(() => null); } } };
    render(<>{many.map((l) => <p key={l}><Linked text={l} /></p>)}</>);
    await tick(40);
    expect(asked).toHaveLength(30);
    const back = async () => { const n = asked.length; await tick(AGAIN_MS + 1); await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); await tick(40); return asked.slice(n); };
    expect(await back()).toHaveLength(20);
    // the next return asks the ten left out first: the newest messages are not starved by the oldest (round 4)
    const second = await back();
    expect(second).toHaveLength(20);
    expect(second).toEqual(expect.arrayContaining(many.slice(20)));
  });
  it("one part holding many links (a note's) keeps the cap too, and takes turns (round 5)", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    const many = Array.from({ length: 30 }, (_, i) => `nosuch:01KA3Z9V6B2W8XQJ4M7N5Q${String(i).padStart(4, "0")}`);
    const asked: string[] = [];
    g.parachute = { app: { links: async (links: string[]) => { asked.push(...links); return links.map(() => null); } } };
    function Probe() { useAnswers(many); return null; }
    render(<Probe />);
    await tick(40);
    expect(asked).toHaveLength(30);
    const back = async () => { const n = asked.length; await tick(AGAIN_MS + 1); await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); await tick(40); return asked.slice(n); };
    expect(await back()).toHaveLength(20);
    const second = await back();
    expect(second).toHaveLength(20);
    expect(second).toEqual(expect.arrayContaining(many.slice(20)));
  });
});
