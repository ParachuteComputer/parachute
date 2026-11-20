// The `vaults` and `sharing` words (modules/vaults.ts): what an applet that asked for them may do across the person's
// vaults, and what it never may, whatever its card says.
import { describe, expect, it } from "vitest";
import { createVaultsModule, queryPath, recOf, writablePath, type VaultsDeps } from "./modules/vaults";
import { createRouter } from "./router";

const enc = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).buffer;
type Call = { method: string; path: string; body?: unknown };

function setup(words: ("vaults" | "sharing")[] = ["vaults", "sharing"], records: Record<string, unknown> = {}, opts: { tapped?: boolean; door?: "records" | "notes" } = {}) {
  const calls: Call[] = [];
  const revoked: string[] = [];
  const deps: VaultsDeps = {
    list: () => [{ key: "home", name: "home", host: "hub.example", mine: true, home: true, level: "write" }],
    door: async () => opts.door ?? "records",
    async request(_v, method, path, body) {
      calls.push({ method, path, body });
      if (path.startsWith("/types") || path.startsWith("/tags")) return [{ name: "book", kind: "type", count: 2, fields: { status: { type: "string", enum: ["to-read", "read"] } } }];
      const m = /^\/(?:records|notes)\/([^?/]+)/.exec(path);
      if (method === "GET" && m) { const r = records[decodeURIComponent(m[1])]; if (!r) throw new Error("404 not found"); return r; }
      if (method === "GET") return [{ id: "a", path: "Books/A", types: ["book"], tags: [], fields: { status: "read" } }];
      return { id: "a", path: "Books/A", types: ["book"], tags: [], fields: {} };
    },
    watch: () => () => {},
    access: async () => ({ level: "write", mine: true, home: true, hub: "https://hub.example", connector: "https://hub.example/vault/home/mcp", applets: [] }),
    revoke: async (_v, id) => { revoked.push(id); },
    readOnly: async () => {},
    tapped: () => opts.tapped ?? true,
    emit: () => {},
  };
  const m = createVaultsModule(words, deps);
  const router = createRouter([m]);
  const call = (method: string, params: unknown) => router.call("vaults", method, params, {}, { charge() {}, closed: () => false });
  return { call, calls, revoked };
}
const book = { id: "a", path: "Books/A", body: "words", types: ["book"], tags: [], fields: { status: "to-read" }, updatedAt: "2026-11-20T00:00:00.000Z" };

describe("the vaults word", () => {
  it("without it, nothing: every call is not_granted", async () => {
    const { call } = setup([]);
    await expect(call("list", {})).rejects.toMatchObject({ code: "not_granted" });
    await expect(call("query", { vault: "home" })).rejects.toMatchObject({ code: "not_granted" });
  });
  it("sharing's calls need sharing, and vaults' need vaults", async () => {
    await expect(setup(["vaults"]).call("access", { vault: "home" })).rejects.toMatchObject({ code: "not_granted" });
    await expect(setup(["sharing"]).call("list", {})).rejects.toMatchObject({ code: "not_granted" });
  });
  it("a vault the device doesn't hold is refused", async () => {
    await expect(setup().call("query", { vault: "elsewhere" })).rejects.toMatchObject({ code: "out_of_scope" });
  });
  it("a query becomes the hub's: type, field filters, a field's sort, one more than asked (to know there is more)", async () => {
    const { call, calls } = setup();
    const r = await call("query", { vault: "home", type: "book", where: [{ field: "status", op: "eq", value: "read" }], sort: { by: "rating", dir: "desc" }, limit: 100, offset: 200 });
    expect(r.records[0]).toMatchObject({ id: "a", types: ["book"], fields: { status: "read" } });
    const q = new URLSearchParams(calls.at(-1)!.path.split("?")[1]);
    expect(Object.fromEntries(q)).toMatchObject({ tag: "book", "meta[status][eq]": "read", order_by: "rating", sort: "desc", limit: "101", offset: "200", include_fields: "true" });
  });
  it("a query it can't say is refused before the hub sees it", async () => {
    const { call } = setup();
    for (const bad of [{ vault: "home", limit: 5000 }, { vault: "home", where: [{ field: "x;drop", op: "eq", value: 1 }] }, { vault: "home", where: [{ field: "x", op: "like", value: 1 }] }, { vault: "home", path: "../x/" }, { vault: "home", nope: 1 }])
      await expect(call("query", bad)).rejects.toMatchObject({ code: "bad_params" });
  });
  it("on core 0.8 (notes words) a record's types are the vault's typed names among its tags", () => {
    expect(recOf({ id: "a", path: "Books/A", content: "x", tags: ["book", "fav"], metadata: { s: 1 } }, new Set(["book"]))).toMatchObject({ types: ["book"], tags: ["fav"], body: "x", fields: { s: 1 } });
    expect(queryPath({ vault: "v", type: "book", where: [], limit: 10, offset: 0 }, "notes")).toContain("include_metadata=true");
  });
  it("links come both ways", () => {
    const r = recOf({ id: "a", path: "A", links: [{ sourceId: "a", targetId: "b", targetNote: { path: "B" }, relationship: "wikilink" }, { sourceId: "c", targetId: "a", sourceNote: { path: "C" }, relationship: "wikilink" }] });
    expect(r!.links).toEqual([{ dir: "out", id: "b", path: "B", relationship: "wikilink" }, { dir: "in", id: "c", path: "C", relationship: "wikilink" }]);
  });
});

