// The `vaults` and `sharing` words (modules/vaults.ts): what an applet that asked for them may do across the person's
// vaults, and what it never may, whatever its card says.
import { describe, expect, it } from "vitest";
import { createVaultsModule, queryPath, recOf, writablePath, type VaultsDeps } from "./modules/vaults";
import { createRouter } from "./router";

const enc = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).buffer;
type Call = { method: string; path: string; body?: unknown };

function setup(words: ("vaults" | "sharing")[] = ["vaults", "sharing"], records: Record<string, unknown> = {}, opts: { yes?: boolean; door?: "records" | "notes"; types?: unknown[] } = {}) {
  const calls: Call[] = [];
  const revoked: string[] = [];
  const asked: string[] = [];
  const deps: VaultsDeps = {
    list: () => [{ key: "home", name: "home", host: "hub.example", mine: true, home: true, level: "write", connector: "https://hub.example/vault/home/mcp" }],
    door: async () => opts.door ?? "records",
    applets: async () => [{ id: "01APP", name: "Reading", glyph: "📚", href: "/v/home/a/01APP", allowed: false }],
    async request(_v, method, path, body) {
      calls.push({ method, path, body });
      if (path.startsWith("/types") || path.startsWith("/tags")) return [{ name: "book", kind: "type", count: 2, fields: { status: { type: "string", enum: ["to-read", "read"] } } }, ...(opts.types ?? [])];
      const m = /^\/(?:records|notes)\/([^?/]+)/.exec(path);
      if (method === "GET" && m) { const r = records[decodeURIComponent(m[1])]; if (!r) throw new Error("404 not found"); return r; }
      if (method === "GET") return [{ id: "a", path: "Books/A", types: ["book"], tags: [], fields: { status: "read" } }];
      return { id: "a", path: "Books/A", types: ["book"], tags: [], fields: {} };
    },
    watch: () => () => {},
    access: async () => ({ level: "write", mine: true, home: true, hub: "https://hub.example", connector: "https://hub.example/vault/home/mcp", applets: [{ noteId: "app1", name: "Recipe box", glyph: "❀", since: null, changes: false }] }),
    revoke: async (_v, id) => { revoked.push(id); },
    readOnly: async () => {},
    confirm: async (q) => { asked.push(q.title); return (opts.yes ?? true) ? "yes" : "no"; },
    emit: () => {},
  };
  const m = createVaultsModule(words, deps);
  const router = createRouter([m]);
  const call = (method: string, params: unknown) => router.call("vaults", method, params, {}, { charge() {}, closed: () => false });
  return { call, calls, revoked, asked };
}
const book = { id: "a", path: "Books/A", body: "words", types: ["book"], tags: [], fields: { status: "to-read" }, updatedAt: "2026-11-20T00:00:00.000Z" };

