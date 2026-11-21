// The shell's side of the bridge, played against as a hostile frame would: every call, every shape, and nothing it
// answers carries a token, a client id or a grant; a move it asks for starts nothing without a tap.
import type { Note } from "@openparachute/surface-client";
import { describe, expect, it, vi } from "vitest";
import { createFrameHost, FRAME_LIMITS, type HostDeps } from "./frameBridge";
import { METHODS, PF } from "../bridge/protocol";
import type { VaultRecord } from "../vault/store";

const REC: VaultRecord = { key: "kitchen", issuer: "https://hub.example", vault: "kitchen", tokenEndpoint: "https://hub.example/oauth/token", clientId: "CLIENT-ID-SECRET",
  accessToken: "ACCESS-TOKEN-SECRET", refreshToken: "REFRESH-TOKEN-SECRET", scope: "vault:kitchen:read", addedAt: "2026-11-15" };
const SECRETS = /ACCESS-TOKEN-SECRET|REFRESH-TOKEN-SECRET|CLIENT-ID-SECRET/;

function setup(tap = false) {
  const posts: unknown[] = [];
  const deps = {
    vaults: () => [REC],
    // a client that would leak its record if anything handed it on
    client: () => ({ queryNotes: async () => [{ id: "n1", path: "Recipes/Soup", tags: [] }], getNote: async (id: string) => (id === "gone" ? Promise.reject(Object.assign(new Error("x"), { status: 404 })) : { id, path: id, tags: [] }) }) as unknown as ReturnType<HostDeps["client"]>,
    // as vault/client.ts keptReaderFor: each read through it noted, as onFresh names it
    kept: () => { const reads = new Set<string>(); return { reads, client: { getNote: async (id: string) => { reads.add(`/vault/kitchen/api/records?id=${id}&include_body=true`); return { id, path: id, tags: [], kept: true } as unknown as Note; } } }; },
    roles: async () => ["pinned"],
    applets: async () => ({ ok: true as const, skipped: 0, entries: [] }),
    defaults: { get: vi.fn(() => ({ recipe: "vault" })), set: vi.fn() },
    home: { get: vi.fn(() => ({ start: null, bar: [{ vault: "kitchen", noteId: "a1" }] })), pin: vi.fn(async () => {}), start: vi.fn(async () => {}), bringIn: vi.fn(async () => {}), addEmbed: vi.fn(async () => "added" as const), addVault: vi.fn(async () => {}), dismissVault: vi.fn() },
    pointers: async () => [],
    components: async () => ({ ok: true as const, entries: [] }),
    go: vi.fn(), back: vi.fn(), decide: vi.fn(), here: () => "/v/kitchen/n/n1",
    tapNow: () => tap,
    mark: { tap: vi.fn(), carry: vi.fn(() => true), clear: vi.fn() },
    copy: vi.fn(async () => true), openOut: vi.fn(async () => true),
    message: (e: unknown) => (e instanceof Error ? e.message : "failed"),
    now: () => 0,
  } satisfies HostDeps;
  const host = createFrameHost((m) => posts.push(m), deps);
  const ask = async (method: string, params?: unknown) => { const id = `t${posts.length}-${Math.random()}`; host.handle({ pf: PF, id, method, params }); await new Promise((r) => setTimeout(r, 0)); return posts.find((p) => (p as { id: string }).id === id) as { result?: unknown; error?: string } | undefined; };
  return { posts, deps, ask, host };
}

const PARAMS: Record<string, unknown> = {
  "vaults.list": {}, "vault.query": { vault: "kitchen", query: { search: "soup", limit: 5, includeContent: true } }, "vault.note": { vault: "kitchen", id: "n1" },
  "vault.roles": { vault: "kitchen" }, "applets.list": { vault: "kitchen", fresh: true }, "defaults.get": { vault: "kitchen" },
  "defaults.set": { vault: "kitchen", type: "recipe", choice: null }, "nav.go": { to: "/v/kitchen" }, "nav.back": {}, "nav.decided": { key: "abc", kind: "vault" },
  "clipboard.write": { text: "x" }, "link.out": { url: "https://example.com" },
  "home.get": {}, "home.pin": { vault: "kitchen", noteId: "a1", on: true }, "home.start": { vault: "kitchen", noteId: null },
  "pointers.list": {}, "home.bringIn": { vault: "kitchen", noteId: "a1" }, "components.list": { vault: "kitchen" }, "home.addEmbed": { vault: "kitchen", noteId: "c1" },
  "home.addVault": { hub: "https://hub.example", vault: "playground" }, "home.dismissVault": { hub: "https://hub.example", vault: "playground" },
};
const TAP_ONLY = ["defaults.set", "home.pin", "home.start", "home.bringIn", "home.addEmbed", "home.addVault", "home.dismissVault"];

