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
import type { HostMessage } from "./contract";

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


describe("notes no applet may change", () => {
  it("a bundle record, under its name and its older one: it picks what the app shows and pins (docs/design/APP-RECORD.md)", () => {
    for (const tag of ["parachute-bundle", "parachute-app"]) expect(isAppletCode({ id: "n", path: "Parachute/Bundles/uni", tags: [tag] } as VaultNote), tag).toBe(true);
    expect(isAppletCode({ id: "n", path: "Notes/a", tags: ["recipe"] } as VaultNote)).toBe(false);
  });
});
