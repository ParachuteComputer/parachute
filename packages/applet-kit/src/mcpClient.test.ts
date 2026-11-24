// The view's vault client reads the replies Parachute's MCP door really gives (recorded from a 0.9 vault, T-476 spike).
import { describe, expect, test } from "vitest";
import { mcpVaultClient, replyOf, vaultError } from "./mcpClient.ts";

const text = (o: unknown) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
// the host as the view sees it: one tool, one recorded reply (a JSON-RPC error throws, as the host's call does)
const host = (reply: unknown) => mcpVaultClient(async () => {
  if (reply instanceof Error) throw reply;
  return replyOf(reply as never);
});

describe("replyOf and the client", () => {
  test("a missing record is a plain reply {error, error_type: not_found}: getNote gives null, not the error as a record", async () => {
    const c = host(text({ error: "Record not found", error_type: "not_found", id: "People/Nobody Here" }));
    expect(await c.getNote("People/Nobody Here")).toBeNull();
  });

  test("a conflict (a JSON-RPC error with data.error_type) reads as 409 with the vault's fields", () => {
    const e = vaultError('MCP error -32600: [conflict] conflict: record "01M" has been modified', { error_type: "conflict", current_updated_at: "2026-11-24T20:00:01.276Z" }) as Error & { status: number; data: Record<string, unknown> };
    expect(e.status).toBe(409);
    expect(e.message.startsWith("[conflict]")).toBe(true);
    expect(e.data.current_updated_at).toBe("2026-11-24T20:00:01.276Z");
  });

  test("a refusal that merely says 'not found' is not a missing record: getNote throws", async () => {
    const c = host(vaultError("MCP error -32602: [unknown_tag] tag not found: zzz", { error_type: "unknown_tag" }));
    await expect(c.getNote("x")).rejects.toMatchObject({ status: 400 });
  });

  test("a paged list ({records, next_cursor}) and a plain array both read as rows", async () => {
    expect(await host(text({ records: [{ id: "a" }], next_cursor: "c1" })).queryNotes({ pathPrefix: "People/" })).toEqual([{ id: "a" }]);
    expect(await host(text([{ id: "b" }])).queryNotes({})).toEqual([{ id: "b" }]);
  });

  test("an isError result throws", () => {
    expect(() => replyOf({ content: [{ type: "text", text: "Unknown tool: nope" }], isError: true })).toThrow("Unknown tool: nope");
  });
});
