// useVaultQuery (frame/data.ts) as a frame of the person's may call it: its dependencies are compared one by one, as
// React compares them, so anything React takes as a dependency (a circular object, a BigInt) works here too.
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useVaultQuery } from "./data";
import type { FrameVault } from "../bridge/protocol";

const V = { key: "kitchen", vault: "kitchen" } as unknown as FrameVault;

describe("useVaultQuery's dependencies", () => {
  it("takes a circular object or a BigInt", async () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const { result } = renderHook(() => useVaultQuery(V, async () => "read", [loop, 10n]));
    await waitFor(() => expect(result.current).toEqual({ state: "ok", data: "read" }));
  });
});
