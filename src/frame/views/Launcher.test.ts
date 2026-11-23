// Start here (Launcher.tsx): decides whether a home vault holds anything of the person's, paging past Parachute's own
// records and hub #guide notes rather than stopping at the 200 newest notes.
import { describe, expect, it } from "vitest";
import type { Note } from "@openparachute/surface-client";
import type { Query } from "../../bridge/protocol";
import { isFreshVault } from "./Launcher";

const note = (id: string, path: string, tags: string[] = []): Note => ({ id, path, tags, createdAt: "2026-11-20T00:00:00.000Z" });

function readerOf(all: Note[]) {
  const queries: Query[] = [];
  return {
    queries,
    async queryNotes(q: Query): Promise<Note[]> {
      queries.push(q);
      let rows = all;
      if (q.pathPrefix) rows = rows.filter((n) => (n.path ?? "").startsWith(q.pathPrefix!));
      const offset = (q as Query & { offset?: number }).offset ?? 0;
      const limit = q.limit ?? 200;
      return rows.slice(offset, offset + limit);
    },
  };
}

describe("isFreshVault (Start here)", () => {
  it("is true when a vault has only hub #guide notes and Parachute's own records, even more than 200 of them", async () => {
    const system = Array.from({ length: 240 }, (_, i) => note(`s${i}`, `Parachute/Approvals/a${i}`, ["parachute-approval"]));
    system.push(note("g1", "Guides/Welcome", ["guide"]));
    const r = readerOf(system);
    expect(await isFreshVault(r)).toBe(true);
    expect(r.queries.some((q) => (q as Query & { offset?: number }).offset === 200)).toBe(true);
  });

  it("is false when the person's own note sits past the 200 newest notes", async () => {
    const approvals = Array.from({ length: 250 }, (_, i) => note(`a${i}`, `Parachute/Approvals/a${i}`, ["parachute-approval"]));
    const mine = note("u1", "Journal/2026-01-01");
    const r = readerOf([...approvals, mine]);
    expect(await isFreshVault(r)).toBe(false);
  });

  it("is false when a pack receipt exists behind hundreds of approvals", async () => {
    const approvals = Array.from({ length: 300 }, (_, i) => note(`a${i}`, `Parachute/Approvals/a${i}`, ["parachute-approval"]));
    const receipt = note("r1", "Parachute/Receipts/core-types", ["parachute-receipt"]);
    const r = readerOf([...approvals, receipt]);
    expect(await isFreshVault(r)).toBe(false);
  });

  it("is true for an empty vault in a single round of queries", async () => {
    const r = readerOf([]);
    expect(await isFreshVault(r)).toBe(true);
  });

  it("fails closed (false) if a vault exceeds the max page cap of system records", async () => {
    let calls = 0;
    const huge = {
      async queryNotes(q: Query): Promise<Note[]> {
        if (q.pathPrefix === "Parachute/Receipts/") return [];
        calls++;
        return Array.from({ length: q.limit ?? 200 }, (_, i) => note(`s${calls}_${i}`, `Parachute/Approvals/a${i}`, ["parachute-approval"]));
      },
    };
    expect(await isFreshVault(huge)).toBe(false);
    expect(calls).toBe(10);
  });
});
