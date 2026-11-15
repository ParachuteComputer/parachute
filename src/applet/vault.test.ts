// The frame's way to the vault, end to end inside the app: a message from the frame → session → router → vault
// module → a vault (in memory here: the vault itself is outside this app). What these prove: a call the grant
// doesn't name never reaches the vault, and nothing outside the applet's folders comes back.
import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "./router";
import { createSession } from "./session";
import { createVaultModule, type VaultDeps, type VaultNote } from "./modules/vault";
import { createThemeModule } from "./modules/theme";
import { parseManifest } from "./manifest";
import { resolvedOf } from "./discovery";
import { RECIPES } from "./fixtures";
import type { HostMessage } from "./contract";

const manifest = (() => { const r = parseManifest(RECIPES); if (!r.ok) throw new Error(r.error); return r.manifest; })();
let notes: VaultNote[];
let created: { path: string; tags: string[] }[];
const vault: VaultDeps = {
  async listPaths() { return notes.map((n) => ({ id: n.id, path: n.path ?? null, extension: n.extension ?? "md", updatedAt: n.updatedAt })); },
  async getNote(ref) { const n = notes.find((x) => x.id === ref || x.path === ref); if (!n) throw new Error("missing"); return n; },
  // a search that ignores the folder asked for: the module must judge every hit itself
  async search(q, limit) { return notes.filter((n) => n.content?.includes(q)).slice(0, limit).map((n) => ({ id: n.id, path: n.path ?? null, snippet: "" })); },
  async create(path, content, tags) { if (notes.some((n) => n.path === path)) throw new Error("exists"); created.push({ path, tags }); const n = { id: `n${notes.length + 1}`, path, content, tags, updatedAt: "2026-11-15" }; notes.push(n); return n; },
  async save(id, content) { const n = notes.find((x) => x.id === id)!; n.content = content; return n; },
};
beforeEach(() => {
  created = [];
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
  it("can't set tags or metadata itself", async () => {
    expect((await frame().fetch("POST", "/api/notes", { path: "Recipes/Soup", content: "x", tags: ["applet"] })).status).toBe(400);
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
