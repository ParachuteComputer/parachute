// Open with as the note's route reads it (useOpenWith), through the frame's real bridge to the shell's real host
// (shell/frameBridge.ts), with the shell's answers held where a test needs them: what a decision drawn from the copies
// may and may not be used for.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createFrameHost, type HostDeps } from "../../shell/frameBridge";
import type { FrameApplets, FrameVault } from "../../bridge/protocol";
import type { VaultRecord } from "../../vault/store";

const REC = { key: "kitchen", issuer: "https://hub.example", vault: "kitchen" } as VaultRecord;
const V = { key: "kitchen", vault: "kitchen", host: "hub.example", issuer: "https://hub.example", hub: "https://hub.example", url: null } as unknown as FrameVault;
const SOUP = { id: "n1", path: "Recipes/Soup", tags: ["recipe"] };
// the Recipe box, allowed here, claims recipes
const LIST: FrameApplets = { ok: true, skipped: 0, entries: [{ noteId: "a1", path: "Applets/Recipes", vault: "kitchen", opens: [{ type: "recipe", path: "Recipes/" }], status: "ok",
  manifest: { id: "recipe-box", name: "Recipe box", glyph: "R", screens: [{ id: "home", name: "Recipe box" }] } }] } as unknown as FrameApplets;

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** The shell, as the frame's parent. The person's Always for recipes is Vault, so from the copies a recipe only shows;
 *  what the hub answers now waits until `answer()`. */
function shell() {
  let answer = () => {};
  const now = new Promise<void>((r) => { answer = r; });
  const parentWin = { postMessage: (m: unknown) => host.handle(structuredClone(m)) };
  const host = createFrameHost((m) => {
    const ev = new MessageEvent("message", { data: m });
    Object.defineProperty(ev, "source", { value: parentWin });
    setTimeout(() => window.dispatchEvent(ev), 0);
  }, {
    vaults: () => [REC],
    kept: () => ({ client: { getNote: async () => SOUP }, reads: new Set<string>() }),
    client: () => ({ getNote: async () => { await now; return SOUP; }, queryNotes: async () => [] }),
    roles: async () => ["pinned"],
    applets: async (_rec: VaultRecord, fresh: boolean) => { if (fresh) await now; return LIST; },
    defaults: { get: () => ({ recipe: "vault" }), set: () => {} },
    message: (e: unknown) => (e instanceof Error ? e.message : "failed"),
    now: () => 0,
  } as unknown as HostDeps);
  vi.stubGlobal("parent", parentWin);
  return { answer: () => answer() };
}

describe("open with, decided from the copies", () => {
  it("shows a recipe whose Always is Vault at once; a long-press on it then waits for the applets as the hub has them now", async () => {
    const s = shell();
    const { useOpenWith } = await import("./useOpenWith");
    const seen: { mode: string; state: string }[] = [];
    const { result, rerender } = renderHook(({ mode }: { mode: boolean | "copy-first" }) => {
      const r = useOpenWith(V, "n1", mode);
      seen.push({ mode: String(mode), state: r.state });
      return r;
    }, { initialProps: { mode: "copy-first" } });
    // from the copies, at once: it only shows the note (Vault, by the person's choice)
    await waitFor(() => expect(result.current).toMatchObject({ state: "ok", decision: { kind: "vault", line: null } }));
    // the same note, long-pressed (?with=choose): its sheet would list the applets to pick from, so not one render may
    // offer them from the copies
    rerender({ mode: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.filter((x) => x.mode === "true" && x.state !== "loading")).toEqual([]);
    s.answer();
    await waitFor(() => expect(result.current.state).toBe("ok"));
    expect(result.current.state === "ok" && result.current.cands.map((c) => c.entry.noteId)).toEqual(["a1"]);
  });
});
