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
    list: () => [{ key: "home", name: "home", host: "hub.example", mine: true, home: true, level: "write", connector: "https://hub.example/vault/home/mcp", view: null, reach: "this-device" }],
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
const soup = { id: "S", path: "Recipes/Soup", body: "by the AI", types: ["recipe"], tags: [], fields: { serves: 4 }, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-21T09:05:00.000Z", createdBy: "u1", createdVia: "api", lastUpdatedBy: "u1", lastUpdatedVia: "key:claude" };
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
    const { call, calls } = hub({ records: { S: soup }, versions: { S: [v0] } });
    await call("remove", { vault: "home", id: "S", if_updated_at: soup.updatedAt });
    expect(calls.find((c) => c.method === "DELETE")).toEqual({ method: "DELETE", path: "/records/S", body: undefined });
    await expect(hub({ records: { S: soup }, versions: { S: [v0] } }).call("remove", { vault: "home", id: "S", if_updated_at: "2020-01-01T00:00:00.000Z" })).rejects.toMatchObject({ message: expect.stringMatching(/conflict/) });
    await expect(hub({ records: { S: { ...soup, tags: ["applet"] } } }).call("remove", { vault: "home", id: "S", if_updated_at: soup.updatedAt })).rejects.toMatchObject({ code: "out_of_scope" });
  });
  it("comparing never hands over an applet's code", async () => {
    const { call } = hub({ records: { S: { ...soup, path: "Applets/Reading", extension: "tsx" } }, versions: { S: [{ ...v0, path: "Applets/Reading", extension: "tsx" }] } });
    await expect(call("compare", { vault: "home", id: "S", before: 0, after: null })).rejects.toMatchObject({ code: "out_of_scope" });
  });
});

