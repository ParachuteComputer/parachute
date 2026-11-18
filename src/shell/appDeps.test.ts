// What an applet's note links cost: the same for every link, whatever it names, so the read budget can't tell an
// applet which vault names the person holds.
import { describe, expect, it } from "vitest";
import { appDeps } from "./appDeps";

describe("app.links", () => {
  it("charges each link the same, read or not", async () => {
    const d = appDeps(() => {}, () => null, { pick: async () => [] });
    const spent: number[] = [];
    // no vault held here: nothing is read, and the cost is still two a link
    expect(await d.links(["nosuch:01KA3Z9V6B2W8XQJ4M7N5P0R1S", "other:01KA3Z9V6B2W8XQJ4M7N5P0R1T"], undefined, (n) => spent.push(n))).toEqual([null, null]);
    expect(spent).toEqual([4]);
  });
});
