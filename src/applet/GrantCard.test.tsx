import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import GrantCard, { APPROVED_CODE_SHORT, CODE_CHANGED_SEALED_LINE, FRESH_LINE, NOTHING_NEW } from "./GrantCard";
import type { Grant } from "./grant";

// unmounted after each, so the card's settle timer (ui/press.ts) never fires once the test's window is gone
afterEach(cleanup);

const RECIPES: Grant = { applet: { id: "recipes", name: "Recipes" }, vault: "kitchen", allow: [{ path: "Recipes/", verbs: ["read", "create"] }], opens: [], app: [] };
const ROOMS: Grant = { ...RECIPES, allow: [], services: [{ id: "r", kind: "nostr-relay", url: "wss://buzz.example.org/", publish: [9], media: false, private: [] }] };
type Was = { scope: string; asked: { face: string[]; others: string[] } | null } | null;
const card = (o: { runs?: "sealed" | "approved-code"; grant?: Grant; status?: "none" | "ok" | "updated"; was?: Was; scope?: string } = {}) =>
  render(<GrantCard name="Recipes" glyph="❀" vault="kitchen" runs={o.runs ?? "sealed"} grant={o.grant ?? RECIPES} ownFolder="Applets/" scope={o.scope ?? "s1"} status={o.status ?? "none"} was={o.was ?? null}
    fingerprint="9b13 b2ae" expires={new Date(2027, 0, 1)} onAllow={() => {}} onNotNow={() => {}} />).container;
/** The face: what shows before "Show details" is tapped. */
const face = (c: HTMLElement) => [...c.querySelectorAll("section > :not(.grant-details)")].map((e) => e.textContent).join(" ");

describe("the card's face", () => {
  it("sealed and reaching nothing: it says it can't reach the internet", () => {
    const t = face(card());
    expect(t).toContain("Read and add notes in Recipes/");
    expect(t).toContain("can't delete notes or reach the internet");
    expect(t).not.toContain("could send what it reads to the internet");
  });
  it("approved code only: it says it could, on the face", () => {
    expect(face(card({ runs: "approved-code" }))).toContain(APPROVED_CODE_SHORT);
  });
  it("an applet that reaches servers isn't told it can't reach the internet", () => {
    const t = face(card({ grant: ROOMS }));
    expect(t).not.toContain("reach the internet");
    expect(t).toContain("What it reads can go there");
  });
  it("the exact lines and the grant's fingerprint are in the details", () => {
    const d = card({ grant: ROOMS }).querySelector<HTMLElement>(".grant-details")!;
    expect(d.hidden).toBe(true);
    expect(d.textContent).toContain("With your everyday key: sign in to buzz.example.org as you");
    expect(d.textContent).toContain("9b13 b2ae");
  });
});

describe("asking again says why", () => {
  it("changed code, the same asks: nothing new, Allow this version", () => {
    const c = card({ status: "updated", was: { scope: "s1", asked: { face: ["Read and add notes in Recipes/"], others: [] } } });
    expect(face(c)).toContain(`${CODE_CHANGED_SEALED_LINE} ${NOTHING_NEW}`);
    expect(c.querySelector(".grant-new")).toBeNull();
    expect(c.querySelector("button.primary")!.textContent).toBe("Allow this version");
  });
  it("other asks: what is new is marked, what went is said", () => {
    const c = card({ grant: ROOMS, scope: "s2", was: { scope: "s1", asked: { face: ["Read and add notes in Recipes/"], others: [] } } });
    expect(face(c)).toContain(FRESH_LINE);
    expect(c.querySelector(".grant-fresh")!.textContent).toMatch(/^NewAs you on buzz\.example\.org/);
    expect(face(c)).toContain("No longer: Read and add notes in Recipes/");
  });
});
