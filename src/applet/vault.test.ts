// The frame's way to the vault, end to end inside the app: a message from the frame → session → router → vault
// module → a vault (in memory here: the vault itself is outside this app). What these prove: a call the grant
// doesn't name never reaches the vault, and nothing outside the applet's folders comes back.
import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "./router";
import { createSession } from "./session";
import { createVaultModule, isAppletCode, type VaultDeps, type VaultNote } from "./modules/vault";
import { createThemeModule } from "./modules/theme";
import { parseManifest } from "./manifest";
import { resolvedOf } from "./discovery";
import { RECIPES } from "./fixtures";
import homeRecord from "../../applets/home.json";
import { LIMITS, type HostMessage } from "./contract";
import { Blob as NodeBlob } from "node:buffer";

const manifest = (() => { const r = parseManifest(RECIPES); if (!r.ok) throw new Error(r.error); return r.manifest; })();
let notes: VaultNote[];
let created: { path: string; tags: string[]; types?: string[]; metadata?: Record<string, unknown> }[];
let saved: { id: string; content?: string; metadata?: Record<string, unknown>; types?: unknown; tags?: unknown }[];
const vault: VaultDeps = {
  async listPaths() { return notes.map((n) => ({ id: n.id, path: n.path ?? null, extension: n.extension ?? "md", updatedAt: n.updatedAt })); },
  async getNote(ref) { const n = notes.find((x) => x.id === ref || x.path === ref); if (!n) throw new Error("missing"); return n; },
  // a search that ignores the folder asked for: the module must judge every hit itself
  async search(q, limit) { return notes.filter((n) => n.content?.includes(q)).slice(0, limit).map((n) => ({ id: n.id, path: n.path ?? null, snippet: "" })); },
  async create(path, content, tags, more) {
    if (notes.some((n) => n.path === path)) throw new Error("exists");
    created.push({ path, tags, ...(more?.types ? { types: more.types } : {}), ...(more?.metadata ? { metadata: more.metadata } : {}) });
    const n = { id: `n${notes.length + 1}`, path, content, tags: [...(more?.types ?? []), ...tags], metadata: more?.metadata ?? {}, updatedAt: "2026-11-15" }; notes.push(n); return n;
  },
  async save(id, content, _at, more) {
    const n = notes.find((x) => x.id === id)!;
    saved.push({ id, ...(content !== undefined ? { content } : {}), ...more });
    if (content !== undefined) n.content = content;
    if (more?.metadata) n.metadata = { ...n.metadata, ...more.metadata };
    return n;
  },
};
beforeEach(() => {
  created = [];
  saved = [];
  notes = [
    { id: "r1", path: "Recipes/Toast", content: "toast", tags: ["recipe"], updatedAt: "2026-11-02" },
    { id: "j1", path: "Journal/Secret", content: "toast secret", tags: [], updatedAt: "2026-11-03" },
    { id: "a1", path: "Recipes/Widget", extension: "html", content: "<p>code</p>", tags: ["applet"], updatedAt: "2026-11-01" },
    { id: "a2", path: "Recipes/Tagged", extension: "md", content: "an applet by its tag", tags: ["applet"], updatedAt: "2026-11-01" },
    { id: "a3", path: "Recipes/Page.html", extension: "html", content: "<p>an html note</p>", tags: [], updatedAt: "2026-11-01" },
  ];
});

function frame(grant = resolvedOf(manifest)) {
  const out: HostMessage[] = [];
  const router = createRouter([createVaultModule(vault, { opens: [{ type: "recipe", path: "Recipes/" }] }), createThemeModule({ theme: () => ({ text: "", muted: "", accent: "", surface: "", line: "", sans: "", serif: "", mono: "" }) })]);
  const s = createSession({ post: (m) => out.push(m), router, grant });
  let n = 0;
  const fetch = async (method: string, path: string, body: unknown = null) => {
    const id = `f${++n}`;
    s.handle({ pfr: 1, channel: "vault", id, method, path, headers: {}, body: body === null ? null : JSON.stringify(body) });
    for (let i = 0; i < 50 && !out.some((m) => "id" in m && m.id === id); i++) await new Promise((r) => setTimeout(r, 1));
    const m = out.find((x) => "id" in x && x.id === id) as { status: number; body: string };
    return { status: m.status, body: JSON.parse(m.body) };
  };
  return { fetch, out, session: s };
}

describe("the vault, from inside a frame", () => {
  it("lists only notes in its folders, and never an applet's code", async () => {
    const r = await frame().fetch("GET", "/api/notes");
    expect(r.status).toBe(200);
    expect(r.body.map((n: { path: string }) => n.path)).toEqual(["Recipes/Toast", "Recipes/Tagged"]);
  });
  it("can't read a note outside its folders, by id, by path or by query", async () => {
    const f = frame();
    expect((await f.fetch("GET", "/api/notes/j1")).status).toBe(404);
    expect((await f.fetch("GET", `/api/notes/${encodeURIComponent("Journal/Secret")}`)).status).toBe(404);
    expect((await f.fetch("GET", "/api/notes?id=j1&include_content=true")).body).toEqual([]);
    expect((await f.fetch("GET", "/api/notes?path_prefix=Journal/")).status).toBe(403);
    expect((await f.fetch("GET", "/api/notes?search=secret")).body).toEqual([]);
  });
  it("can't write outside its folders, or change an applet's code inside them", async () => {
    const f = frame();
    expect((await f.fetch("POST", "/api/notes", { path: "Journal/new", content: "x" })).status).toBe(403);
    expect((await f.fetch("PATCH", "/api/notes/a1", { content: "<p>evil</p>", if_updated_at: "x" })).status).toBe(403);
    expect((await f.fetch("PATCH", "/api/notes/a2", { content: "x", if_updated_at: "x" })).status).toBe(403);
    expect((await f.fetch("PATCH", "/api/notes/a3", { content: "x", if_updated_at: "x" })).status).toBe(403);
    expect((await f.fetch("PATCH", "/api/notes/j1", { content: "x", if_updated_at: "x" })).status).toBe(404);
    expect((await f.fetch("DELETE", "/api/notes/r1")).status).toBe(405);
    expect(created).toEqual([]);
  });
  it("tags a note it adds where it opens a type", async () => {
    const r = await frame().fetch("POST", "/api/notes", { path: "Recipes/Soup", content: "# Soup" });
    expect(r.status).toBe(201);
    expect(created).toEqual([{ path: "Recipes/Soup", tags: ["recipe"] }]);
  });
  it("can't give a note the app's own names: applet, component, pointer, any parachute-*", async () => {
    const f = frame();
    for (const name of ["applet", "component", "parachute-pointer", "parachute-settings", "parachute-app", "applet/sub"]) {
      expect((await f.fetch("POST", "/api/notes", { path: "Recipes/Soup", content: "x", tags: [name] })).status).toBe(403);
      expect((await f.fetch("POST", "/api/notes", { path: "Recipes/Soup", content: "x", types: [name] })).status).toBe(403);
      expect((await f.fetch("PATCH", "/api/notes/r1", { tags: { add: [name] }, if_updated_at: "x" })).status).toBe(403);
      expect((await f.fetch("PATCH", "/api/notes/r1", { types: { add: [name] }, if_updated_at: "x" })).status).toBe(403);
    }
    expect(created).toEqual([]);
    expect(saved).toEqual([]);
  });
  it("gets nothing at all without a read grant", async () => {
    expect((await frame({}).fetch("GET", "/api/notes")).status).toBe(403);
  });
  it("answers too many requests with rate_limited, never silence", async () => {
    const f = frame();
    for (let i = 0; i < 70; i++) f.session.handle({ uni: 1, id: `t${i}`, ns: "theme", method: "get" });
    await new Promise((r) => setTimeout(r, 10));
    const errors = f.out.filter((m) => "error" in m).map((m) => (m as { error: { code: string } }).error.code);
    // every one of the 70 is answered; past 60 in the window, with rate_limited
    expect(errors.filter((c) => c === "rate_limited")).toHaveLength(10);
    expect(f.out.filter((m) => "id" in m)).toHaveLength(70);
  });
  it("past the 60, a call only a tap can make still gets through, ten at most: a busy frame doesn't starve a tap (T-476)", async () => {
    const f = frame();
    for (let i = 0; i < 60; i++) f.session.handle({ uni: 1, id: `t${i}`, ns: "theme", method: "get" });
    f.session.handle({ uni: 1, id: "busy", ns: "theme", method: "get" });
    for (let i = 0; i < 12; i++) f.session.handle({ uni: 1, id: `r${i}`, ns: "voice", method: "record", params: {} });
    await new Promise((r) => setTimeout(r, 10));
    const code = (id: string) => (f.out.find((m) => "id" in m && m.id === id) as { error?: { code: string } } | undefined)?.error?.code;
    expect(code("busy")).toBe("rate_limited");
    // the module answers these (this frame has no microphone): not the limiter, for ten of them
    expect(Array.from({ length: 12 }, (_, i) => code(`r${i}`)).filter((c) => c === "rate_limited")).toHaveLength(2);
    // a post is not a tap's call, unless it is a bot's approval (the broker asks the tap for it)
    const g = frame();
    for (let i = 0; i < 60; i++) g.session.handle({ uni: 1, id: `t${i}`, ns: "theme", method: "get" });
    g.session.handle({ uni: 1, id: "post", ns: "services", method: "publish", params: { service: "rooms", event: { kind: 9, content: "hello", tags: [] } } });
    g.session.handle({ uni: 1, id: "approve", ns: "services", method: "publish", params: { service: "rooms", event: { kind: 9, content: "@Uni /approve", tags: [] } } });
    await new Promise((r) => setTimeout(r, 10));
    const gc = (id: string) => (g.out.find((m) => "id" in m && m.id === id) as { error?: { code: string } } | undefined)?.error?.code;
    expect(gc("post")).toBe("rate_limited");
    expect(gc("approve")).not.toBe("rate_limited");
    // what it keeps on the device has its own 60: a busy frame's draft still goes (T-476)
    g.session.handle({ uni: 1, id: "draft", ns: "storage", method: "set", params: { key: "d", value: "half a thought" } });
    g.session.handle({ uni: 1, id: "kept", ns: "saved", method: "put", params: { entries: { a: 1 } } });
    await new Promise((r) => setTimeout(r, 10));
    expect(gc("draft")).toBeDefined();
    expect(gc("kept")).toBeDefined();
    expect(gc("draft")).not.toBe("rate_limited");
    expect(gc("kept")).not.toBe("rate_limited");
    // and that budget is 60 of its own: the 61st device call is refused, while the other calls' budget is untouched
    const h = frame();
    for (let i = 0; i < 61; i++) h.session.handle({ uni: 1, id: `s${i}`, ns: "storage", method: "get", params: { key: "d" } });
    await new Promise((r) => setTimeout(r, 10));
    h.session.handle({ uni: 1, id: "theme", ns: "theme", method: "get" });
    await new Promise((r) => setTimeout(r, 10));
    const hc = (id: string) => (h.out.find((m) => "id" in m && m.id === id) as { error?: { code: string } } | undefined)?.error?.code;
    expect(Array.from({ length: 61 }, (_, i) => hc(`s${i}`)).filter((c) => c === "rate_limited")).toHaveLength(1);
    expect(hc("theme")).toBeUndefined();
  });
  it("refuses an unknown namespace and a malformed message", async () => {
    const f = frame();
    f.session.handle({ uni: 1, id: "c1", ns: "chat", method: "recent" });
    f.session.handle({ uni: 2, id: "c2", ns: "theme", method: "get" });
    await new Promise((r) => setTimeout(r, 5));
    expect(f.out).toEqual(expect.arrayContaining([
      { uni: 1, id: "c1", error: { code: "unknown_namespace", message: "unknown_namespace" } },
      { uni: 1, id: "c2", error: { code: "bad_version", message: "bad_version" } },
    ]));
  });
});

