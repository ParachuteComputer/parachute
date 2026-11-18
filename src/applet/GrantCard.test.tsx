import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import GrantCard, { APPROVED_CODE_SHORT, CODE_CHANGED_LINE, CODE_CHANGED_SEALED_LINE, EXPIRED_LINE, FRESH_DETAILS_LINE, FRESH_LINE, MODE_CHANGED_LINE, NOTHING_NEW } from "./GrantCard";
import { askedOf } from "./face";
import type { Grant } from "./grant";

// unmounted after each, so the card's settle timer (ui/press.ts) never fires once the test's window is gone
afterEach(cleanup);

const RECIPES: Grant = { applet: { id: "recipes", name: "Recipes" }, vault: "kitchen", allow: [{ path: "Recipes/", verbs: ["read", "create"] }], opens: [], app: [] };
const ROOMS: Grant = { ...RECIPES, allow: [], services: [{ id: "r", kind: "nostr-relay", url: "wss://buzz.example.org/", publish: [9], media: false, private: [] }] };
type Was = { scope: string; code: string; asked: { face: string[]; others: string[] } | null } | null;
const card = (o: { runs?: "sealed" | "approved-code"; grant?: Grant; status?: "none" | "ok" | "updated"; was?: Was; scope?: string } = {}) =>
  render(<GrantCard name="Recipes" glyph="❀" vault="kitchen" runs={o.runs ?? "sealed"} grant={o.grant ?? RECIPES} ownFolder="Applets/" scope={o.scope ?? "s1"} code="c2" status={o.status ?? "none"} was={o.was ?? null}
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
  const kept = (g: Grant, o: Partial<NonNullable<Was>> = {}) => ({ scope: "s1", code: "c1", asked: askedOf(g, "Applets/"), ...o });
  it("changed code, the same asks: no new permissions, Allow this version", () => {
    const c = card({ status: "updated", was: kept(RECIPES) });
    expect(face(c)).toContain(`${CODE_CHANGED_SEALED_LINE} ${NOTHING_NEW}`);
    expect(c.querySelector(".grant-new")).toBeNull();
    expect(c.querySelector("button.primary")!.textContent).toBe("Allow this version");
  });
  it("approved code only: changed code says it could reach the internet", () => {
    expect(face(card({ runs: "approved-code", status: "updated", was: kept(RECIPES) }))).toContain(`${CODE_CHANGED_LINE} ${NOTHING_NEW}`);
  });
  it("changed code with a line that reads otherwise: never 'no new permissions' beside a New mark", () => {
    const c = card({ status: "updated", was: kept(RECIPES, { asked: { face: ["something else"], others: [] } }) });
    expect(face(c)).not.toContain(NOTHING_NEW);
    expect(c.querySelector(".grant-new")).not.toBeNull();
  });
  it("its year ran out and its code changed: both said, Allow this version", () => {
    const c = card({ status: "none", was: kept(RECIPES) });
    expect(face(c)).toContain(`${EXPIRED_LINE} ${CODE_CHANGED_SEALED_LINE} ${NOTHING_NEW}`);
    expect(c.querySelector("button.primary")!.textContent).toBe("Allow this version");
  });
  it("its year ran out, the same code: Allow it again", () => {
    const c = card({ status: "none", was: kept(RECIPES, { code: "c2" }) });
    expect(face(c)).toContain(`${EXPIRED_LINE} ${NOTHING_NEW}`);
    expect(c.querySelector("h2")!.textContent).toBe("Allow Recipes again?");
  });
  it("the device moved to approved code only: said, and nothing about expiry", () => {
    const t = face(card({ runs: "approved-code", status: "ok", was: kept(RECIPES, { code: "c2" }) }));
    expect(t).toContain(MODE_CHANGED_LINE);
    expect(t).not.toContain(EXPIRED_LINE);
    expect(t).not.toContain(NOTHING_NEW);
  });
  it("other asks: what is new is marked, what went is said", () => {
    const c = card({ grant: ROOMS, scope: "s2", was: kept(RECIPES, { scope: "s1" }) });
    expect(face(c)).toContain(FRESH_LINE);
    expect(c.querySelector(".grant-fresh")!.textContent).toMatch(/^New As you on buzz\.example\.org/);
    expect(face(c)).toContain("No longer: Read and add notes in Recipes/");
  });
  it("other asks seen only in the details: it says where", () => {
    const more: Grant = { ...ROOMS, services: [{ ...(ROOMS.services![0] as { id: string }), private: [{ kind: 30078, d: "drafts:", t: "drafts" }] } as never] };
    const c = card({ grant: more, scope: "s2", was: kept(ROOMS) });
    expect(face(c)).toContain(FRESH_DETAILS_LINE);
    expect(c.querySelector(".grant-details .grant-new")).not.toBeNull();
  });
});
