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

describe("app.links through a real session", () => {
  it("a full call fits the frame's read budget; one link past it is refused; a second full call at once waits its turn", async () => {
    const { createSession } = await import("../applet/session");
    const { createRouter } = await import("../applet/router");
    const { createAppModule, LINKS_MAX } = await import("../applet/modules/app");
    const posts: { id?: string; result?: unknown; error?: { code: string } }[] = [];
    const session = createSession({ post: (m) => posts.push(m as never), router: createRouter([createAppModule(["open"], appDeps(() => {}, () => null, { pick: async () => [] }))]), grant: {} as never, now: () => 0 });
    const ask = async (id: string, n: number) => {
      session.handle({ uni: 1, id, ns: "app", method: "links", params: { links: Array.from({ length: n }, (_, i) => `nosuch:01KA3Z9V6B2W8XQJ4M7N5P0R${String(i).padStart(2, "0")}`) } });
      await new Promise((r) => setTimeout(r, 0));
      return posts.find((p) => p.id === id)!;
    };
    expect((await ask("a", LINKS_MAX)).result).toEqual(Array(LINKS_MAX).fill(null));
    expect((await ask("b", LINKS_MAX + 1)).error?.code).toBe("bad_params");
    // the window is spent for now: refused as busy, which the kit waits out (frameKit's line)
    expect((await ask("c", LINKS_MAX)).error?.code).toBe("rate_limited");
  });
});
