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
import { LIMITS, type HostMessage } from "./contract";

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
    // a hub's answer: path_prefix case-blind, as core's lower() is
    async query(prefix, q) {
      asked.push({ prefix, q });
      const rows = notes.filter((n) => (n.path ?? "").toLowerCase().startsWith(prefix.toLowerCase()) && (!q.tag || (n.tags ?? []).includes(q.tag)));
      return rows.slice(q.offset, q.offset + q.limit).map((n) => (q.links ? withLinks(n) : n));
    },
  };
  function frameOn(deps: VaultDeps, grant = resolvedOf(manifest)) {
    const out: HostMessage[] = [];
    const router = createRouter([createVaultModule(deps, { opens: [{ type: "recipe", path: "Recipes/" }] })]);
    const s = createSession({ post: (m) => out.push(m), router, grant });
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
    expect(asked[0].q).toMatchObject({ orderBy: "serves", sort: "asc", offset: 1, limit: 10, meta: [["meta[serves][gte]", "2"], ["meta[course]", "soup"]] });
    // the hub (case-blind) answered recipes/Hidden too: not in the folder, so not shown
    const all = await f.get("/api/notes?sort=desc");
    expect(all.body.map((n: { path: string }) => n.path)).not.toContain("recipes/Hidden");
    expect(all.body.map((n: { path: string }) => n.path)).toEqual(expect.arrayContaining(["Recipes/Toast", "Recipes/Soup"]));
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
  });
});