describe("what it never changes", () => {
  it("a field, a type, a tag and the words of a record: one call, judged on the record as it is now", async () => {
    const { call, calls } = setup(["vaults"], { a: book });
    await call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: book.updatedAt, fields: { status: "read" }, tags: { add: ["fav"] }, body: "new" }) });
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "/records/a", body: { fields: { status: "read" }, tags: { add: ["fav"] }, body: "new", if_updated_at: book.updatedAt } });
  });
  it("on core 0.8 a type's change is a tag's, in notes words", async () => {
    const { call, calls } = setup(["vaults"], { a: { ...book, content: "w", metadata: {}, tags: ["book"] } }, { door: "notes" });
    await call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: book.updatedAt, types: { add: ["read"] }, fields: { x: 1 } }) });
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "/notes/a", body: { metadata: { x: 1 }, tags: { add: ["read"], remove: [] } } });
  });
  it("never an applet, a component, the app's own record or code", async () => {
    const guarded = {
      app: { ...book, id: "app", tags: ["applet"] }, comp: { ...book, id: "comp", tags: ["component"] }, set: { ...book, id: "set", path: "Notes/S", tags: ["parachute-settings"] },
      code: { ...book, id: "code", path: "Tools/x.tsx", extension: "tsx" }, folder: { ...book, id: "folder", path: "Applets/Old", tags: [] },
    };
    const { call, calls } = setup(["vaults"], guarded);
    for (const id of Object.keys(guarded)) await expect(call("update", { vault: "home", id, bytes: enc({ if_updated_at: "x", body: "pwned" }) })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
  it("never gives or takes away an applet's or the app's own name", async () => {
    const { call } = setup(["vaults"], { a: book });
    for (const t of ["applet", "component", "parachute-app", "Parachute-Settings"])
      await expect(call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: "x", tags: { add: [t] } }) })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(call("create", { vault: "home", bytes: enc({ path: "Books/B", body: "", tags: ["applet"] }) })).rejects.toMatchObject({ code: "out_of_scope" });
  });
  it("writes nothing into Applets/, Parachute/ or .parachute/, nor code; saved views only as views", async () => {
    for (const p of ["Applets/X", "applets/X", "Parachute/Settings", ".parachute/x", "Books/x.tsx", "../x", "/x", "Books//x"]) expect(writablePath(p), p).toBe(false);
    expect(writablePath("Books/x")).toBe(true);
    expect(writablePath("Parachute/Views/book/Read")).toBe(true);
    const { call } = setup(["vaults"]);
    await expect(call("create", { vault: "home", bytes: enc({ path: "Parachute/Views/book/Read", body: "" }) })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(call("create", { vault: "home", bytes: enc({ path: "Books/B", body: "", tags: ["parachute-view"] }) })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(call("create", { vault: "home", bytes: enc({ path: "Parachute/Views/book/Read", body: "", tags: ["parachute-view"], fields: { view: { layout: "list" } } }) })).resolves.toBeTruthy();
  });
  it("a field's value is plain: no objects, nothing huge", async () => {
    const { call } = setup(["vaults"], { a: book });
    for (const fields of [{ x: { nested: 1 } }, { "bad key": 1 }, { x: "y".repeat(10_001) }])
      await expect(call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: "x", fields }) })).rejects.toMatchObject({ code: "bad_params" });
  });
});

describe("sharing", () => {
  it("takes an applet's access back only on a tap", async () => {
    const off = setup(["sharing"], {}, { tapped: false });
    await expect(off.call("revoke", { vault: "home", noteId: "app1" })).rejects.toMatchObject({ code: "failed" });
    expect(off.revoked).toEqual([]);
    const on = setup(["sharing"]);
    await on.call("revoke", { vault: "home", noteId: "app1" });
    expect(on.revoked).toEqual(["app1"]);
  });
});
