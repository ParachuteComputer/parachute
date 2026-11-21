import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import KeyStart from "./KeyStart";

afterEach(cleanup);

const first = () => render(<MemoryRouter><KeyStart first /></MemoryRouter>).container;

describe("the first screen on a device that can hold a key", () => {
  // T-476 stranger walk: three people with a hub of their own met Cloud and "Nostr key" first, and found their way in
  // only as a small "Other ways to sign in" at the foot
  it("offers a hub of the person's own by its address, before any key", () => {
    const c = first();
    const own = [...c.querySelectorAll("a")].find((a) => a.textContent === "Sign in with its address");
    expect(own, "a way in by the hub's address").toBeTruthy();
    expect(own!.getAttribute("href")).toBe("/add");
    const text = c.textContent!;
    expect(text.indexOf("Your own Parachute?")).toBeGreaterThan(text.indexOf("Sign in with Parachute Cloud"));
    expect(text.indexOf("Your own Parachute?")).toBeLessThan(text.indexOf("Nostr key"));
  });
  it("says it once: no second link to the same place at the foot", () => {
    expect([...first().querySelectorAll('a[href="/add"]')]).toHaveLength(1);
  });
  it("in Settings (not the first screen) it is about the key only", () => {
    const c = render(<MemoryRouter><KeyStart /></MemoryRouter>).container;
    expect(c.textContent).not.toContain("Your own Parachute?");
  });
});