describe("a frame's calls", () => {
  it("every call answers without a token, a client id or a refresh token", async () => {
    for (const tap of [false, true]) {
      const { ask, posts } = setup(tap);
      // without a tap, keeping a choice is refused (the person makes it in the sheet, by a tap)
      for (const m of METHODS) expect((await ask(m, PARAMS[m]))?.error, m).toBe(!tap && TAP_ONLY.includes(m) ? "not_allowed" : undefined);
      expect(posts).toHaveLength(METHODS.length);
      expect(JSON.stringify(posts)).not.toMatch(SECRETS);
    }
  });
  it("the vaults it is told of are names and hubs only", async () => {
    const { ask } = setup();
    expect((await ask("vaults.list"))?.result).toEqual([{ key: "kitchen", vault: "kitchen", host: "hub.example", issuer: "https://hub.example", hub: "https://hub.example", url: "https://hub.example/vault/kitchen" }]);
  });
  it("a method that isn't in the table is refused: there is no call that grants, reads a token or writes a note", async () => {
    const { ask } = setup(true);
    for (const m of ["grants.grant", "applets.allow", "vault.token", "vault.create", "vault.update", "storage.get", "toString", "__proto__", "constructor"]) {
      expect((await ask(m, {}))?.error).toBe("unknown_method");
    }
  });
  it("a wrong shape is refused before anything runs", async () => {
    const { ask, deps } = setup(true);
    expect((await ask("vault.query", { vault: "kitchen", query: { search: "x", method: "DELETE" } }))?.error).toBe("bad_params");
    expect((await ask("vault.query", { vault: "kitchen", query: { limit: 10_000 } }))?.error).toBe("bad_params");
    expect((await ask("defaults.set", { vault: "kitchen", type: "recipe", choice: 7 }))?.error).toBe("bad_params");
    expect((await ask("nav.go", { to: "/v/kitchen", extra: 1 }))?.error).toBe("bad_params");
    expect((await ask("vaults.list", JSON.parse('{"__proto__": {"x": 1}}')))?.error).toBe("bad_params");
    expect(deps.go).not.toHaveBeenCalled();
    expect(deps.defaults.set).not.toHaveBeenCalled();
  });
  it("a vault this device doesn't hold is no one's to read", async () => {
    const { ask } = setup();
    expect((await ask("vault.note", { vault: "journal", id: "n1" }))?.error).toContain("doesn't hold");
    expect((await ask("defaults.get", { vault: "journal" }))?.error).toContain("doesn't hold");
  });
  it("junk with no id gets no answer at all", async () => {
    const { host, posts } = setup();
    for (const d of [null, 1, "x", { pf: 2, id: "a", method: "vaults.list" }, { pf: PF, method: "vaults.list" }]) host.handle(d);
    await new Promise((r) => setTimeout(r, 0));
    expect(posts).toHaveLength(0);
  });
});

describe("moving the person", () => {
  it.each(["/", "/settings", "/add", "/v/kitchen", "/v/kitchen/n/01AB", "/v/kitchen/a/01AB?note=x&screen=home"])("may send them to %s", async (to) => {
    const { ask, deps } = setup();
    expect((await ask("nav.go", { to }))?.error).toBeUndefined();
    expect(deps.go).toHaveBeenCalledWith(to, false);
  });
  it.each(["/oauth/callback?code=x&state=y", "/open-link?url=x", "https://evil.example/", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "/v/kitchen/n/a/b"])("never to %s", async (to) => {
    const { ask, deps } = setup(true);
    expect((await ask("nav.go", { to }))?.error).toBe("not_allowed");
    expect(deps.go).not.toHaveBeenCalled();
  });
  it("a move during the person's tap marks where it leads; one without a tap drops any mark", async () => {
    const tapped = setup(true);
    await tapped.ask("nav.go", { to: "/v/kitchen/a/01AB?note=x" });
    expect(tapped.deps.mark.tap).toHaveBeenCalledWith("/v/kitchen/a/01AB");
    const scripted = setup(false);
    await scripted.ask("nav.go", { to: "/v/kitchen/a/01AB?note=x" });
    expect(scripted.deps.mark.tap).not.toHaveBeenCalled();
    expect(scripted.deps.mark.clear).toHaveBeenCalled();
  });
  it("the note's route carries a tap on, from where it led to the applet", async () => {
    const { ask, deps } = setup(false);
    await ask("nav.go", { to: "/v/kitchen/a/01AB?note=n1", replace: true, carryFrom: "/v/kitchen/n/n1" });
    expect(deps.mark.carry).toHaveBeenCalledWith("/v/kitchen/n/n1", "/v/kitchen/a/01AB");
    expect(deps.go).toHaveBeenCalledWith("/v/kitchen/a/01AB?note=n1", true);
  });
  it("a carry from anywhere but where the person is now is refused", async () => {
    const { ask, deps } = setup(false);
    expect((await ask("nav.go", { to: "/v/kitchen/a/01AB?note=n2", replace: true, carryFrom: "/v/kitchen/n/n2" }))?.error).toBe("not_allowed");
    expect(deps.go).not.toHaveBeenCalled();
  });
  it("copying and opening a link out happen only during a tap, and only for a web address", async () => {
    const still = setup(false);
    expect((await still.ask("clipboard.write", { text: "x" }))?.result).toBe(false);
    expect((await still.ask("link.out", { url: "https://example.com" }))?.result).toBe(false);
    expect(still.deps.copy).not.toHaveBeenCalled();
    expect(still.deps.openOut).not.toHaveBeenCalled();
    const tap = setup(true);
    expect((await tap.ask("link.out", { url: "javascript:alert(1)" }))?.result).toBe(false);
    expect((await tap.ask("link.out", { url: "file:///etc/passwd" }))?.result).toBe(false);
    expect((await tap.ask("link.out", { url: "https://example.com" }))?.result).toBe(true);
    expect((await tap.ask("link.out", { url: "mailto:someone@example.com" }))?.result).toBe(true);
    expect(tap.deps.openOut).toHaveBeenCalledWith("https://example.com");
  });
});

