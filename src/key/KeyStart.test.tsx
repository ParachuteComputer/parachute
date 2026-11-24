import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import KeyStart from "./KeyStart";
import { CLOUD_NAME } from "../vault/parachute";

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
    const cloud = text.indexOf(`Start with ${CLOUD_NAME}`), other = text.indexOf("Your notes on another Parachute?"), key = text.indexOf("Nostr key");
    for (const at of [cloud, other, key]) expect(at).toBeGreaterThan(-1);
    expect(other).toBeGreaterThan(cloud);
    expect(other).toBeLessThan(key);
  });
  // T-476 journey: Cloud's emailed sign-in makes the account for a new email, so this one button is the sign-up too, and
  // says so (a new person met "Sign in" and had no account to sign in to)
  it("tells a new person the Cloud button makes their account", () => {
    expect(first().textContent).toContain("it makes your account if you're new");
  });
  it("says it once: no second link to the same place at the foot", () => {
    expect([...first().querySelectorAll('a[href="/add"]')]).toHaveLength(1);
  });
  it("in Settings (not the first screen) it is about the key only", () => {
    const c = render(<MemoryRouter><KeyStart /></MemoryRouter>).container;
    expect(c.textContent).not.toContain("another Parachute");
  });
});
