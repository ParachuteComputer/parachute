// The question before a frame of the person's opens an address outside the app: one at a time, never swapped, not
// answered by a double tap's second tap, and not asked again until a new tap could have made it.
import { describe, expect, it } from "vitest";
import { answerLinkOut, confirmLinkOut, LINK_OUT_HOLD_MS, LINK_OUT_REST_MS } from "./frameSource";

describe("asking before a link out", () => {
  it("one question at a time; a held Open; a rest after the answer", async () => {
    let t = 1_000_000;
    const now = () => t;
    const first = confirmLinkOut("https://a.example/", now);
    // another ask while it is up is refused, and doesn't replace it
    expect(await confirmLinkOut("https://leak.example/", now)).toBe(false);
    answerLinkOut(true, now); // straight away: ignored
    t += LINK_OUT_HOLD_MS;
    answerLinkOut(true, now);
    expect(await first).toBe(true);
    // asked again within the rest: refused without showing
    t += LINK_OUT_REST_MS - 1;
    expect(await confirmLinkOut("https://b.example/", now)).toBe(false);
    t += 2;
    const later = confirmLinkOut("https://b.example/", now);
    answerLinkOut(false, now);
    expect(await later).toBe(false);
  });
});
