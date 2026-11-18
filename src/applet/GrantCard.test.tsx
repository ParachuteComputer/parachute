import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import GrantCard, { CODE_CHANGED_LINE, CODE_CHANGED_SEALED_LINE } from "./GrantCard";

// unmounted after each, so the card's settle timer (ui/press.ts) never fires once the test's window is gone
afterEach(cleanup);

const card = (runs: "sealed" | "approved-code") => render(<GrantCard name="Recipes" glyph="❀" vault="kitchen" runs={runs} lines={[]} fingerprint="9b13 b2ae" expires={new Date(2027, 0, 1)} codeChanged onAllow={() => {}} onNotNow={() => {}} />).container.textContent ?? "";

describe("the card for changed code says what holds in each mode", () => {
  it("sealed: no word of the internet beside 'can't reach the internet'", () => {
    const t = card("sealed");
    expect(t).toContain(CODE_CHANGED_SEALED_LINE);
    expect(t).not.toContain("could send what it reads to the internet");
    expect(t).toContain("reach the internet");
  });
  it("approved code only: it says it could", () => {
    const t = card("approved-code");
    expect(t).toContain(CODE_CHANGED_LINE);
    expect(t).not.toContain(CODE_CHANGED_SEALED_LINE);
  });
  it("an applet that reaches servers isn't told it can't reach the internet", () => {
    const t = render(<GrantCard reaches name="Rooms" glyph="◎" vault="uni" runs="sealed" lines={[]} fingerprint="9b13 b2ae" expires={new Date(2027, 0, 1)} codeChanged={false} onAllow={() => {}} onNotNow={() => {}} />).container.textContent ?? "";
    expect(t).not.toContain("or reach the internet");
    expect(t).toContain("reaches the internet only as the lines above say");
  });
});
