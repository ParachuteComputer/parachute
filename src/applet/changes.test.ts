// Changes (T-476): reading what changed from the hub's history, and putting a change back. What it may never put back
// (code, the app's own records), what asks the person first (what comes back published), and how a version becomes a
// change (version k is the record before write k; its after is version k+1 or the record now).
import { describe, expect, it } from "vitest";
import { createVaultsModule, type VaultsDeps } from "./modules/vaults";
import { createRouter } from "./router";
import { readChanges, writerName } from "./changes";

type Call = { method: string; path: string; body?: unknown };

/** A hub with records (by id), their versions (newest first) and deleted records. */
function hub(opts: { records?: Record<string, Record<string, unknown>>; versions?: Record<string, Record<string, unknown>[]>; deleted?: Record<string, unknown>[] | "refused"; yes?: boolean; self?: string }) {
  const calls: Call[] = [];
  const asked: string[] = [];
  const records = opts.records ?? {}, versions = opts.versions ?? {};
  const deps: VaultsDeps = {
    list: () => [{ key: "home", name: "home", host: "hub.example", mine: true, home: true, level: "write", connector: "https://hub.example/vault/home/mcp" }],
    door: async () => "records",
    applets: async () => [],
    self: () => opts.self ?? null,
    async request(_v, method, path, body) {
      calls.push({ method, path, body });
      if (path.startsWith("/types")) return [];
      if (path.startsWith("/history/deleted")) { if (opts.deleted === "refused") throw Object.assign(new Error("403 insufficient_scope"), { status: 403 }); return { notes: opts.deleted ?? [], total: 0 }; }
      const ver = /^\/records\/([^/?]+)\/versions\/(\d+)$/.exec(path);
      if (ver) { const v = (versions[ver[1]] ?? []).find((x) => x.version_ix === Number(ver[2])); if (!v) throw Object.assign(new Error("404 not found"), { status: 404 }); return v; }
      const list = /^\/records\/([^/?]+)\/versions/.exec(path);
      if (list) return { versions: versions[list[1]] ?? [], total: (versions[list[1]] ?? []).length };
      const one = /^\/records\/([^/?]+)/.exec(path);
      if (method === "GET" && one) { const r = records[decodeURIComponent(one[1])]; if (!r) throw Object.assign(new Error("404 not found"), { status: 404 }); return r; }
      if (method === "GET") return Object.values(records);
      return { id: "x", path: "X", types: [], tags: [], fields: {} };
    },
    watch: () => () => {},
    access: async () => ({ level: "write", mine: true, home: true, hub: "https://hub.example", connector: "", applets: [] }),
    revoke: async () => {}, readOnly: async () => {},
    confirm: async (q) => { asked.push(q.title); return (opts.yes ?? true) ? "yes" : "no"; },
    emit: () => {},
  };
  const router = createRouter([createVaultsModule(["vaults"], deps)]);
  const call = (method: string, params: unknown) => router.call("vaults", method, params, {}, { charge() {}, closed: () => false });
  return { call, calls, asked, deps };
}
const soup = { id: "S", path: "Recipes/Soup", body: "by the AI", types: ["recipe"], tags: [], fields: { serves: 4 }, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-21T09:05:00.000Z", createdVia: "api", lastUpdatedVia: "key:claude" };
const v0 = { version_ix: 0, op: "update", path: "Recipes/Soup", body: "first", fields: { serves: 2 }, superseded_at: "2026-11-21T09:05:00.000Z", via: "key:claude", via_kind: "person", actor: "u1" };

describe("putting a change back", () => {
  it("restores the version before it, to the record as it is now, and asks nothing of a private record", async () => {
    const { call, calls, asked } = hub({ records: { S: soup }, versions: { S: [v0] } });
    await call("restore", { vault: "home", id: "S", ix: 0, if_updated_at: soup.updatedAt });
    expect(calls.find((c) => c.method === "POST")).toEqual({ method: "POST", path: "/records/S/restore", body: { version_ix: 0, if_updated_at: soup.updatedAt } });
    expect(asked).toEqual([]);
  });
  it("a record changed since it was read is refused as a conflict, and nothing is restored", async () => {
    const { call, calls } = hub({ records: { S: soup }, versions: { S: [v0] } });
    await expect(call("restore", { vault: "home", id: "S", ix: 0, if_updated_at: "2026-11-21T09:00:00.000Z" })).rejects.toMatchObject({ message: expect.stringMatching(/conflict/) });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("a deleted record comes back from its tombstone with no if_updated_at; with one, it is a conflict", async () => {
    const tomb = { ...v0, op: "delete", version_ix: 1 };
    const { call, calls } = hub({ versions: { S: [tomb, v0] } });
    await call("restore", { vault: "home", id: "S", ix: 1 });
    expect(calls.find((c) => c.method === "POST")).toEqual({ method: "POST", path: "/records/S/restore", body: { version_ix: 1 } });
    await expect(hub({ versions: { S: [tomb, v0] } }).call("restore", { vault: "home", id: "S", ix: 1, if_updated_at: soup.updatedAt })).rejects.toMatchObject({ message: expect.stringMatching(/conflict/) });
  });
  it("never code, an applet's record or the app's own folders, live or deleted", async () => {
    const cases: [Record<string, Record<string, unknown>>, Record<string, unknown>][] = [
      [{ S: { ...soup, path: "Applets/Reading", extension: "tsx", tags: ["applet"] } }, { ...v0, path: "Applets/Reading", extension: "tsx" }],
      [{ S: { ...soup, tags: ["applet"] } }, v0],
      [{ S: { ...soup, path: "Parachute/Theme" } }, { ...v0, path: "Parachute/Theme" }],
      [{}, { ...v0, op: "delete", path: "Applets/Reading", extension: "html" }],
      [{}, { ...v0, op: "delete", path: ".parachute/keys" }],
    ];
    for (const [records, version] of cases) {
      const { call, calls } = hub({ records, versions: { S: [version] } });
      await expect(call("restore", { vault: "home", id: "S", ix: 0, ...(records.S ? { if_updated_at: soup.updatedAt } : {}) })).rejects.toMatchObject({ code: "out_of_scope" });
      expect(calls.some((c) => c.method === "POST")).toBe(false);
    }
  });
  it("what comes back published, or a change to a published record, asks the person first; a no restores nothing", async () => {
    const published = { ...v0, fields: { serves: 2, published: true } };
    const yes = hub({ records: { S: soup }, versions: { S: [published] } });
    await yes.call("restore", { vault: "home", id: "S", ix: 0, if_updated_at: soup.updatedAt });
    expect(yes.asked).toEqual(["Put back “Recipes/Soup”?"]);
    const no = hub({ records: { S: { ...soup, fields: { published: true } } }, versions: { S: [v0] }, yes: false });
    await expect(no.call("restore", { vault: "home", id: "S", ix: 0, if_updated_at: soup.updatedAt })).rejects.toMatchObject({ message: expect.stringMatching(/not_confirmed/) });
    expect(no.calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("taking away a record an AI made is a plain delete (its tombstone is kept), judged on it as it is now", async () => {
    const { call, calls } = hub({ records: { S: soup } });
    await call("remove", { vault: "home", id: "S", if_updated_at: soup.updatedAt });
    expect(calls.find((c) => c.method === "DELETE")).toEqual({ method: "DELETE", path: "/records/S", body: undefined });
    await expect(hub({ records: { S: soup } }).call("remove", { vault: "home", id: "S", if_updated_at: "2020-01-01T00:00:00.000Z" })).rejects.toMatchObject({ message: expect.stringMatching(/conflict/) });
    await expect(hub({ records: { S: { ...soup, tags: ["applet"] } } }).call("remove", { vault: "home", id: "S", if_updated_at: soup.updatedAt })).rejects.toMatchObject({ code: "out_of_scope" });
  });
  it("comparing never hands over an applet's code", async () => {
    const { call } = hub({ records: { S: { ...soup, path: "Applets/Reading", extension: "tsx" } }, versions: { S: [{ ...v0, path: "Applets/Reading", extension: "tsx" }] } });
    await expect(call("compare", { vault: "home", id: "S", before: 0, after: null })).rejects.toMatchObject({ code: "out_of_scope" });
  });
});

describe("reading what changed", () => {
  const get = (h: ReturnType<typeof hub>) => (p: string) => h.deps.request("home", "GET", p);
  const own = () => false;
  it("each kept version is a change by the key that made the next write; its after is the version above it, or now", async () => {
    const v1 = { ...v0, version_ix: 1, op: "restore", superseded_at: "2026-11-21T09:30:00.000Z", via: "key:0f8a6c2e-1111-4222-8333-944455556666" };
    const h = hub({ records: { S: soup }, versions: { S: [v1, v0] }, self: "0f8a6c2e-1111-4222-8333-944455556666" });
    const page = await readChanges({ get: get(h), door: "records", since: "2026-11-20T00:00:00.000Z", charge: () => {}, self: (via) => via === "key:0f8a6c2e-1111-4222-8333-944455556666", own });
    expect(page.changes.map((c) => [c.op, c.who, c.before, c.after])).toEqual([["restored", "You, in Parachute here", 1, null], ["changed", "claude", 0, 1]]);
    expect(page.deletes).toBe("shown");
  });
  it("a record made since is a change of its own; a record deleted since comes from the deleted list, its tombstone the change", async () => {
    const made = { ...soup, id: "N", path: "Inbox/New", createdAt: "2026-11-21T08:00:00.000Z", createdVia: "key:claude" };
    const tomb = { ...v0, version_ix: 0, op: "delete", path: "Recipes/Jam", superseded_at: "2026-11-21T09:10:00.000Z" };
    const h = hub({ records: { N: made }, versions: { J: [tomb] }, deleted: [{ id: "J", path: "Recipes/Jam", deleted_at: "2026-11-21T09:10:00.000Z", versions: 1 }] });
    const page = await readChanges({ get: get(h), door: "records", since: "2026-11-20T00:00:00.000Z", charge: () => {}, self: () => false, own });
    expect(page.changes.map((c) => [c.title, c.op, c.who, c.before, c.after, c.gone])).toEqual([["Jam", "deleted", "claude", 0, null, true], ["New", "created", "claude", null, null, false]]);
  });
  it("on a hub that lists deleted records only to its admin, deletes are said to be hidden, not left out silently", async () => {
    const h = hub({ records: { S: soup }, versions: { S: [v0] }, deleted: "refused" });
    expect((await readChanges({ get: get(h), door: "records", since: "2026-11-20T00:00:00.000Z", charge: () => {}, self: () => false, own })).deletes).toBe("hidden");
  });
  it("a writer reads as its key's name; an app the hub named for its client id, as an app", () => {
    expect(writerName("key:claude", false)).toBe("claude");
    expect(writerName("key:0f8a6c2e-1111-4222-8333-944455556666-2", false)).toBe("An app (0f8a6c2e)");
    expect(writerName("key:anything", true)).toBe("You, in Parachute here");
    expect(writerName(null, false)).toBe("Not recorded");
  });
});
