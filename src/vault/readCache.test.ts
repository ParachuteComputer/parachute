// The copies kept of vault reads (readCache.ts): a read answered at once from its copy while the hub is asked behind
// it; the hub's different answer replaces it and is told, once; a write makes the next reads the hub's; sign-out and a
// refused sign-in drop the vault's copies, and an answer on its way then isn't kept; another hub's vault of the same
// name never reads them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askAgain, dropAllKept, dropKept, keptFetch, markWritten, onFresh, REVALIDATE_MS } from "./readCache";

/** A hub in memory: what it answers now, and each request it got. */
function hub() {
  const h = { body: '[{"id":"a","content":"one"}]', status: 200, asked: [] as string[], hold: null as Promise<void> | null };
  const f: typeof fetch = async (input, init) => {
    h.asked.push(`${(init?.method ?? "GET").toUpperCase()} ${String(input)}`);
    if (h.hold) await h.hold;
    return new Response(h.body, { status: h.status, headers: { "content-type": "application/json" } });
  };
  return { h, f };
}
const URL_A = "https://hub.example/vault/home/api/notes?tag=journal";
const HUB = "https://hub.example";
const settle = () => new Promise((r) => setTimeout(r, 5));
const alive = async () => "alive" as const;

beforeEach(() => { dropAllKept(); vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => vi.useRealTimers());
/** Time passes: the hub may be asked behind a copy again. */
const later = () => vi.setSystemTime(Date.now() + REVALIDATE_MS + 1);
const hold = (h: { hold: Promise<void> | null }) => { let go!: () => void; h.hold = new Promise((r) => { go = r; }); return () => { h.hold = null; go(); }; };

describe("reads at once (readCache)", () => {
  it("a read seen before is answered from its copy at once, the hub asked behind it; a different answer is told and kept", async () => {
    const { h, f } = hub();
    const told: string[] = [];
    const off = onFresh((v, k) => told.push(`${v} ${k}`));
    const read = keptFetch("home", HUB, f, alive);
    expect(await (await read(URL_A)).text()).toBe(h.body);
    expect(h.asked).toHaveLength(1);
    // the hub changes, and is slow
    h.body = '[{"id":"a","content":"two"}]';
    later();
    const go = hold(h);
    const r = await read(URL_A);
    expect(r.headers.get("x-parachute-kept")).not.toBeNull();
    expect(await r.text()).toContain("one");
    expect(h.asked).toHaveLength(2);
    // slower than the window: its answer comes after it
    later();
    go(); await settle();
    expect(told).toEqual(["home /vault/home/api/notes?tag=journal"]);
    // the readers told read again: the answer they were told of, without asking the hub for it again
    expect(await (await read(URL_A)).text()).toContain("two");
    await settle();
    expect(h.asked).toHaveLength(2);
    off();
  });
  it("the hub is asked behind a copy at most once in a while for one read; a screen shown again asks at once", async () => {
    const { h, f } = hub();
    const read = keptFetch("home", HUB, f, alive);
    await read(URL_A); await read(URL_A); await read(URL_A); await settle();
    expect(h.asked).toHaveLength(1);
    askAgain("home");
    await read(URL_A); await settle();
    expect(h.asked).toHaveLength(2);
  });
  it("after a write, reads come from the hub this session, and a read on its way while it is written isn't kept", async () => {
    const { h, f } = hub();
    const read = keptFetch("home", HUB, f, alive);
    await read(URL_A);
    await read("https://hub.example/vault/home/api/notes", { method: "POST", body: "{}" });
    h.body = '[{"id":"a","content":"after"}]';
    // the copy is from before the write: the hub is asked, and its answer waited for
    expect(await (await read(URL_A)).text()).toContain("after");
    const other = "https://hub.example/vault/home/api/notes?tag=other";
    const go = hold(h);
    const p = read(other);
    await settle();
    markWritten("home");
    go(); await p;
    h.body = "[]";
    expect(await (await read(other)).text()).toBe("[]");
  });
  it("sign-out drops the copies, and an answer on its way then isn't kept", async () => {
    const { h, f } = hub();
    const read = keptFetch("home", HUB, f, alive);
    h.body = '["secret"]';
    const go = hold(h);
    const p = read(URL_A);
    await settle();
    await dropKept("home");
    go(); await p;
    h.body = "[]";
    expect(await (await read(URL_A)).text()).toBe("[]");
  });
  it("a sign-in the hub refuses drops the vault's copies, and says so", async () => {
    const { h, f } = hub();
    const told: string[] = [];
    const off = onFresh((_, k) => told.push(k));
    const read = keptFetch("home", HUB, f, async () => "refused");
    await read(URL_A);
    await read("https://hub.example/vault/home/api/notes?tag=other");
    later();
    h.status = 401; h.body = '{"error":"no"}';
    await read(URL_A); await settle();
    expect(told).toHaveLength(1);
    h.status = 200; h.body = "[]";
    // nothing kept of the vault: the hub's answers are waited for
    expect(await (await read(URL_A)).text()).toBe("[]");
    expect(await (await read("https://hub.example/vault/home/api/notes?tag=other")).text()).toBe("[]");
    off();
  });
  it("another hub's vault of the same name never reads the copies; nor does another vault on the same hub", async () => {
    const { h, f } = hub();
    await keptFetch("home", HUB, f, alive)(URL_A);
    await keptFetch("home", "https://other.example", f, alive)(URL_A);
    await keptFetch("work", HUB, f, alive)(URL_A);
    expect(h.asked).toHaveLength(3);
  });
});

describe("a write still on its way", () => {
  it("a read answered while a write is on its way isn't trusted once the write has landed", async () => {
    dropAllKept();
    const h = { body: '["before"]', asked: 0 };
    let land!: () => void;
    const f: typeof fetch = async (_input, init) => {
      if ((init?.method ?? "GET") !== "GET") { await new Promise<void>((r) => { land = r; }); h.body = '["after"]'; return new Response("{}", { status: 200 }); }
      h.asked++;
      return new Response(h.body, { status: 200, headers: { "content-type": "application/json" } });
    };
    const read = keptFetch("home", HUB, f, alive);
    const w = read("https://hub.example/vault/home/api/notes", { method: "POST", body: "{}" });
    await settle();
    vi.setSystemTime(Date.now() + 5);
    // the hub answers as it was, before the write lands
    expect(await (await read(URL_A)).text()).toBe('["before"]');
    land(); await w;
    vi.setSystemTime(Date.now() + 1);
    expect(await (await read(URL_A)).text()).toBe('["after"]');
  });
});

describe("the hub's own answer", () => {
  it("a check behind a copy never takes the browser's copy of an earlier answer", async () => {
    dropAllKept();
    const seen: (RequestCache | undefined)[] = [];
    const f: typeof fetch = async (_input, init) => { seen.push(init?.cache); return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); };
    const read = keptFetch("home", HUB, f, alive);
    await read(URL_A);
    later();
    await read(URL_A); await settle();
    expect(seen).toEqual([undefined, "no-cache"]);
  });
});

describe("a read that must be the hub's now", () => {
  it("cache: reload waits for the hub even with a copy, and leaves its answer as the copy", async () => {
    dropAllKept();
    const { h, f } = hub();
    const read = keptFetch("home", HUB, f, alive);
    await read(URL_A);
    h.body = '["now"]';
    expect(await (await read(URL_A, { cache: "reload" })).text()).toBe('["now"]');
    expect(h.asked).toHaveLength(2);
    // the copy is the hub's answer just read
    expect(await (await read(URL_A)).text()).toBe('["now"]');
  });
});