describe("how much a frame may ask", () => {
  it("past the window's share, a call is refused and nothing runs", async () => {
    const { host, posts, deps } = setup(true);
    // one at a time, so only the window counts
    for (let i = 0; i < FRAME_LIMITS.perWindow + 5; i++) { host.handle({ pf: PF, id: `n${i}`, method: "nav.back", params: {} }); await new Promise((r) => setTimeout(r, 0)); }
    expect(deps.back).toHaveBeenCalledTimes(FRAME_LIMITS.perWindow);
    expect(posts.filter((p) => (p as { error?: string }).error === "rate_limited")).toHaveLength(5);
  });
  it("past the calls waiting at once, a call is refused", async () => {
    const { host, posts } = setup(true);
    for (let i = 0; i < FRAME_LIMITS.pending + 3; i++) host.handle({ pf: PF, id: `p${i}`, method: "vaults.list", params: {} });
    expect(posts.filter((p) => (p as { error?: string }).error === "rate_limited")).toHaveLength(3);
  });
});

describe("the bar and the home", () => {
  it("pinning and choosing a home write the person's settings only during a tap, and only for a vault this device holds", async () => {
    const off = setup(false);
    expect((await off.ask("home.pin", { vault: "kitchen", noteId: "a1", on: true }))?.error).toBe("not_allowed");
    expect((await off.ask("home.start", { vault: "kitchen", noteId: "a1" }))?.error).toBe("not_allowed");
    expect(off.deps.home.pin).not.toHaveBeenCalled();
    expect(off.deps.home.start).not.toHaveBeenCalled();
    const on = setup(true);
    expect((await on.ask("home.pin", { vault: "elsewhere", noteId: "a1", on: true }))?.error).toBe("This device doesn't hold that vault.");
    expect((await on.ask("home.start", { vault: "kitchen", noteId: "a1", extra: 1 }))?.error).toBe("bad_params");
    expect((await on.ask("home.pin", { vault: "kitchen", noteId: "a1", on: "yes" }))?.error).toBe("bad_params");
    expect((await on.ask("home.pin", { vault: "kitchen", noteId: "a1", on: false }))?.error).toBeUndefined();
    expect(on.deps.home.pin).toHaveBeenCalledWith("kitchen", "a1", false);
    expect((await on.ask("home.start", { vault: "kitchen", noteId: null }))?.error).toBeUndefined();
    expect(on.deps.home.start).toHaveBeenCalledWith("kitchen", null);
  });
});

describe("a note read from the copy", () => {
  it("is answered from the copy, and the frame is told when the hub's answer differs: only for a note it read that way", async () => {
    const { ask, host, posts } = setup(false);
    expect((await ask("vault.note", { vault: "kitchen", id: "n1", kept: true }))?.result).toMatchObject({ id: "n1", kept: true });
    expect((await ask("vault.note", { vault: "kitchen", id: "n2" }))?.result).not.toHaveProperty("kept");
    expect((await ask("vault.note", { vault: "kitchen", id: "n1", kept: "yes" }))?.error).toBe("bad_params");
    const told = () => posts.filter((p) => (p as { event?: string }).event === "changed").map((p) => (p as { data: unknown }).data);
    host.fresh("kitchen", "/vault/kitchen/api/records?id=n2&include_body=true");
    host.fresh("pantry", "/vault/pantry/api/records?id=n1&include_body=true");
    host.fresh("kitchen", "/vault/kitchen/api/records?tag=applet");
    expect(told()).toEqual([]);
    host.fresh("kitchen", "/vault/kitchen/api/records?id=n1&include_body=true");
    expect(told()).toEqual([{ what: "note", vault: "kitchen", id: "n1" }]);
  });
});