describe("vaults.hubs: each hub's one address for an AI (T-476)", () => {
  const hubs = [{ host: "hub.example", address: "https://hub.example/mcp", vaults: ["home"] }];
  const make = (words: ("vaults" | "sharing")[], withHubs = true) => {
    const deps = { list: () => [], ...(withHubs ? { hubs: async () => hubs } : {}) } as unknown as VaultsDeps;
    const router = createRouter([createVaultsModule(words, deps)]);
    return (params: unknown) => router.call("vaults", "hubs", params, {}, { charge() {}, closed: () => false });
  };
  it("needs the vaults word, takes nothing, and answers what the shell knows", async () => {
    await expect(make(["sharing"])({})).rejects.toThrow();
    await expect(make(["vaults"])({ host: "x" })).rejects.toThrow();
    expect(await make(["vaults"])({})).toEqual(hubs);
    // a shell that can't say (tests, an embed): none, so each vault keeps its own address
    expect(await make(["vaults"], false)({})).toEqual([]);
  });
});

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
  it("applets: a vault's applets by name, glyph and address, never their code; vaults' word, a vault held", async () => {
    await expect(setup([]).call("applets", { vault: "home" })).rejects.toMatchObject({ code: "not_granted" });
    expect(await setup(["vaults"]).call("applets", { vault: "home" })).toEqual([{ id: "01APP", name: "Reading", glyph: "📚", href: "/v/home/a/01APP", allowed: false }]);
    await expect(setup(["vaults"]).call("applets", { vault: "elsewhere" })).rejects.toMatchObject({ code: "out_of_scope" });
  });
  it("a vault the device doesn't hold is refused", async () => {
    await expect(setup().call("query", { vault: "elsewhere" })).rejects.toMatchObject({ code: "out_of_scope" });
  });
  it("a query becomes the hub's: type, field filters, a field's sort, one more than asked (to know there is more)", async () => {
    const { call, calls } = setup();
    const r = await call("query", { vault: "home", type: "book", where: [{ field: "status", op: "eq", value: "read" }], sort: { by: "rating", dir: "desc" }, limit: 100, offset: 200 });
    expect(r.records[0]).toMatchObject({ id: "a", types: ["book"], fields: { status: "read" } });
    const q = new URLSearchParams(calls.at(-1)!.path.split("?")[1]);
    expect(JSON.parse(q.get("metadata")!)).toEqual({ status: { eq: "read" } });
    expect(Object.fromEntries(q)).toMatchObject({ tag: "book", order_by: "rating", sort: "desc", limit: "101", offset: "200", include_fields: "true" });
  });
  it("a field named for an object's machinery is refused: nothing reaches the shell's prototypes", async () => {
    const { call, calls } = setup();
    for (const field of ["__proto__", "constructor", "prototype"]) {
      await expect(call("query", { vault: "home", where: [{ field, op: "exists", value: true }] })).rejects.toMatchObject({ code: "bad_params" });
      await expect(call("query", { vault: "home", sort: { by: field, dir: "asc" } })).rejects.toMatchObject({ code: "bad_params" });
    }
    expect(({} as Record<string, unknown>).exists).toBeUndefined();
    expect(calls).toEqual([]);
  });
  it("a query it can't say is refused before the hub sees it", async () => {
    const { call } = setup();
    for (const bad of [{ vault: "home", limit: 5000 }, { vault: "home", where: [{ field: "x;drop", op: "eq", value: 1 }] }, { vault: "home", where: [{ field: "x", op: "like", value: 1 }] }, { vault: "home", path: "../x/" }, { vault: "home", nope: 1 }])
      await expect(call("query", bad)).rejects.toMatchObject({ code: "bad_params" });
  });
  it("a sort the hub can't do (by name) asks for the newest first, not the oldest", () => {
    const q = new URLSearchParams(queryPath({ vault: "v", type: "book", where: [], sort: { by: "title", dir: "asc" }, limit: 10, offset: 0 }, "records").split("?")[1]);
    expect([q.get("order_by"), q.get("sort")]).toEqual(["updated_at", "desc"]);
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

describe("watch", () => {
  it("a frame that went while the vault's names were read gets no watch", async () => {
    let watched = 0;
    const m = createVaultsModule(["vaults"], { list: () => [{ key: "home", name: "home", host: "h", mine: true, home: true, level: "write", connector: "https://h/vault/home/mcp" }], applets: async () => [], door: async () => "records", request: async () => [],
      watch: () => { watched++; return () => {}; }, access: async () => { throw new Error("x"); }, revoke: async () => {}, readOnly: async () => {}, confirm: async () => "no", emit: () => {} });
    const r = createRouter([m]);
    await expect(r.call("vaults", "watch", { vault: "home" }, {}, { charge() {}, closed: () => true })).rejects.toMatchObject({ code: "failed" });
    expect(watched).toBe(0);
    await r.call("vaults", "watch", { vault: "home" }, {}, { charge() {}, closed: () => false });
    expect(watched).toBe(1);
  });
});

describe("sharing", () => {
  it("takes an applet's access back only after the person's yes on the app's own sheet, naming it", async () => {
    const no = setup(["sharing"], {}, { yes: false });
    await expect(no.call("revoke", { vault: "home", noteId: "app1" })).rejects.toMatchObject({ code: "failed" });
    expect(no.revoked).toEqual([]);
    const yes = setup(["sharing"]);
    await yes.call("revoke", { vault: "home", noteId: "app1" });
    expect(yes.asked).toEqual(["Revoke Recipe box?"]);
    expect(yes.revoked).toEqual(["app1"]);
  });
  it("publishing is never something a change gives: not the tag (publish, published, any case), not the field", async () => {
    const { call, calls } = setup(["vaults"], { a: book });
    for (const c of [{ tags: { add: ["publish"] } }, { tags: { add: ["Published"] } }, { types: { add: ["PUBLISH"] } }, { fields: { published: true } }])
      await expect(call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: book.updatedAt, ...c }) })).rejects.toMatchObject({ code: "out_of_scope" });
    for (const r of [{ tags: ["publish"] }, { tags: ["published"] }, { fields: { published: true } }])
      await expect(call("create", { vault: "home", bytes: enc({ path: "Books/B", body: "x", ...r }) })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(call("publish", { vault: "home", id: "a", on: true })).rejects.toMatchObject({ code: "not_granted" });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
  it("sharing's publish sets the field the hub honours, after a yes naming the record's path", async () => {
    const no = setup(["sharing"], { a: book }, { yes: false });
    await expect(no.call("publish", { vault: "home", id: "a", on: true })).rejects.toMatchObject({ code: "failed" });
    expect(no.calls.filter((c) => c.method !== "GET")).toEqual([]);
    const yes = setup(["sharing"], { a: book });
    await yes.call("publish", { vault: "home", id: "a", on: true });
    expect(yes.asked).toEqual(["Publish “Books/A”?"]);
    expect(yes.calls.at(-1)).toMatchObject({ method: "PATCH", body: { fields: { published: true }, if_updated_at: book.updatedAt } });
    // off takes the field and any publish tag away, and isn't asked
    const off = setup(["sharing"], { a: { ...book, tags: ["publish"], fields: { published: true } } });
    await off.call("publish", { vault: "home", id: "a", on: false });
    expect(off.asked).toEqual([]);
    expect(off.calls.at(-1)).toMatchObject({ method: "PATCH", body: { fields: { published: null }, tags: { remove: ["publish"] } } });
  });
  it("a publish tag held as a type counts as public, and Unpublish takes it away: as a type, or on 0.8 as the tag it is", async () => {
    const off = setup(["sharing"], { a: { ...book, types: ["book", "publish"] } });
    await off.call("publish", { vault: "home", id: "a", on: false });
    expect(off.calls.at(-1)).toMatchObject({ method: "PATCH", body: { types: { remove: ["publish"] } } });
    // 0.8: no types; a tag with a schema reads as a type (recOf), and goes back out as a tag
    const old = setup(["sharing"], { a: { id: "a", path: "Books/A", content: "w", tags: ["book", "publish"], metadata: {}, updatedAt: book.updatedAt } }, { door: "notes", types: [{ name: "publish", kind: "type", count: 1, fields: { x: {} } }] });
    await old.call("publish", { vault: "home", id: "a", on: false });
    expect(old.calls.at(-1)).toMatchObject({ method: "PATCH", path: "/notes/a", body: { metadata: { published: null }, tags: { remove: ["publish"] } } });
  });
  it("sharing's publish hands back nothing of the record: only whether it is published and whether that changed", async () => {
    const already = setup(["sharing"], { a: { ...book, fields: { published: true, secret: "x" } } });
    expect(await already.call("publish", { vault: "home", id: "a", on: true })).toEqual({ published: true, changed: false });
    const off = setup(["sharing"], { a: { ...book, fields: { published: true, secret: "x" } } });
    expect(await off.call("publish", { vault: "home", id: "a", on: false })).toEqual({ published: false, changed: true });
  });
  it("a type whose schema gives published a default can't be given by a change (the hub would fill it in)", async () => {
    const post = { name: "post", kind: "type", count: 0, fields: { published: { type: "boolean", default: true } } };
    const { call, calls } = setup(["vaults"], { a: book }, { types: [post] });
    await expect(call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: book.updatedAt, types: { add: ["post"] } }) })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(call("create", { vault: "home", bytes: enc({ path: "Posts/A", body: "x", types: ["post"] }) })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    // a type without such a default goes in as any other
    await expect(call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: book.updatedAt, types: { add: ["book"] } }) })).resolves.toBeTruthy();
  });
  it("the sheet's words carry no hidden or direction-changing character from a record's path", async () => {
    const yes = setup(["sharing"], { a: { ...book, path: "Recipes/\u202Egnp.txet\u202C\u200B" } });
    await yes.call("publish", { vault: "home", id: "a", on: true });
    expect(yes.asked).toEqual(["Publish “Recipes/gnp.txet”?"]);
  });
  it("public is the hub's rule exactly: the tag publish (its case), or the field", async () => {
    const { isPublic } = await import("./modules/vaults");
    expect(isPublic({ tags: ["publish"], fields: {} })).toBe(true);
    expect(isPublic({ tags: ["Publish"], fields: {} })).toBe(false);
    expect(isPublic({ tags: ["published"], fields: {} })).toBe(false);
    expect(isPublic({ tags: [], fields: { published: true } })).toBe(true);
  });
  it("a published record changes only after the person's yes (anyone with its link reads it)", async () => {
    const pub = { ...book, fields: { published: true } };
    const no = setup(["vaults"], { a: pub }, { yes: false });
    await expect(no.call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: book.updatedAt, body: "my journal" }) })).rejects.toMatchObject({ code: "failed" });
    expect(no.calls.filter((c) => c.method !== "GET")).toEqual([]);
    const yes = setup(["vaults"], { a: { ...book, tags: ["publish"] } });
    await yes.call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: book.updatedAt, body: "ok" }) });
    expect(yes.asked).toEqual(["Change “Books/A”?"]);
  });
  it("a change is to the version it was judged on", async () => {
    const { call, calls } = setup(["vaults"], { a: book });
    await expect(call("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: "2020-01-01T00:00:00.000Z", body: "x" }) })).rejects.toMatchObject({ code: "failed" });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

describe("what shows, from what was read before (T-476)", () => {
  /** A shell with `read` (the copies): each read says where it went; `publishes` is what the hub says of the type post. */
  function kept() {
    const reads: string[] = [], calls: Call[] = [];
    const deps: VaultsDeps = {
      list: () => [{ key: "home", name: "home", host: "hub.example", mine: true, home: true, level: "write", connector: "https://hub.example/vault/home/mcp" }],
      door: async () => "records",
      async request(_v, method, path, body) {
        calls.push({ method, path, body });
        // the hub, now: the type post gives `published` a default (it would publish what it is given)
        if (path.startsWith("/types")) return [{ name: "post", kind: "type", count: 0, fields: { published: { type: "boolean", default: true } } }];
        return method === "GET" ? (path.startsWith("/records/") ? book : [book]) : { ...book, body: "new" };
      },
      // the copy, from before: post published nothing
      async read(_v, path) { reads.push(path); if (path.startsWith("/types")) return [{ name: "post", kind: "type", count: 0, fields: {} }]; return path.startsWith("/records/") ? { ...book, updatedAt: "2026-11-01T00:00:00.000Z" } : [book]; },
      applets: async () => [], watch: () => () => {}, access: async () => { throw new Error("no"); }, revoke: async () => {}, readOnly: async () => {}, confirm: async () => "yes", emit: () => {},
    };
    const router = createRouter([createVaultsModule(["vaults"], deps)]);
    const c = (method: string, params: unknown) => router.call("vaults", method, params, {}, { charge() {}, closed: () => false });
    return { reads, calls, c };
  }
  it("a record is read through `read` (the kept copy); a list and the types from the hub", async () => {
    const { reads, calls, c } = kept();
    await c("get", { vault: "home", id: "a" });
    await c("query", { vault: "home", type: "book" });
    await c("types", { vault: "home" });
    // the record, and the names it is drawn with
    expect([...new Set(reads.map((p) => p.split("?")[0]))].sort()).toEqual(["/records/a", "/types"]);
    expect([...new Set(calls.filter((x) => x.method === "GET").map((x) => x.path.split("?")[0]))].sort()).toEqual(["/records", "/types"]);
  });
  it("a change is judged on the hub now: the record as it is, and the types that publish", async () => {
    const { calls, c } = kept();
    await c("update", { vault: "home", id: "a", bytes: enc({ body: "new", if_updated_at: book.updatedAt }) });
    expect(calls.map((x) => `${x.method} ${x.path.split("?")[0]}`)).toContain("PATCH /records/a");
    expect(calls.find((x) => x.method === "GET" && x.path.startsWith("/records/a"))).toBeTruthy();
    // the copy says post publishes nothing; the hub says it does: adding it is refused
    await expect(c("update", { vault: "home", id: "a", bytes: enc({ if_updated_at: book.updatedAt, types: { add: ["post"] } }) })).rejects.toThrow(/publish/);
  });
  it("a change refused as changed meanwhile: the record's next read for what shows is the hub's, not the copy from before", async () => {
    const { reads, calls, c } = kept();
    await expect(c("update", { vault: "home", id: "a", bytes: enc({ body: "mine", if_updated_at: "2026-01-01T00:00:00.000Z" }) })).rejects.toThrow(/conflict/);
    const before = calls.filter((x) => x.method === "GET" && x.path.startsWith("/records/a")).length;
    await c("get", { vault: "home", id: "a" });
    expect(calls.filter((x) => x.method === "GET" && x.path.startsWith("/records/a")).length).toBe(before + 1);
    expect(reads.filter((p) => p.startsWith("/records/a"))).toEqual([]);
    // and the one after that, from the copy again
    await c("get", { vault: "home", id: "a" });
    expect(reads.filter((p) => p.startsWith("/records/a"))).toHaveLength(1);
  });
});
