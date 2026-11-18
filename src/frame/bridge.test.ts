// The frame's side of the bridge against the shell's real host (shell/frameBridge.ts): a frame that asks more at once
// than the shell holds gets every answer, because the frame keeps its calls in line and asks again after a busy refusal.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameHost, FRAME_LIMITS, type HostDeps } from "../shell/frameBridge";
import type { VaultRecord } from "../vault/store";

const REC = { key: "kitchen", issuer: "https://hub.example", vault: "kitchen" } as VaultRecord;

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** The shell, as the frame's parent: its real host, its answers coming back as messages from the parent. */
function shell(clock: { t: number }) {
  let waiting = 0, most = 0, refused = 0;
  // what crosses to the parent is copied, as postMessage copies it (a function in it throws DataCloneError)
  const parentWin = { postMessage: (m: unknown) => host.handle(structuredClone(m)) };
  const host = createFrameHost((m) => {
    if ((m as { error?: string }).error === "rate_limited") refused++;
    const ev = new MessageEvent("message", { data: m });
    Object.defineProperty(ev, "source", { value: parentWin });
    setTimeout(() => window.dispatchEvent(ev), 0);
  }, {
    vaults: () => [REC],
    // a vault read that takes a moment, so calls stay waiting in the shell
    roles: async () => { waiting++; most = Math.max(most, waiting); await new Promise((r) => setTimeout(r, 5)); waiting--; return ["pinned"]; },
    message: (e: unknown) => (e instanceof Error ? e.message : "failed"),
    now: () => clock.t,
  } as unknown as HostDeps);
  vi.stubGlobal("parent", parentWin);
  return { most: () => most, refused: () => refused };
}

describe("the frame's calls", () => {
  it("are all answered when it asks for more at once than the shell holds waiting", async () => {
    const s = shell({ t: 0 });
    const { call } = await import("./bridge");
    const got = await Promise.allSettled(Array.from({ length: FRAME_LIMITS.pending * 3 }, () => call("vault.roles", { vault: "kitchen" })));
    expect(got.filter((r) => r.status === "rejected")).toEqual([]);
    // it never asked past the shell's limit: the shell refused nothing, and held its most
    expect(s.refused()).toBe(0);
    expect(s.most()).toBe(FRAME_LIMITS.pending);
  });

  it("wait out the shell's ten-second window and then are answered", async () => {
    const clock = { t: 0 };
    const s = shell(clock);
    const { call } = await import("./bridge");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const all = Promise.allSettled(Array.from({ length: FRAME_LIMITS.perWindow + 20 }, () => call("vaults.list", {})));
      // the window moves on while the refused ones wait
      for (let i = 0; i < 400; i++) { await vi.advanceTimersByTimeAsync(50); clock.t += 50; }
      const got = await all;
      expect(got.filter((r) => r.status === "rejected")).toEqual([]);
      // the window did refuse some, and each went again
      expect(s.refused()).toBeGreaterThan(0);
    } finally { vi.useRealTimers(); }
  });

  it("fail at once when a call can't be sent, and the others still go", async () => {
    shell({ t: 0 });
    const { call } = await import("./bridge");
    const calls = Array.from({ length: FRAME_LIMITS.pending * 2 }, (_, i) => i === 40 ? call("vault.roles", { vault: () => 1 } as never) : call("vault.roles", { vault: "kitchen" }));
    const got = await Promise.allSettled(calls);
    expect(got.filter((r) => r.status === "rejected").length).toBe(1);
    expect(got[40].status).toBe("rejected");
  });
});
