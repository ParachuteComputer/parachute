// The question before a frame of the person's opens an address outside the app: one at a time, never swapped, and not
// asked again until a new tap could have made it. (The held Open is the question's own: e2e/frame.spec.ts.)
import { describe, expect, it } from "vitest";
import { answerLinkOut, confirmLinkOut, LINK_OUT_REST_MS } from "./frameSource";

describe("asking before a link out", () => {
  it("one question at a time, and a rest after the answer", async () => {
    let t = 1_000_000;
    const now = () => t;
    const first = confirmLinkOut("https://a.example/", now);
    // another ask while it is up is refused, and doesn't replace it
    expect(await confirmLinkOut("https://leak.example/", now)).toBe(false);
    answerLinkOut(true);
    expect(await first).toBe(true);
    // asked again within the rest: refused without showing
    t += LINK_OUT_REST_MS - 1;
    expect(await confirmLinkOut("https://b.example/", now)).toBe(false);
    t += 2;
    const later = confirmLinkOut("https://b.example/", now);
    answerLinkOut(false);
    expect(await later).toBe(false);
  });
});
