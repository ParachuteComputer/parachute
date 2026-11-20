import { describe, expect, it } from "vitest";
import { VaultClient } from "@openparachute/surface-client";
import { isWriteRefusal, NeedsWriteError } from "./writeAsk";

/** What the vault client throws when the app's own fetch refuses a change before it is sent (vault/client.ts
 *  writesNeedWrite): the real client, so a change in how it wraps errors shows here. */
async function refusedThroughClient(vault: string): Promise<unknown> {
  const c = new VaultClient({ vaultUrl: "https://hub.example/vault/x", tokenProvider: () => "t", fetchImpl: async () => { throw new NeedsWriteError(vault, "k"); } });
  return c.createNote({ content: "x", path: "Applets/Journal" } as Parameters<VaultClient["createNote"]>[0]).then(() => null, (e: unknown) => e);
}

describe("a refused change, told apart from other failures", () => {
  it("the refusal itself, or as the vault client wraps it, for this vault only", async () => {
    expect(isWriteRefusal(new NeedsWriteError("garden", "k1"), "garden")).toBe(true);
    expect(isWriteRefusal(await refusedThroughClient("garden"), "garden")).toBe(true);
    expect(isWriteRefusal(await refusedThroughClient("my (garden)*.+"), "my (garden)*.+")).toBe(true);
    expect(isWriteRefusal(await refusedThroughClient("my garden"), "garden")).toBe(false);
    expect(isWriteRefusal(await refusedThroughClient("work"), "garden")).toBe(false);
  });
  it("anything else is not: a path taken, the network, the refusal's words with more after them", () => {
    const said = new NeedsWriteError("garden", "k1").message;
    expect(isWriteRefusal(new Error("A note at Applets/Journal that isn't Journal is in garden already: rename it, then add Journal again."), "garden")).toBe(false);
    expect(isWriteRefusal(new Error("POST /api/notes failed: Failed to fetch"), "garden")).toBe(false);
    expect(isWriteRefusal(new Error(`POST /api/notes failed: ${said} And something else broke.`), "garden")).toBe(false);
    expect(isWriteRefusal("nope", "garden")).toBe(false);
  });
});