describe("reading what changed", () => {
  const get = (h: ReturnType<typeof hub>) => (p: string) => h.deps.request("home", "GET", p);
  const own = () => null;
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

describe("what the review found (T-476 round 1)", () => {
  const get = (h: ReturnType<typeof hub>) => (p: string) => h.deps.request("home", "GET", p);
  it("a deleted record comes back at its tombstone's place: one deleted from the app's own folders isn't put back, whatever version is asked", async () => {
    const tomb = { ...v0, version_ix: 1, op: "delete", path: "Parachute/Approvals/x" };
    const { call, calls } = hub({ versions: { S: [tomb, { ...v0, path: "Recipes/Soup" }] } });
    await expect(call("restore", { vault: "home", id: "S", ix: 0 })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("a hub with no deleted list at all (404) shows edits, and says deletes are hidden", async () => {
    const h = hub({ records: { S: soup }, versions: { S: [v0] } });
    const orig = h.deps.request;
    h.deps.request = async (v, m, p, b) => { if (p.startsWith("/history/deleted")) throw Object.assign(new Error("404 not found"), { status: 404 }); return orig(v, m, p, b); };
    const page = await readChanges({ get: get(h), door: "records", since: "2026-11-20T00:00:00.000Z", charge: () => {}, self: () => false, own: () => null });
    expect(page.deletes).toBe("hidden");
    expect(page.changes).toHaveLength(1);
  });
  it("a deletion's after is nothing, and a put back that re-made it is marked: putting that back deletes it again", async () => {
    const tomb = { ...v0, version_ix: 1, op: "delete", superseded_at: "2026-11-21T09:10:00.000Z" };
    const marker = { ...v0, version_ix: 2, op: "restore", superseded_at: "2026-11-21T09:20:00.000Z", via: "key:me" };
    const h = hub({ records: { S: soup }, versions: { S: [marker, tomb, v0] } });
    const page = await readChanges({ get: get(h), door: "records", since: "2026-11-20T00:00:00.000Z", charge: () => {}, self: () => false, own: () => null });
    const by = Object.fromEntries(page.changes.map((c) => [c.op, c]));
    expect(by.deleted.after).toBeNull();
    expect(by.restored.recreated).toBe(true);
    expect(by.changed.after).toBe(1);
    expect(by.changed.seen).toBe(soup.updatedAt);
  });
  it("the app's own records show when another writer changed them (an AI editing an approval), but not this device's own keeping", async () => {
    const approval = { ...soup, id: "A", path: "Parachute/Approvals/x", tags: ["parachute-approval"] };
    const h = hub({ records: { A: approval }, versions: { A: [{ ...v0, path: "Parachute/Approvals/x" }, { ...v0, version_ix: 0, via: "key:me", superseded_at: "2026-11-21T09:00:00.000Z" }].map((x, i) => ({ ...x, version_ix: 1 - i })) } });
    const own = () => "app" as const;
    const page = await readChanges({ get: get(h), door: "records", since: "2026-11-20T00:00:00.000Z", charge: () => {}, self: (via) => via === "key:me", own });
    expect(page.changes.map((c) => [c.who, c.own])).toEqual([["claude", true]]);
  });
  it("a put back where another record now is says so, and isn't read as a change meanwhile", async () => {
    const h = hub({ versions: { S: [{ ...v0, op: "delete", version_ix: 1 }, v0] } });
    const orig = h.deps.request;
    h.deps.request = async (v, m, p, b) => { if (m === "POST") throw new Error("409 path_conflict: Recipes/Soup is taken"); return orig(v, m, p, b); };
    await expect(h.call("restore", { vault: "home", id: "S", ix: 1 })).rejects.toMatchObject({ message: expect.stringMatching(/^path_taken/) });
  });
  it("Home's count: another writer's records, not this device's and not the app's own keeping; the writer who wrote last first", async () => {
    const recs = {
      a: { id: "a", path: "Notes/a", lastUpdatedVia: "key:claude", updatedAt: "2026-11-21T09:00:00.000Z", tags: [] },
      b: { id: "b", path: "Notes/b", lastUpdatedVia: "key:notes-bot", updatedAt: "2026-11-21T09:30:00.000Z", tags: [] },
      c: { id: "c", path: "Notes/c", lastUpdatedVia: "key:me", updatedAt: "2026-11-21T09:40:00.000Z", tags: [] },
      d: { id: "d", path: "Parachute/Settings", lastUpdatedVia: "key:other-device", updatedAt: "2026-11-21T09:50:00.000Z", tags: ["parachute-settings"] },
    };
    const h = hub({ records: recs, deleted: [{ id: "g", path: "Notes/g", deleted_at: "2026-11-21T09:45:00.000Z" }], versions: { g: [{ ...v0, op: "delete", path: "Notes/g", superseded_at: "2026-11-21T09:45:00.000Z" }] } });
    const { countChanged } = await import("./changes");
    const r = await countChanged({ get: get(h), door: "records", since: "2026-11-21T00:00:00.000Z", charge: () => {}, self: (via) => via === "key:me", own: (x) => (x.path.startsWith("Parachute/") ? "app" : null) });
    expect(r.count).toBe(3);
    expect([...r.names].sort((x, y) => (x[1] < y[1] ? 1 : -1)).map(([n]) => n)).toEqual(["claude", "notes-bot"]);
  });
});

describe("remove takes away only what putting back takes away (T-476 round 2)", () => {
  it("never a record this device's Parachute made, nor one with no maker recorded; one a put back re-made, yes", async () => {
    const mine = hub({ records: { S: { ...soup, createdVia: "key:0f8a6c2e-1111-4222-8333-944455556666" } }, versions: { S: [v0] }, self: "0f8a6c2e-1111-4222-8333-944455556666" });
    await expect(mine.call("remove", { vault: "home", id: "S", if_updated_at: soup.updatedAt })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(mine.calls.some((c) => c.method === "DELETE")).toBe(false);
    const unknown = hub({ records: { S: { ...soup, createdVia: null } }, versions: { S: [v0] } });
    await expect(unknown.call("remove", { vault: "home", id: "S", if_updated_at: soup.updatedAt })).rejects.toMatchObject({ code: "out_of_scope" });
    const remade = hub({ records: { S: { ...soup, createdVia: "key:0f8a6c2e-1111-4222-8333-944455556666" } }, self: "0f8a6c2e-1111-4222-8333-944455556666",
      versions: { S: [{ ...v0, version_ix: 2, op: "restore" }, { ...v0, version_ix: 1, op: "delete" }, v0] } });
    await remade.call("remove", { vault: "home", id: "S", if_updated_at: soup.updatedAt });
    expect(remade.calls.some((c) => c.method === "DELETE")).toBe(true);
  });
  it("a vault that keeps no history: nothing is deleted, since nothing could bring it back", async () => {
    const h = hub({ records: { S: soup } });
    const orig = h.deps.request;
    h.deps.request = async (v, m, p, b) => { if (/\/versions/.test(p)) throw Object.assign(new Error("404 not found"), { status: 404 }); return orig(v, m, p, b); };
    await expect(h.call("remove", { vault: "home", id: "S", if_updated_at: soup.updatedAt })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(h.calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
