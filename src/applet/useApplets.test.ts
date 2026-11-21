// The applets as the app lists them (useApplets.ts): a read from the copy kept of the list that set off before the hub's
// own answer landed never lays its older list over that answer (code review, T-476).
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveVault } from "../vault/store";
import { dropAllKept } from "../vault/readCache";
import { appletsNow, refreshApplets } from "./useApplets";

afterEach(() => { vi.unstubAllGlobals(); dropAllKept(); localStorage.clear(); });

/** Two notes that are HTML but no applet: each counts in `skipped`, so a list tells which answer it came from. */
const OLD = JSON.stringify([1, 2].map((i) => ({ id: `n${i}`, path: `Old/${i}`, extension: "html", content: "<p>x</p>", tags: ["applet"], metadata: {} })));

describe("the applets list", () => {
  it("a slower read from the copy that set off first doesn't lay its list over the hub's fresh answer", async () => {
    const rec = saveVault({ issuer: "https://hub.example", vault: "home", tokenEndpoint: "https://hub.example/oauth/token", clientId: "c", accessToken: "t", refreshToken: "r", scope: "", addedAt: "" });
    let lists = 0, release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const u = String(input instanceof Request ? input.url : input);
      if (/[?&]limit=1(&|$)/.test(u) && !/tag=/.test(u)) return new Response("not here", { status: 404 });
      if (/settings/.test(u)) return new Response("[]", { status: 404, headers: { "content-type": "application/json" } });
      if (/tag=applet/.test(u)) {
        // the first list asked (the one from the copy) is slow, and says what was there before
        if (++lists === 1) { await held; return new Response(OLD, { status: 200, headers: { "content-type": "application/json" } }); }
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
    const kept = refreshApplets(rec);
    await new Promise((r) => setTimeout(r, 5));
    expect(await refreshApplets(rec, true)).toBe(true);
    const now = appletsNow(rec.key);
    expect(now?.state === "ok" && now.found.skipped).toBe(0);
    release(); await kept;
    const after = appletsNow(rec.key);
    expect(after?.state === "ok" && after.found.skipped).toBe(0);
  });
});
