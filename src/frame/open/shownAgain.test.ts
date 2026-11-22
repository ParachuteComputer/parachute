// Open with on a frame kept running hidden behind a shell screen (shell/FrameArea.tsx), through the frame's real bridge to
// the shell's real host. A file of its own: each frame bridge module listens on the window, and two in one file would
// answer each other's calls.
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createFrameHost, type HostDeps } from "../../shell/frameBridge";
import type { FrameApplets, FrameVault } from "../../bridge/protocol";
import type { VaultRecord } from "../../vault/store";

const REC = { key: "kitchen", issuer: "https://hub.example", vault: "kitchen" } as VaultRecord;
const V = { key: "kitchen", vault: "kitchen", host: "hub.example", issuer: "https://hub.example", hub: "https://hub.example", url: null } as unknown as FrameVault;
const SOUP = { id: "n1", path: "Recipes/Soup", tags: ["recipe"] };
const LIST: FrameApplets = { ok: true, skipped: 0, entries: [] } as unknown as FrameApplets;
// Kept running hidden behind a shell screen (shell/FrameArea.tsx), the frame is told when it shows again: the note is read
// again (an edit made in the shell's editor shows), and a read that fails then (offline a moment) leaves what was drawn.
describe("open with, shown again after a shell screen", () => {
  it("reads the note again, and keeps what it drew when that read fails", async () => {
    let hubNote: { id: string; path: string; tags: string[]; content: string } | Error = { ...SOUP, content: "old words" };
    const parentWin = { postMessage: (m: unknown) => host.handle(structuredClone(m)) };
    const post = (m: unknown) => { const ev = new MessageEvent("message", { data: m }); Object.defineProperty(ev, "source", { value: parentWin }); setTimeout(() => window.dispatchEvent(ev), 0); };
    const host = createFrameHost(post, {
      shown: () => true, vaults: () => [REC],
      kept: () => ({ client: { getNote: async () => ({ ...SOUP, content: "old words" }) }, reads: new Set<string>() }),
      client: () => ({ getNote: async () => { if (hubNote instanceof Error) throw hubNote; return hubNote; }, queryNotes: async () => [] }),
      roles: async () => ["pinned"], applets: async () => LIST,
      defaults: { get: () => ({ recipe: "vault" }), set: () => {} },
      message: (e: unknown) => (e instanceof Error ? e.message : "failed"), now: () => 0,
    } as unknown as HostDeps);
    vi.stubGlobal("parent", parentWin);
    const { useOpenWith } = await import("./useOpenWith");
    const words = (r: ReturnType<typeof useOpenWith>) => (r.state === "ok" ? (r.note as unknown as { content: string } | null)?.content : r.state);
    const { result } = renderHook(() => useOpenWith(V, "n1", "copy-first"));
    await waitFor(() => expect(words(result.current)).toBe("old words"));
    // edited in the shell's editor meanwhile; the frame is shown again
    hubNote = { ...SOUP, content: "new words" };
    host.event("shown", true);
    await waitFor(() => expect(words(result.current)).toBe("new words"));
    // offline when it shows again: the note stays
    hubNote = new Error("offline");
    host.event("shown", true);
    await new Promise((r) => setTimeout(r, 100));
    expect(words(result.current)).toBe("new words");
  });
});
