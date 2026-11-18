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
    const { createAppModule, LINKS_MAX, LINKS_WAIT } = await import("../applet/modules/app");
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
    // refused in its own words, so the kit line goes on and the links ask again by themselves
    const c = await ask("c", LINKS_MAX);
    expect(c.error).toEqual({ code: "rate_limited", message: LINKS_WAIT });
  });
});

describe("app.follow", () => {
  // the hub is the network: faked, answering when the test says
  const ID = "01KA3Z9V6B2W8XQJ4M7N5P0R1S";
  async function setup() {
    const { saveVault } = await import("../vault/store");
    saveVault({ issuer: "https://hub.example", vault: "kitchen", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c", accessToken: "t", scope: "vault:kitchen:read", addedAt: "" } as never);
    let answer: () => void = () => {};
    const gate = new Promise<void>((r) => { answer = r; });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => { await gate; const id = new URL(String(input instanceof Request ? input.url : input)).searchParams.get("id"); return new Response(JSON.stringify([{ id, path: "Recipes/Toast", content: "" }]), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.getClientRects = () => [{}] as unknown as DOMRectList;
    frame.focus();
    let active = true;
    Object.defineProperty(navigator, "userActivation", { configurable: true, get: () => ({ isActive: active }) });
    const went: string[] = [];
    const d = appDeps((h) => went.push(h), () => frame, { pick: async () => [] });
    return { d, went, answer, wearOff: () => { active = false; }, done: () => { globalThis.fetch = realFetch; frame.remove(); } };
  }
  it("a tap whose note answers at once opens it", async () => {
    const s = await setup();
    try {
      const p = s.d.follow(`kitchen:${ID}`, undefined, false);
      s.answer();
      expect(await p).toBe(true);
      expect(s.went).toEqual([`/v/kitchen/n/${ID}`]);
    } finally { s.done(); }
  });
  it("a slow answer moves no one once the tap has worn off", async () => {
    const s = await setup();
    try {
      const p = s.d.follow(`kitchen:${"01KA3Z9V6B2W8XQJ4M7N5P0R1T"}`, undefined, false);
      s.wearOff();
      s.answer();
      expect(await p).toBe(false);
      expect(s.went).toEqual([]);
    } finally { s.done(); }
  });
});
