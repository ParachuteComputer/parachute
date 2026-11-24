// A note link the shell couldn't place yet is asked again when the person is back (T-476): the applet shown again, or
// the app back in front. Before, a link that once led nowhere stayed text for as long as the room was open.
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Linked } from "./links";

const ID = "01KA3Z9V6B2W8XQJ4M7N5P0R1S";
const g = globalThis as unknown as { parachute?: unknown };
afterEach(() => { delete g.parachute; });

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
    // the hub has it now; the person comes back to the applet
    there = true;
    await act(async () => { shown.forEach((f) => f(true)); await new Promise((r) => setTimeout(r, 20)); });
    expect([...container.querySelectorAll("a")].map((a) => a.textContent)).toEqual([`uni:${ID}`, `uni:${other}`]);
    expect(asked.flat().filter((l) => l.endsWith(other))).toHaveLength(1);
    // nothing left that led nowhere: the person back again asks nothing
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
    expect(document.visibilityState).toBe("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await new Promise((r) => setTimeout(r, 20)); });
    expect(container.querySelector("a")?.textContent).toBe(`uni:${LATER}`);
  });
});