describe("typed writes: fields, types and tags, in the folders its card names (T-476)", () => {
  it("sets a record's fields in one call, and the answer carries them", async () => {
    notes[0].metadata = { book_status: "to-read", rating: 3 };
    const r = await frame().fetch("PATCH", "/api/notes/r1", { metadata: { book_status: "read" }, if_updated_at: "2026-11-02" });
    expect(r.status).toBe(200);
    expect(saved).toEqual([{ id: "r1", metadata: { book_status: "read" } }]);
    expect(r.body.metadata).toEqual({ book_status: "read", rating: 3 });
  });
  it("gives and takes away the type its card names for that folder, with or without new text", async () => {
    const r = await frame().fetch("PATCH", "/api/notes/r1", { content: "toast!", types: { add: ["recipe"] }, tags: { remove: ["recipe"] }, if_updated_at: "2026-11-02" });
    expect(r.status).toBe(200);
    expect(saved).toEqual([{ id: "r1", content: "toast!", types: { add: ["recipe"] }, tags: { remove: ["recipe"] } }]);
  });
  it("creates a record with its type and fields; the type it opens is added anyway", async () => {
    const r = await frame().fetch("POST", "/api/notes", { path: "Recipes/Soup", content: "# Soup", types: ["recipe"], metadata: { serves: 4 } });
    expect(r.status).toBe(201);
    expect(created).toEqual([{ path: "Recipes/Soup", tags: ["recipe"], types: ["recipe"], metadata: { serves: 4 } }]);
  });
  it("gives no other name: not one its card doesn't name, not publish (the open web), not `published`", async () => {
    const f = frame();
    for (const name of ["dish", "favourite", "publish", "Recipe", "recipe/sub"]) {
      expect((await f.fetch("POST", "/api/notes", { path: "Recipes/Soup", content: "x", types: [name] })).status).toBe(403);
      expect((await f.fetch("POST", "/api/notes", { path: "Recipes/Soup", content: "x", tags: [name] })).status).toBe(403);
      expect((await f.fetch("PATCH", "/api/notes/r1", { tags: { add: [name] }, if_updated_at: "x" })).status).toBe(403);
      expect((await f.fetch("PATCH", "/api/notes/r1", { types: { remove: [name] }, if_updated_at: "x" })).status).toBe(403);
    }
    for (const key of ["published", "Published"]) {
      expect((await f.fetch("PATCH", "/api/notes/r1", { metadata: { [key]: true }, if_updated_at: "x" })).status).toBe(400);
      expect((await f.fetch("POST", "/api/notes", { path: "Recipes/Soup", content: "x", metadata: { [key]: true } })).status).toBe(400);
    }
    expect(created).toEqual([]);
    expect(saved).toEqual([]);
  });
  it("only inside the folders its card names, and never on an applet's code", async () => {
    const f = frame();
    expect((await f.fetch("PATCH", "/api/notes/j1", { metadata: { x: 1 }, if_updated_at: "x" })).status).toBe(404);
    expect((await f.fetch("PATCH", "/api/notes/a2", { metadata: { x: 1 }, if_updated_at: "x" })).status).toBe(403);
    expect((await f.fetch("POST", "/api/notes", { path: "Journal/new", content: "x", metadata: { x: 1 } })).status).toBe(403);
    // a read-only grant changes no fields
    const ro = parseManifest({ ...RECIPES, access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read"] }] }] });
    if (!ro.ok) throw new Error(ro.error);
    expect((await frame(resolvedOf(ro.manifest)).fetch("PATCH", "/api/notes/r1", { metadata: { x: 1 }, if_updated_at: "x" })).status).toBe(403);
    expect(saved).toEqual([]);
  });
  it("never changes a note of the app's own (its settings) through fields or tags", async () => {
    notes.push({ id: "s1", path: "Recipes/Settings", content: "s", tags: ["parachute-settings"], metadata: { parachute: { bar: [] } }, updatedAt: "2026-11-02" });
    const f = frame();
    expect((await f.fetch("PATCH", "/api/notes/s1", { metadata: { parachute: "x" }, if_updated_at: "x" })).status).toBe(403);
    expect((await f.fetch("PATCH", "/api/notes/s1", { tags: { remove: ["parachute-settings"] }, if_updated_at: "x" })).status).toBe(403);
    expect(saved).toEqual([]);
  });
  it("refuses fields that aren't plain values, and a change of nothing", async () => {
    const f = frame();
    for (const metadata of [{ a: { nested: 1 } }, { "bad key": 1 }, [1], "x", { a: () => 1 }]) {
      expect((await f.fetch("PATCH", "/api/notes/r1", { metadata, if_updated_at: "x" })).status).toBe(400);
    }
    expect((await f.fetch("PATCH", "/api/notes/r1", { if_updated_at: "x" })).status).toBe(400);
    expect((await f.fetch("PATCH", "/api/notes/r1", { types: ["dish"], if_updated_at: "x" })).status).toBe(400);
    expect(saved).toEqual([]);
  });
});

describe("fields on a list", () => {
  it("include_metadata brings each note's tags and fields, and still only from its folders", async () => {
    notes[0].metadata = { when: "2026-11-20" };
    const r = await frame().fetch("GET", "/api/notes?path_prefix=Recipes/&include_metadata=true");
    expect(r.status).toBe(200);
    const rows = r.body as { path: string; metadata?: Record<string, unknown>; tags?: string[] }[];
    expect(rows.find((x) => x.path === "Recipes/Toast")).toMatchObject({ metadata: { when: "2026-11-20" }, tags: ["recipe"] });
    expect(rows.some((x) => x.path.startsWith("Journal/"))).toBe(false);
    // fields, not bodies: a body comes only with include_content
    expect(rows.find((x) => x.path === "Recipes/Toast")).not.toHaveProperty("content");
    // without it, a list is what it was: ids, paths and times
    const plain = (await frame().fetch("GET", "/api/notes?path_prefix=Recipes/")).body as Record<string, unknown>[];
    expect(plain[0]).not.toHaveProperty("metadata");
  });
});

describe("fields on a list, in one ask", () => {
  it("asks once per folder, keeps only its folders' notes (whatever the host sends back), and takes a list of fields too", async () => {
    notes[0].metadata = { when: "2026-11-20" };
    let reads = 0, asks = 0;
    const one: VaultDeps = { ...vault, async getNote(ref) { reads++; return vault.getNote(ref); },
      // a host that ignores the folder asked for: the module must judge every note itself
      async listFields() { asks++; return notes.map((n) => ({ ...n, content: undefined })); } };
    const out: HostMessage[] = [];
    const router = createRouter([createVaultModule(one, {})]);
    const s = createSession({ post: (m) => out.push(m), router, grant: resolvedOf(manifest) });
    s.handle({ pfr: 1, channel: "vault", id: "f1", method: "GET", path: "/api/notes?path_prefix=Recipes/&include_metadata=when", headers: {}, body: null });
    await new Promise((r) => setTimeout(r, 0));
    const rows = JSON.parse((out[0] as { body: string }).body) as { path: string; metadata?: Record<string, unknown>; content?: string }[];
    expect(rows.map((r) => r.path).sort()).toEqual(["Recipes/Tagged", "Recipes/Toast"]);
    expect(rows.find((r) => r.path === "Recipes/Toast")?.metadata).toEqual({ when: "2026-11-20" });
    expect(rows.every((r) => !("content" in r))).toBe(true);
    expect([asks, reads]).toEqual([1, 0]);
  });
});

describe("a folder's notes with their words or a tag, in one ask (T-476)", () => {
  /** A frame on a host with `list`, and how many asks and single reads it took. */
  function counted(more: Partial<VaultDeps> = {}) {
    const n = { reads: 0, lists: 0 };
    const deps: VaultDeps = { ...vault, async getNote(ref) { n.reads++; return vault.getNote(ref); },
      // a host that ignores the folder and the tag asked for: the module must judge every note itself
      async list() { n.lists++; return notes.map((x) => ({ ...x })); }, ...more };
    const out: HostMessage[] = [];
    const router = createRouter([createVaultModule(deps, {})]);
    const s = createSession({ post: (m) => out.push(m), router, grant: resolvedOf(manifest) });
    let k = 0;
    const get = async (path: string, headers: Record<string, string> = {}, method = "GET", body: unknown = null) => {
      const id = `f${++k}`;
      s.handle({ pfr: 1, channel: "vault", id, method, path, headers, body: body === null ? null : JSON.stringify(body) });
      for (let i = 0; i < 50 && !out.some((m) => "id" in m && m.id === id); i++) await new Promise((r) => setTimeout(r, 1));
      return JSON.parse((out.find((m) => "id" in m && m.id === id) as { body: string }).body) as { path: string; content?: string; tags?: string[] }[];
    };
    return { n, get };
  }
  it("reads the words of a folder's notes in one ask, never one note at a time, and only its folders' notes", async () => {
    const f = counted();
    const rows = await f.get("/api/notes?path_prefix=Recipes/&include_content=true");
    expect(rows.map((r) => r.path).sort()).toEqual(["Recipes/Tagged", "Recipes/Toast"]);
    expect(rows.find((r) => r.path === "Recipes/Toast")?.content).toBe("toast");
    expect(f.n).toEqual({ reads: 0, lists: 1 });
  });
  it("a tag: the host's answer is judged again on each note's tags", async () => {
    const f = counted();
    expect((await f.get("/api/notes?tag=recipe")).map((r) => r.path)).toEqual(["Recipes/Toast"]);
    expect(f.n.reads).toBe(0);
  });
  it("a host whose one ask fails is read note by note, as before", async () => {
    const f = counted({ async list() { throw new Error("too big"); } });
    expect((await f.get("/api/notes?path_prefix=Recipes/&include_content=true")).map((r) => r.path).sort()).toEqual(["Recipes/Tagged", "Recipes/Toast"]);
    expect(f.n.reads).toBe(2);
  });
  it("a frame that draws itself again on onFresh reads the kept copies; any other, and every write's check, the hub", async () => {
    let kept = 0;
    const keptReads: Pick<VaultDeps, "listPaths" | "getNote" | "search" | "listFields" | "list"> = { ...vault, async getNote(ref) { kept++; return vault.getNote(ref); }, async list() { kept++; return notes; } };
    const f = counted({ kept: keptReads });
    await f.get("/api/notes?path_prefix=Recipes/&include_content=true");
    expect([kept, f.n.lists]).toEqual([0, 1]);
    await f.get("/api/notes?path_prefix=Recipes/&include_content=true", { "x-parachute-redraws": "1" });
    await f.get("/api/notes/r1", { "x-parachute-redraws": "1" });
    expect([kept, f.n.lists, f.n.reads]).toEqual([2, 1, 0]);
    // a change is judged on the note as the hub has it now, whatever the frame says of itself
    await f.get("/api/notes/r1", { "x-parachute-redraws": "1" }, "PATCH", { content: "new toast", if_updated_at: "2026-11-02" });
    expect([kept, f.n.reads]).toEqual([2, 1]);
  });
});

describe("notes no applet may change", () => {
  it("a bundle record, under its name and its older one: it picks what the app shows and pins (docs/design/APP-RECORD.md)", () => {
    for (const tag of ["parachute-bundle", "parachute-app"]) expect(isAppletCode({ id: "n", path: "Parachute/Bundles/uni", tags: [tag] } as VaultNote), tag).toBe(true);
    expect(isAppletCode({ id: "n", path: "Notes/a", tags: ["recipe"] } as VaultNote)).toBe(false);
  });
});

// The hub's own query words (T-476: order, page, filter by a field, tags, links, a long note's write), with the same
// scope: a hub that answers more than the folder asked (path_prefix is a case-blind string prefix on core; tags and
// links reach the whole vault) must not let it out.
describe("the hub's query words, kept to the folders", () => {
  type Asked = { prefix: string; q: Parameters<NonNullable<VaultDeps["query"]>>[1] };
  let asked: Asked[];
  const end = (n: VaultNote) => ({ id: n.id, path: n.path, tags: n.tags ?? [], metadata: n.metadata ?? {}, createdAt: null, updatedAt: n.updatedAt ?? null, linkCount: 3 });
  const LINKS: [string, string][] = [["r1", "j1"], ["r1", "r2"], ["j1", "r1"]];
  const withLinks = (n: VaultNote): VaultNote => ({ ...n, links: LINKS.filter(([s, t]) => s === n.id || t === n.id).map(([s, t]) => ({ sourceId: s, targetId: t, relationship: "mentions", createdAt: "2026-11-01", sourceNote: end(notes.find((x) => x.id === s)!), targetNote: end(notes.find((x) => x.id === t)!) })) });
  const hub: VaultDeps = {
    ...vault,
    async getNote(ref, o) { const n = await vault.getNote(ref); return o?.links ? withLinks(n) : n; },
    // a hub's answer as core gives it: path_prefix case-blind (its lower()), meta[f][gte] and meta[f] filters, ordered by
    // a field or a time, then offset and limit over all of that
    async query(prefix, q) {
      asked.push({ prefix, q });
      const field = (n: VaultNote, f: string) => (n.metadata ?? {})[f] as number | string | undefined;
      let rows = notes.filter((n) => (n.path ?? "").toLowerCase().startsWith(prefix.toLowerCase()) && (!q.tag || (n.tags ?? []).includes(q.tag)) && (!q.search || (n.content ?? "").includes(q.search)));
      for (const [k, v] of q.meta) {
        const m = /^meta\[(\w+)\](?:\[(\w+)\])?$/.exec(k)!;
        rows = rows.filter((n) => m[2] === "gte" ? Number(field(n, m[1])) >= Number(v) : String(field(n, m[1])) === v);
      }
      const key = (n: VaultNote) => q.orderBy === "updated_at" ? n.updatedAt ?? "" : q.orderBy === "created_at" ? n.createdAt ?? "" : field(n, q.orderBy ?? "") ?? "";
      // a search ranks by itself (here, the boss's memo first); anything else by its order
      rows = q.search ? [...rows].sort((a, b) => Number(b.id === "w9") - Number(a.id === "w9")) : [...rows].sort((a, b) => { const x = key(a), y = key(b); const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)); return (q.sort === "desc" ? -c : c) || a.id.localeCompare(b.id); });
      return rows.slice(q.offset, q.offset + q.limit).map((n) => (q.links ? withLinks(n) : n));
    },
  };
  function frameOn(deps: VaultDeps, grant = resolvedOf(manifest), now?: () => number) {
    const out: HostMessage[] = [];
    const router = createRouter([createVaultModule(deps, { opens: [{ type: "recipe", path: "Recipes/" }], now })]);
    const s = createSession({ post: (m) => out.push(m), router, grant, now });
    let n = 0;
    const send = async (msg: Record<string, unknown>) => {
      const id = `q${++n}`;
      s.handle({ pfr: 1, channel: "vault", id, headers: {}, body: null, ...msg });
      for (let i = 0; i < 50 && !out.some((m) => "id" in m && m.id === id); i++) await new Promise((r) => setTimeout(r, 1));
      const m = out.find((x) => "id" in x && x.id === id) as { status: number; body: string };
      return { status: m.status, body: JSON.parse(m.body) };
    };
    return { get: (path: string) => send({ method: "GET", path }), send };
  }
  beforeEach(() => {
    asked = [];
    notes.push(
      { id: "r2", path: "Recipes/Soup", content: "soup", tags: ["recipe", "winter"], metadata: { serves: 4 }, updatedAt: "2026-11-04" },
      { id: "r3", path: "recipes/Hidden", content: "another folder, by case", tags: ["recipe", "case-secret"], updatedAt: "2026-11-05" },
      { id: "j2", path: "Journal/Diary", content: "dear diary", tags: ["journal-secret"], updatedAt: "2026-11-06" },
    );
  });

  it("passes order_by, sort, offset and meta[...] to the hub with the folder pinned, and judges each note it gets back", async () => {
    const f = frameOn(hub);
    const r = await f.get("/api/notes?order_by=serves&sort=asc&offset=1&limit=10&meta[serves][gte]=2&meta[course]=soup");
    expect(r.status).toBe(200);
    expect(asked).toHaveLength(1);
    expect(asked[0].prefix).toBe("Recipes/");
    // the hub's page is read from the start: the module cuts offset and limit itself, after judging
    expect(asked[0].q).toMatchObject({ orderBy: "serves", sort: "asc", offset: 0, meta: [["meta[serves][gte]", "2"], ["meta[course]", "soup"]] });
    // the hub (case-blind) answered recipes/Hidden too: not in the folder, so not shown
    const all = await f.get("/api/notes?sort=desc");
    expect(all.body.map((n: { path: string }) => n.path)).not.toContain("recipes/Hidden");
    expect(all.body.map((n: { path: string }) => n.path)).toEqual(expect.arrayContaining(["Recipes/Toast", "Recipes/Soup"]));
  });

  it("pages only its own notes: a note outside the folders the hub counts never moves where a page starts or ends", async () => {
    notes.push(
      { id: "w1", path: "Recipes/A", content: "memo", tags: [], metadata: { cost: 100 }, updatedAt: "2026-11-07" },
      { id: "w2", path: "Recipes/B", content: "memo", tags: [], metadata: { cost: 300 }, updatedAt: "2026-11-08" },
      { id: "w3", path: "Recipes/C", content: "memo", tags: [], metadata: { cost: 900 }, updatedAt: "2026-11-09" },
    );
    // enough of its own to fill a page of bodies (50), dearer than any above
    for (let i = 0; i < 60; i++) notes.push({ id: `m${i}`, path: `Recipes/Memo ${i}`, content: "memo", tags: [], metadata: { cost: 1000 + i }, updatedAt: "2026-11-06" });
    const hidden: VaultNote = { id: "w9", path: "recipes/Boss", content: "memo", tags: [], metadata: { cost: 777 }, updatedAt: "2026-11-10" };
    const pages = async () => {
      const f = frameOn(hub), said: string[] = [];
      for (const x of [301, 600, 777, 778]) said.push(JSON.stringify((await f.get(`/api/notes?order_by=cost&sort=asc&limit=1&meta[cost][gte]=${x}`)).body.map((n: { path: string }) => n.path)));
      for (const o of [0, 1, 2, 3]) said.push(JSON.stringify((await f.get(`/api/notes?order_by=cost&sort=asc&limit=1&offset=${o}&meta[cost][gte]=1`)).body.map((n: { path: string }) => n.path)));
      // a search, ranked by the hub with the hidden note first, the same
      for (const x of [101, 700, 777, 778]) said.push(JSON.stringify((await f.get(`/api/notes?search=memo&limit=1&meta[cost][gte]=${x}`)).body.map((n: { path: string }) => n.path)));
      // and asking for bodies and links, a page as long as the hub's page of them
      for (const x of [101, 777, 778]) said.push(JSON.stringify((await frameOn(hub).get(`/api/notes?search=memo&include_content=true&include_links=true&limit=50&meta[cost][gte]=${x}`)).body.map((n: { path: string; content: string }) => n.path + ":" + n.content)));
      return said;
    };
    const without = await pages();
    notes.push(hidden);
    expect(await pages()).toEqual(without);
    expect(without.slice(0, 4)).toEqual(['["Recipes/C"]', '["Recipes/C"]', '["Recipes/C"]', '["Recipes/C"]']);
    // bodies after a search: at most 20, read one by one
    expect(JSON.parse(without[12])).toHaveLength(20);
  });

  it("a list read in pages goes on where its last page stopped: the hub read through once, the same notes as from the start", async () => {
    for (let i = 0; i < 300; i++) notes.push({ id: `b${String(i).padStart(3, "0")}`, path: `Recipes/Bulk ${i}`, content: "", tags: [], updatedAt: "2026-11-01", createdAt: `2026-10-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` });
    // and one the hub counts that isn't the folder's (case-blind): it must move no page's edge
    notes.push({ id: "b-hidden", path: "recipes/Bulk hidden", content: "", tags: [], updatedAt: "2026-11-01", createdAt: "2026-10-01T00:02:30Z" });
    const words = "order_by=created_at&sort=asc&include_links=true&limit=50";
    const ids = (r: { body: { id: string }[] }) => r.body.map((n) => n.id);
    // each page from the start, in a frame of its own: what it must hand back
    const want: string[][] = [];
    for (let o = 0; o < 350; o += 50) want.push(ids(await frameOn(hub).get(`/api/notes?${words}&offset=${o}`)));
    asked = [];
    const f = frameOn(hub);
    const got: string[][] = [];
    for (let o = 0; o < 350; o += 50) got.push(ids(await f.get(`/api/notes?${words}&offset=${o}`)));
    expect(got).toEqual(want);
    expect(got.flat()).not.toContain("b-hidden");
    // a page of links is 50 of the hub's: read through once (a few rows back each time), not again from the first
    expect(asked.length).toBeLessThanOrEqual(8);
    expect(asked.slice(1).every((a, i) => a.q.offset > asked[i].q.offset)).toBe(true);
    // an offset its last page didn't end at reads from the start again
    asked = [];
    await f.get(`/api/notes?${words}&offset=100`);
    expect(asked[0].q.offset).toBe(0);
    // notes removed behind it while it reads: the next page is still the one after the last it handed back, none missed
    const g = frameOn(hub);
    const first = ids(await g.get(`/api/notes?${words}&offset=0`));
    await g.get(`/api/notes?${words}&offset=50`);
    for (const id of first.slice(10, 13)) notes.splice(notes.findIndex((n) => n.id === id), 1);
    asked = [];
    expect(ids(await g.get(`/api/notes?${words}&offset=100`))).toEqual(want[2]);
    expect(asked.length).toBeGreaterThan(0);
  });

  it("a list read one note a page goes on to its end, and notes it can't see change nothing it hands back", async () => {
    const bulk = (n: number) => { for (let i = 0; i < n; i++) notes.push({ id: `c${String(i).padStart(4, "0")}`, path: `Recipes/C ${i}`, content: "x", tags: [], updatedAt: "2026-11-01", createdAt: `2026-10-01T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z` }); };
    const chain = async () => {
      // a page each 200 ms: within the frame's read budget
      let clock = Date.now();
      const f = frameOn(hub, resolvedOf(manifest), () => (clock += 200)), got: string[] = [];
      for (let o = 0; ; o++) {
        const r = await f.send({ method: "GET", path: `/api/notes?order_by=created_at&sort=asc&include_content=true&limit=1&offset=${o}` });
        expect(r.status).toBe(200);
        if (!r.body.length) return got;
        got.push(r.body[0].id);
      }
    };
    bulk(400);
    const plain = await chain();
    expect(plain.filter((id) => id.startsWith("c"))).toHaveLength(400);
    // notes the hub counts (case-blind) and the module drops, among them: the same list, to the same end
    for (const k of [5, 12]) {
      for (let i = 0; i < k; i++) notes.push({ id: `h${k}-${i}`, path: `recipes/Hidden ${i}`, content: "x", tags: [], updatedAt: "2026-11-01", createdAt: `2026-10-01T01:00:${String(i).padStart(2, "0")}Z` });
      expect(await chain()).toEqual(plain);
    }
  });

  it("with nothing changed, a list going on hands back just what a read from the start would, page by page", async () => {
    // seeded: notes the hub counts (case-blind) and the module drops, in runs of any length among its own
    let x = 7;
    const rand = (n: number) => { x = (x * 1103515245 + 12345) % 2147483648; return x % n; };
    const stamp = (i: number) => `2026-10-01T${String(Math.floor(i / 3600)).padStart(2, "0")}:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`;
    const cases: { runs: [number, boolean][]; words: string; limit: number }[] = [
      // the reviewer's: 10 of its own, 1,000 it can't see, 10 more
      { runs: [[10, true], [1000, false], [10, true]], words: "order_by=created_at&sort=asc", limit: 10 },
    ];
    for (let c = 0; c < 6; c++) {
      const runs: [number, boolean][] = [];
      for (let r = 0; r < 8; r++) runs.push([1 + rand(r % 2 ? 260 : 40), r % 2 === 0]);
      cases.push({ runs, words: ["order_by=created_at&sort=asc", "order_by=created_at&sort=asc&include_links=true", "order_by=created_at&sort=desc&include_content=true"][c % 3], limit: c === 0 ? 1 : [7, 50][rand(2)] });
    }
    for (const { runs, words, limit } of cases) {
      const base = notes.length;
      let i = 0;
      for (const [n, own] of runs) for (let k = 0; k < n; k++, i++) notes.push({ id: `r${String(i).padStart(5, "0")}`, path: own ? `Recipes/R ${i}` : `recipes/R ${i}`, content: "", tags: [], updatedAt: "2026-11-01", createdAt: stamp(i) });
      // its read budget full at each call (within a minute: the resume is kept); what it hands back is the point here
      let clock = Date.now();
      const f = frameOn(hub, resolvedOf(manifest), () => (clock += 11));
      const shown = (r: { status: number; body: unknown }) => [r.status, Array.isArray(r.body) ? r.body.map((n: { id: string }) => n.id) : r.body];
      for (let o = 0; o < i + limit && o <= 5000; o += limit) {
        const q = `/api/notes?${words}&limit=${limit}&offset=${o}`;
        clock += 10_000;
        const going = await f.get(q), fresh = await frameOn(hub).get(q);
        expect([o, ...shown(going)]).toEqual([o, ...shown(fresh)]);
      }
      notes.splice(base);
    }
  }, 60_000);

  it("as many of its own notes removed behind it as it steps back: none of the rest is skipped or listed twice", async () => {
    for (let i = 0; i < 300; i++) notes.push({ id: `v${String(i).padStart(4, "0")}`, path: `Recipes/V ${i}`, content: "", tags: [], updatedAt: "2026-11-01", createdAt: `2026-10-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` });
    const words = "order_by=created_at&sort=asc&include_links=true&limit=50";
    const ids = (r: { body: { id: string }[] }) => r.body.map((n) => n.id);
    const f = frameOn(hub), got: string[] = [];
    got.push(...ids(await f.get(`/api/notes?${words}&offset=0`)));
    const shown = new Set(got);
    // five it already handed back go
    for (const id of got.slice(0, 5)) notes.splice(notes.findIndex((n) => n.id === id), 1);
    for (let o = 50; ; o += 50) { const page = ids(await f.get(`/api/notes?${words}&offset=${o}`)); if (!page.length) break; got.push(...page); }
    expect(new Set(got).size).toBe(got.length);
    // every note there now that wasn't shown already comes, in order
    const now: string[] = [];
    for (let o = 0; ; o += 50) { const page = ids(await frameOn(hub).get(`/api/notes?${words}&offset=${o}`)); if (!page.length) break; now.push(...page.filter((id) => !shown.has(id))); }
    expect(got.filter((id) => !shown.has(id))).toEqual(now);
  });

  it("after a write of its own, the next page reads from the start: the note it changed comes as it is now", async () => {
    for (let i = 0; i < 120; i++) notes.push({ id: `w${String(i).padStart(3, "0")}`, path: `Recipes/W ${i}`, content: "before", tags: [], updatedAt: "2026-11-01", createdAt: `2026-10-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` });
    const words = "order_by=created_at&sort=asc&include_content=true&include_links=true&limit=10";
    const f = frameOn(hub);
    const first = (await f.get(`/api/notes?${words}&offset=0`)).body as { id: string }[];
    // one the next page will hand back (its order puts the fixture's own notes first)
    const all = (await frameOn(hub).get(`/api/notes?${words.replace("limit=10", "limit=30")}&offset=0`)).body as { id: string }[];
    const target = all[15].id;
    expect(first.map((n) => n.id)).not.toContain(target);
    const done = await f.send({ method: "PATCH", path: `/api/notes/${target}`, body: JSON.stringify({ content: "after", if_updated_at: "2026-11-01" }) });
    expect(done.status).toBe(200);
    const next = (await f.get(`/api/notes?${words}&offset=10`)).body as { id: string; content: string }[];
    expect(next.find((n) => n.id === target)?.content).toBe("after");
  });

  it("a write of its own while a page is still being read: that page keeps nothing for the next", async () => {
    for (let i = 0; i < 120; i++) notes.push({ id: `y${String(i).padStart(3, "0")}`, path: `Recipes/Y ${i}`, content: "before", tags: [], updatedAt: "2026-11-01", createdAt: `2026-10-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` });
    const words = "order_by=created_at&sort=asc&include_content=true&include_links=true&limit=10";
    const all = (await frameOn(hub).get(`/api/notes?${words.replace("limit=10", "limit=30")}&offset=0`)).body as { id: string }[];
    const target = all[15].id;
    // a hub that reads the first list page, then holds its answer until let go
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    let hold = true;
    const slow: VaultDeps = { ...hub, async query(prefix, q) { const rows = await hub.query!(prefix, q); if (hold) { hold = false; await held; } return rows; } };
    const f = frameOn(slow);
    const first = f.get(`/api/notes?${words}&offset=0`);
    await new Promise((r) => setTimeout(r, 5));
    // the first page is held at the hub now: the write lands while it is being read
    expect(hold).toBe(false);
    expect((await f.send({ method: "PATCH", path: `/api/notes/${target}`, body: JSON.stringify({ content: "after", if_updated_at: "2026-11-01" }) })).status).toBe(200);
    release();
    await first;
    const next = (await f.get(`/api/notes?${words}&offset=10`)).body as { id: string; content: string }[];
    expect(next.find((n) => n.id === target)?.content).toBe("after");
  });

  it("a page that fails leaves the list where it was: asked again, it goes on, nothing missed", async () => {
    for (let i = 0; i < 200; i++) notes.push({ id: `d${String(i).padStart(3, "0")}`, path: `Recipes/D ${i}`, content: "", tags: [], updatedAt: "2026-11-01", createdAt: `2026-10-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` });
    const words = "order_by=created_at&sort=asc&include_links=true&limit=50";
    const ids = (r: { body: { id: string }[] }) => r.body.map((n) => n.id);
    const want: string[][] = [];
    for (let o = 0; o < 200; o += 50) want.push(ids(await frameOn(hub).get(`/api/notes?${words}&offset=${o}`)));
    let fail = false;
    const flaky: VaultDeps = { ...hub, async query(prefix, q) { if (fail) { fail = false; throw new Error("hub down"); } return hub.query!(prefix, q); } };
    const f = frameOn(flaky);
    expect(ids(await f.get(`/api/notes?${words}&offset=0`))).toEqual(want[0]);
    expect(ids(await f.get(`/api/notes?${words}&offset=50`))).toEqual(want[1]);
    fail = true;
    expect((await f.get(`/api/notes?${words}&offset=100`)).status).toBe(502);
    asked = [];
    expect(ids(await f.get(`/api/notes?${words}&offset=100`))).toEqual(want[2]);
    expect(asked[0].q.offset).toBeGreaterThan(0);
  });

  it("two folders: newest changed first unless asked, put together as the hub orders each", async () => {
    const two = parseManifest({ ...RECIPES, access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read"] }, { path: "Soups/", verbs: ["read"] }] }] });
    if (!two.ok) throw new Error(two.error);
    notes.push({ id: "s1", path: "Soups/Leek", content: "", tags: [], updatedAt: "2026-11-20", createdAt: "2026-10-01" }, { id: "s2", path: "Soups/Old", content: "", tags: [], updatedAt: "2026-10-02", createdAt: "2026-10-02" });
    const f = frameOn(hub, resolvedOf(two.manifest));
    const paths = async (q: string) => (await f.get(`/api/notes?${q}`)).body.map((n: { path: string }) => n.path);
    expect(await paths("include_links=true&limit=2")).toEqual(["Soups/Leek", "Recipes/Soup"]);
    expect(await paths("order_by=updated_at&sort=asc&limit=2")).toEqual(["Soups/Old", "Recipes/Tagged"]);
    expect(await paths("order_by=updated_at&sort=desc&offset=1&limit=1")).toEqual(["Recipes/Soup"]);
    // a field's order can't be put together across two folders
    expect((await f.get("/api/notes?order_by=serves")).status).toBe(400);
  });

  it("refuses the words that would reach past the folder or that it can't put together", async () => {
    const f = frameOn(hub);
    expect((await f.get("/api/notes?path_prefix=Journal/&order_by=updated_at")).status).toBe(403);
    // link_count counts links to notes outside the folders
    expect((await f.get("/api/notes?order_by=link_count")).status).toBe(400);
    expect((await f.get("/api/notes?sort=sideways")).status).toBe(400);
    expect((await f.get("/api/notes?offset=-1")).status).toBe(400);
    expect((await f.get("/api/notes?meta[bad key]=1")).status).toBe(400);
    expect((await f.get("/api/notes?meta[serves][regex]=1")).status).toBe(400);
    // the hub's search pages nothing: offset or an order with it would answer page one again and again
    expect((await f.get("/api/notes?search=soup&offset=50")).status).toBe(400);
    expect((await f.get("/api/notes?search=soup&order_by=updated_at")).status).toBe(400);
    expect((await f.get("/api/notes?offset=5001")).status).toBe(400);
    expect(asked).toHaveLength(0);
    // a host with no query (an older one) refuses them rather than ignoring them
    expect((await frameOn(vault).get("/api/notes?order_by=updated_at")).status).toBe(400);
  });

  it("gives a note's links only where the note at the other end is in the folders too", async () => {
    const f = frameOn(hub);
    const listed = await f.get("/api/notes?include_links=true");
    const toast = listed.body.find((n: { id: string }) => n.id === "r1");
    expect(toast.links.map((l: { sourceId: string; targetId: string }) => `${l.sourceId}>${l.targetId}`)).toEqual(["r1>r2"]);
    expect(JSON.stringify(listed.body)).not.toContain("Journal/");
    expect(JSON.stringify(listed.body)).not.toContain("linkCount");
    for (const path of ["/api/notes/r1?include_links=true", "/api/notes?id=r1&include_links=true"]) {
      const one = await f.get(path);
      const n = Array.isArray(one.body) ? one.body[0] : one.body;
      expect(n.links.map((l: { targetId: string }) => l.targetId)).toEqual(["r2"]);
      expect(JSON.stringify(one.body)).not.toContain("Secret");
    }
  });

  it("names only the tags on its folders' notes, each with its count there", async () => {
    const r = await frameOn(hub).get("/api/tags");
    expect(r.status).toBe(200);
    const names = r.body.map((t: { name: string }) => t.name);
    expect(names).not.toContain("journal-secret");
    expect(names).not.toContain("case-secret");
    // a.k.a. what the Recipes/ notes carry (the code note a1 is not one of them)
    expect(r.body).toEqual([{ name: "applet", count: 1 }, { name: "recipe", count: 2 }, { name: "winter", count: 1 }]);
    expect((await frameOn(hub).get("/api/tags?include_schema=true")).status).toBe(400);
  });

  it("takes a long note's write as bytes beside the request, and no more than its cap", async () => {
    const f = frameOn(hub);
    const content = "A long stew. ".repeat(2000); // 26 KB: past the 7 KB a request's body carries
    const bytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).buffer;
    expect((await f.send({ method: "POST", path: "/api/notes", body: JSON.stringify({ path: "Recipes/Stew", content }) })).status).toBe(413);
    const made = await f.send({ method: "POST", path: "/api/notes", bytes: bytes({ path: "Recipes/Stew", content }) });
    expect(made.status).toBe(201);
    expect(notes.find((n) => n.path === "Recipes/Stew")?.content).toBe(content);
    const changed = await f.send({ method: "PATCH", path: `/api/notes/${made.body.id}`, bytes: bytes({ content: content + "More.", if_updated_at: "2026-11-15" }) });
    expect(changed.status).toBe(200);
    // the same scope as any write
    expect((await f.send({ method: "POST", path: "/api/notes", bytes: bytes({ path: "Journal/Stew", content }) })).status).toBe(403);
    // not both, not past the cap, and text
    expect((await f.send({ method: "POST", path: "/api/notes", body: "{}", bytes: bytes({ path: "Recipes/X", content: "x" }) })).status).toBe(400);
    expect((await f.send({ method: "POST", path: "/api/notes", bytes: new ArrayBuffer(LIMITS.maxWriteBytes + 1) })).status).toBe(413);
    expect((await f.send({ method: "POST", path: "/api/notes", bytes: new Uint8Array([0xff, 0xfe]).buffer })).status).toBe(400);
    expect(notes.some((n) => n.path === "Recipes/X")).toBe(false);
    // only a write carries a body
    expect((await f.send({ method: "GET", path: "/api/notes", bytes: bytes({}) })).status).toBe(400);
  });
});

describe("vault.file: a picture attached to a record in the applet's folders, and nothing else (docs/design/PICTURES.md)", () => {
  const OWL = "2026-11-23/1763-owl.png", DIARY = "2026-11-23/1764-diary.png", TOUR = "2026-11-23/1765-tour.mp4";
  // Recipes/Toast has the owl and a video; Journal/Secret (outside the folders) has the diary photo, and the owl too
  const ATTACHED: Record<string, { path: string; mimeType: string }[]> = {
    r1: [{ path: OWL, mimeType: "image/png" }, { path: TOUR, mimeType: "video/mp4" }],
    j1: [{ path: DIARY, mimeType: "image/png" }, { path: OWL, mimeType: "image/png" }],
  };
  const make = (o: { files?: boolean; big?: boolean; served?: string } = {}) => {
    const fetched: string[] = [], listed: string[] = [];
    const deps: VaultDeps = {
      ...vault,
      ...(o.files === false ? {} : {
        async attachments(id: string) { listed.push(id); return ATTACHED[id] ?? []; },
        async file(p: string) { fetched.push(p); return new NodeBlob([new Uint8Array(o.big ? 25 * 1024 * 1024 + 1 : 4)], { type: o.served ?? "image/png" }) as unknown as Blob; },
      }),
    };
    const router = createRouter([createVaultModule(deps)]);
    const call = (params: unknown, grant: Record<string, string[]> = { "vault.read": ["Recipes/"] }) =>
      router.call("vault", "file", params, grant, { charge() {}, closed: () => false }) as Promise<{ type: string; bytes: ArrayBuffer }>;
    return { call, fetched, listed };
  };
  it("hands over the bytes of a picture attached to a record in its folders, by id or path", async () => {
    const { call, fetched } = make();
    const got = await call({ id: "r1", path: `/api/storage/${OWL}` });
    expect(got.type).toBe("image/png");
    expect(got.bytes.byteLength).toBe(4);
    expect((await call({ id: "Recipes/Toast", path: OWL })).type).toBe("image/png");
    expect(fetched).toEqual([OWL, OWL]);
  });
  it("refuses a record outside its folders, said as a record it can't find, and reads nothing of it", async () => {
    const { call, fetched, listed } = make();
    const outside = await call({ id: "j1", path: `/api/storage/${DIARY}` }).catch((e) => e);
    const missing = await call({ id: "nosuch", path: `/api/storage/${DIARY}` }).catch((e) => e);
    expect(outside).toMatchObject({ code: "out_of_scope" });
    // the same words for both: it can't learn that the record is there
    expect(String(outside.message)).toBe(String(missing.message));
    // the owl is attached to Journal/Secret too, but asked for through that record it is still refused
    await expect(call({ id: "Journal/Secret", path: `/api/storage/${OWL}` })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(fetched).toEqual([]);
    expect(listed).toEqual([]);
  });
  it("refuses a file not in the record's list: another record's, one attached to nothing", async () => {
    const { call, fetched } = make();
    await expect(call({ id: "r1", path: `/api/storage/${DIARY}` })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(call({ id: "r1", path: "/api/storage/2026-11-23/nobody.png" })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(fetched).toEqual([]);
  });
  it("refuses path tricks: a way out of storage, an encoded one, a query, another host, a record named by a dot path", async () => {
    const { call, fetched, listed } = make();
    for (const path of [`/api/storage/2026-11-23/../../${DIARY}`, "/api/storage/2026-11-23%2F..%2F..%2Fsecrets", `/api/storage/${OWL}?x=1`, `/api/storage/${OWL}#f`,
      `/api/storage/2026-11-23\\1763-owl.png`, `https://elsewhere.example/api/storage/${OWL}`, `//elsewhere.example/api/storage/${OWL}`, `/api/storage/%2e%2e/${OWL}`, "/api/storage/" + "a/".repeat(300) + "b.png"]) {
      await expect(call({ id: "r1", path }), path).rejects.toMatchObject({ code: "out_of_scope" });
    }
    for (const id of ["Recipes/../Journal/Secret", "../Journal/Secret", "Recipes/./Toast", "Recipes\\..\\Journal"]) {
      await expect(call({ id, path: `/api/storage/${OWL}` }), id).rejects.toMatchObject({ code: "bad_params" });
    }
    await expect(call({ id: "r1", path: `/api/storage/${OWL}`, vault: "elsewhere" })).rejects.toMatchObject({ code: "bad_params" });
    expect(fetched).toEqual([]);
    expect(listed).toEqual([]);
  });
  it("needs vault.read; a screen whose shell hands over no files hands none", async () => {
    await expect(make().call({ id: "r1", path: `/api/storage/${OWL}` }, {})).rejects.toMatchObject({ code: "not_granted" });
    await expect(make({ files: false }).call({ id: "r1", path: `/api/storage/${OWL}` })).rejects.toMatchObject({ code: "not_granted" });
  });
  it("hands over a picture only (a video is refused before it is read, a file the hub serves as anything else after), 25 MB at most", async () => {
    const { call, fetched } = make();
    await expect(call({ id: "r1", path: `/api/storage/${TOUR}` })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(fetched).toEqual([]);
    await expect(make({ served: "text/html" }).call({ id: "r1", path: `/api/storage/${OWL}` })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(make({ big: true }).call({ id: "r1", path: `/api/storage/${OWL}` })).rejects.toMatchObject({ code: "too_large" });
  });
  it("costs read budget each call, even when the record and its list are kept", async () => {
    let spent = 0;
    const router = createRouter([createVaultModule({ ...vault, attachments: async (id) => ATTACHED[id] ?? [], file: async () => new NodeBlob([new Uint8Array(4)], { type: "image/png" }) as unknown as Blob })]);
    const charged = () => router.call("vault", "file", { id: "r1", path: OWL }, { "vault.read": ["Recipes/"] }, { charge(n: number) { spent += n; }, closed: () => false });
    await charged();
    const first = spent;
    await charged();
    expect(spent - first).toBeGreaterThanOrEqual(1);
    expect(first).toBe(3);
  });
  it("a note's pictures ask for the record's list once", async () => {
    const { call, listed } = make();
    await Promise.all([call({ id: "r1", path: `/api/storage/${OWL}` }), call({ id: "r1", path: `/api/storage/${OWL}` })]);
    await expect(call({ id: "r1", path: `/api/storage/${DIARY}` })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(listed).toEqual(["r1"]);
  });
  it("hands over short pronunciation audio (webm/ogg/mp3/mp4) up to 512 KB when magic bytes match, and refuses spoofed or oversized audio", async () => {
    const CLIP = "2026-11-23/1766-word.webm", OGG = "2026-11-23/1767-word.ogg", SPOOF = "2026-11-23/1768-fake.webm";
    const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
    const OGG_BYTES = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
    const FAKE_BYTES = new TextEncoder().encode("<html>nope</html>");
    const mkAudio = (data: Uint8Array, served: string) => {
      const router = createRouter([createVaultModule({
        ...vault,
        attachments: async () => [{ path: CLIP, mimeType: "audio/webm" }, { path: OGG, mimeType: "audio/ogg" }, { path: SPOOF, mimeType: "audio/webm" }],
        file: async () => new NodeBlob([data], { type: served }) as unknown as Blob,
      })]);
      return (path: string) => router.call("vault", "file", { id: "r1", path }, { "vault.read": ["Recipes/"] }, { charge() {}, closed: () => false }) as Promise<{ type: string; bytes: ArrayBuffer }>;
    };
    expect((await mkAudio(WEBM_BYTES, "audio/webm")(`/api/storage/${CLIP}`)).type).toBe("audio/webm");
    expect((await mkAudio(OGG_BYTES, "audio/ogg")(`/api/storage/${OGG}`)).type).toBe("audio/ogg");
    // HTML disguised as audio/webm is refused by magic-byte check
    await expect(mkAudio(FAKE_BYTES, "audio/webm")(`/api/storage/${SPOOF}`)).rejects.toMatchObject({ code: "out_of_scope" });
    // Audio over 512 KB is refused (a voice memo is longer than a word needs)
    const big = new Uint8Array(512 * 1024 + 4);
    big.set([0x1a, 0x45, 0xdf, 0xa3]);
    await expect(mkAudio(big, "audio/webm")(`/api/storage/${CLIP}`)).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("vault.attachFrom: a picture attached to a record it reads, attached to one it may change too (WEB.md §5)", () => {
  const OWL = "2026-11-23/1763-owl.png", DIARY = "2026-11-23/1764-diary.png";
  const make = () => {
    notes.push({ id: "r2", path: "Recipes/Soup", content: "soup", tags: ["recipe"], updatedAt: "2026-11-04" });
    const attached: Record<string, { id: string; path: string; mimeType: string }[]> = { r1: [{ id: "att1", path: OWL, mimeType: "image/png" }, { id: "att7", path: "2026-11-23/1766-contract.pdf", mimeType: "application/pdf" }, { id: "att8", path: "2026-11-23/1767-contract.pdf", mimeType: "image/png" }], j1: [{ id: "att2", path: DIARY, mimeType: "image/png" }] };
    const added: [string, string, string][] = [];
    const deps: VaultDeps = {
      ...vault,
      async attachments(id) { return (attached[id] ?? []).map((a) => ({ ...a })); },
      async file() { return new NodeBlob([new Uint8Array(4)], { type: "image/png" }) as unknown as Blob; },
      async attachPath(id, path, mimeType) { added.push([id, path, mimeType]); const a = { id: `att${added.length + 2}`, path, mimeType }; (attached[id] ??= []).push(a); return a; },
    };
    const router = createRouter([createVaultModule(deps)]);
    const grant = { "vault.read": ["Recipes/"], "vault.update": ["Recipes/"] };
    const ctx = { charge() {}, closed: () => false };
    return {
      added,
      attachFrom: (params: unknown, g: Record<string, string[]> = grant) => router.call("vault", "attachFrom", params, g, ctx) as Promise<{ id: string | null; path: string; type: string }>,
      file: (params: unknown) => router.call("vault", "file", params, grant, ctx) as Promise<{ type: string }>,
    };
  };
  it("attaches the same stored file to the second record, once, and the second record then draws it", async () => {
    const { attachFrom, file, added } = make();
    // read first (its list is kept a moment), then attached: the new attachment is seen at once
    await expect(file({ id: "r2", path: `/api/storage/${OWL}` })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(await attachFrom({ noteId: "r2", from: "r1", path: `/api/storage/${OWL}` })).toMatchObject({ path: OWL, type: "image/png" });
    expect((await file({ id: "r2", path: `/api/storage/${OWL}` })).type).toBe("image/png");
    // again: already there, nothing more attached
    await attachFrom({ noteId: "Recipes/Soup", from: "Recipes/Toast", path: OWL });
    expect(added).toEqual([["r2", OWL, "image/png"]]);
  });
  it("never attaches a file it couldn't name: one on a record outside its folders, or not on `from` at all", async () => {
    const { attachFrom, added } = make();
    const outside = await attachFrom({ noteId: "r2", from: "j1", path: `/api/storage/${DIARY}` }).catch((e) => e);
    const missing = await attachFrom({ noteId: "r2", from: "nosuch", path: `/api/storage/${DIARY}` }).catch((e) => e);
    expect(outside).toMatchObject({ code: "out_of_scope" });
    expect(String(outside.message)).toBe(String(missing.message));
    await expect(attachFrom({ noteId: "r2", from: "r1", path: `/api/storage/${DIARY}` })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(attachFrom({ noteId: "r2", from: "r1", path: "/api/storage/2026-11-23/nobody.png" })).rejects.toMatchObject({ code: "out_of_scope" });
    // pictures only: a document it can't read itself is never carried to a record others may see (nor one listed as a
    // picture whose name says it isn't: the hub serves it by its name)
    await expect(attachFrom({ noteId: "r2", from: "r1", path: "/api/storage/2026-11-23/1766-contract.pdf" })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(attachFrom({ noteId: "r2", from: "r1", path: "/api/storage/2026-11-23/1767-contract.pdf" })).rejects.toMatchObject({ code: "out_of_scope" });
    // a file it can read, but read through only `vault.update`: not without vault.read on `from`
    await expect(attachFrom({ noteId: "r2", from: "r1", path: OWL }, { "vault.update": ["Recipes/"] })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(added).toEqual([]);
  });
  it("attaches only to a record it may change, never to code or outside its folders", async () => {
    const { attachFrom, added } = make();
    await expect(attachFrom({ noteId: "j1", from: "r1", path: OWL })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(attachFrom({ noteId: "a2", from: "r1", path: OWL })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(attachFrom({ noteId: "r2", from: "r1", path: OWL }, { "vault.read": ["Recipes/"] })).rejects.toMatchObject({ code: "not_granted" });
    expect(added).toEqual([]);
  });
  it("refuses path and id tricks", async () => {
    const { attachFrom, added } = make();
    for (const path of [`/api/storage/2026-11-23/../${OWL}`, "/api/storage/2026-11-23%2F..%2Fx.png", `/api/storage/${OWL}?x`, `https://elsewhere.example/api/storage/${OWL}`]) {
      await expect(attachFrom({ noteId: "r2", from: "r1", path }), path).rejects.toMatchObject({ code: "out_of_scope" });
    }
    for (const [noteId, from] of [["Recipes/../Journal/Secret", "r1"], ["r2", "Recipes/../Journal/Secret"]]) {
      await expect(attachFrom({ noteId, from, path: OWL })).rejects.toMatchObject({ code: "bad_params" });
    }
    expect(added).toEqual([]);
  });
});

describe("vault.upload: a file the person picked on this screen, carried onto a record it may change (UPLOADS.md)", () => {
  const picked = { name: "Walden.epub", type: "application/epub+zip", size: 20, file: new File(["x"], "Walden.epub") };
  const make = (o: { upload?: boolean; files?: boolean; closed?: () => boolean } = {}) => {
    const calls: [string, string][] = [], events: [string, unknown][] = [];
    const deps: VaultDeps = {
      ...vault,
      ...(o.upload === false ? {} : {
        async upload(id: string, f: { name: string }, progress: (p: { sent: number; size: number }) => void) {
          calls.push([id, f.name]); progress({ sent: 10, size: 20 }); progress({ sent: 20, size: 20 });
          if (f.name === "fails.epub") throw new Error("piece 1 of 1: down");
          return { name: f.name, type: "application/epub+zip", size: 20, parts: [{ path: "2026-11-24/1-Walden.epub", size: 20, sha256: "ab", id: "att1" }] };
        },
      }),
    };
    const chosen: Record<string, typeof picked> = { f1: picked, f2: { ...picked, name: "fails.epub" } };
    const router = createRouter([createVaultModule(deps, { ...(o.files === false ? {} : { files: (h: string) => chosen[h] }), emit: (e, d) => events.push([e, d]) })]);
    const grant = { "vault.read": ["Recipes/"], "vault.update": ["Recipes/"] };
    const ctx = { charge() {}, closed: o.closed ?? (() => false) };
    return { calls, events, upload: (params: unknown, g: Record<string, string[]> = grant) => router.call("vault", "upload", params, g, ctx) as Promise<{ parts: unknown[] }> };
  };
  it("carries the picked file onto a record in its folders, its progress named by the call's id", async () => {
    const { upload, calls, events } = make();
    expect((await upload({ noteId: "Recipes/Toast", file: "f1", id: "u1" })).parts).toHaveLength(1);
    expect(calls).toEqual([["r1", "Walden.epub"]]);
    expect(events).toEqual([["vault.upload", { id: "u1", sent: 10, size: 20 }], ["vault.upload", { id: "u1", sent: 20, size: 20 }]]);
  });
  it("carries only a file picked on this screen, onto only a record it may change", async () => {
    const { upload, calls } = make();
    await expect(upload({ noteId: "r1", file: "f9" })).rejects.toMatchObject({ code: "out_of_scope" });
    for (const file of ["../f1", "x", 3, ""]) await expect(upload({ noteId: "r1", file }), String(file)).rejects.toMatchObject({ code: "bad_params" });
    await expect(upload({ noteId: "r1", file: "f1", id: "<script>" })).rejects.toMatchObject({ code: "bad_params" });
    await expect(upload({ noteId: "r1", file: "f1", bytes: new ArrayBuffer(2) })).rejects.toMatchObject({ code: "bad_params" });
    await expect(upload({ noteId: "j1", file: "f1" })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(upload({ noteId: "a2", file: "f1" })).rejects.toMatchObject({ code: "out_of_scope" });
    await expect(upload({ noteId: "r1", file: "f1" }, { "vault.read": ["Recipes/"] })).rejects.toMatchObject({ code: "not_granted" });
    await expect(make({ upload: false }).upload({ noteId: "r1", file: "f1" })).rejects.toMatchObject({ code: "not_granted" });
    await expect(make({ files: false }).upload({ noteId: "r1", file: "f1" })).rejects.toMatchObject({ code: "not_granted" });
    expect(calls).toEqual([]);
  });
  it("says why an upload stopped, and tells a closed screen nothing", async () => {
    const { upload } = make();
    await expect(upload({ noteId: "r1", file: "f2" })).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("piece 1 of 1: down") });
    let closed = false;
    const late = make({ closed: () => closed });
    const p = late.upload({ noteId: "r1", file: "f1", id: "u2" });
    closed = true;
    await p.catch(() => {});
    expect(late.events).toEqual([]);
  });
});

describe("an applet granted only to add, in one folder (Home's line into Inbox/)", () => {
  const home = (() => { const r = parseManifest((homeRecord as { fields: { applet: unknown } }).fields.applet); if (!r.ok) throw new Error(r.error); return r.manifest; })();
  it("adds a record there", async () => {
    const r = await frame(resolvedOf(home)).fetch("POST", "/api/notes", { path: "Inbox/Call the plumber", content: "Call the plumber" });
    expect(r.status).toBe(201);
    expect(created.map((c) => c.path)).toEqual(["Inbox/Call the plumber"]);
  });
  it("reads nothing, not even the vault's name, and adds nowhere else", async () => {
    const f = frame(resolvedOf(home));
    for (const p of ["/api/vault", "/api/notes?path_prefix=Inbox/", "/api/notes/r1", "/api/tags"]) expect((await f.fetch("GET", p)).status, p).toBe(403);
    expect((await f.fetch("POST", "/api/notes", { path: "Recipes/Soup", content: "x" })).status).toBe(403);
    expect((await f.fetch("PATCH", "/api/notes/r1", { if_updated_at: "2026-11-02", content: "x" })).status).toBe(403);
    expect(created).toEqual([]);
  });
});
