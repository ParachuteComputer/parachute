// The view's parsers: what the vault module's query words become, how a host's answer is read (a refusal in core's one
// shape, an older door's JSON-RPC error, a reply), and what payload a connector may hand the view. The whole view runs
// end to end in the MCP Apps reference host (e2e/run.mjs).
import { describe, expect, it } from "vitest";
import { fieldsFilter, mcpVaultDeps, noteOf, Refusal } from "./mcpVault";
import { replyOf } from "./host";
import { parsePayload, withPayload } from "./payload";

describe("the vault module's words as query-records' fields filter", () => {
  it("a value, an operator, a list", () => {
    expect(fieldsFilter([["meta[status]", "open"], ["meta[rating][gte]", "4"], ["meta[due][exists]", "true"], ["meta[kind][in][]", "book"], ["meta[kind][in][]", "zine"]]))
      .toEqual({ status: "open", rating: { gte: 4 }, due: { exists: true }, kind: { in: ["book", "zine"] } });
  });
  it("text stays text where it isn't compared as a number", () => {
    expect(fieldsFilter([["meta[zip][eq]", "02134"], ["meta[name][gt]", "M"]])).toEqual({ zip: { eq: "02134" }, name: { gt: "M" } });
  });
  it("no words: no filter; a word it doesn't know: a 400", () => {
    expect(fieldsFilter([])).toBeNull();
    expect(() => fieldsFilter([["meta[a][drop]", "x"]])).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("a host's answer", () => {
  it("a reply: structuredContent, else the first text block's JSON", () => {
    expect(replyOf({ content: [{ type: "text", text: "[1,2]" }] })).toEqual([1, 2]);
    expect(replyOf({ content: [{ type: "text", text: "{}" }], structuredContent: { a: 1 } })).toEqual({ a: 1 });
  });
  it("a refusal in core's one shape is a Refusal with its type and fields", () => {
    const r = (() => { try { replyOf({ isError: true, structuredContent: { error_type: "conflict", message: "changed", current_updated_at: "t" }, content: [{ type: "text", text: "{}" }] }); } catch (e) { return e; } })() as Refusal;
    expect(r).toBeInstanceOf(Refusal);
    expect([r.error_type, r.message, r.fields]).toEqual(["conflict", "changed", { current_updated_at: "t" }]);
  });
  it("an older door's bare isError text is still a refusal, never data", () => {
    expect(() => replyOf({ isError: true, content: [{ type: "text", text: "Unknown tool: x" }] })).toThrow(Refusal);
  });
});

describe("the vault module's legs", () => {
  const legs = (answer: (name: string, args: Record<string, unknown>) => unknown) => mcpVaultDeps(async (n, a) => answer(n, a));
  it("a conflict reads as the module's conflict; a missing record as not found", async () => {
    const d = legs(() => { throw new Refusal("conflict", "changed"); });
    await expect(d.save!("r1", "x", "t")).rejects.toThrow(/^conflict:/);
    await expect(legs(() => { throw new Refusal("not_found", "gone"); }).getNote("nope")).rejects.toThrow("not found");
  });
  it("records come back in the note words the module reads", () => {
    expect(noteOf({ id: "1", path: "People/Maya", extension: "md", body: "hi", fields: { a: 1 }, tags: ["x"], types: ["person"], updatedAt: "t" }))
      .toMatchObject({ id: "1", path: "People/Maya", content: "hi", metadata: { a: 1 }, tags: ["x"], types: ["person"], updatedAt: "t" });
  });
});

describe("the payload a connector puts in the view", () => {
  const good = { v: 1 as const, vault: "demo", record: { id: "01X", path: "Applets/People", extension: "tsx", tags: ["applet"], fields: { applet: {} } }, code: "export default () => null;", approval: { code: "tsx:ab" } };
  it("round-trips through the page, and code can't close its script", () => {
    const html = withPayload("<!doctype html><html><head></head><body></body></html>", { ...good, code: "</script><script>alert(1)</script>" });
    expect(html).not.toContain("</script><script>alert");
    const json = /<script type="application\/json" id="parachute-applet">(.*?)<\/script>/.exec(html)![1];
    expect(parsePayload(JSON.parse(json))).toMatchObject({ ok: true, payload: { code: "</script><script>alert(1)</script>" } });
  });
  it("anything else is refused with words", () => {
    expect(parsePayload(null).ok).toBe(false);
    expect(parsePayload({ ...good, v: 2 }).ok).toBe(false);
    expect(parsePayload({ ...good, approval: {} }).ok).toBe(false);
  });
});
