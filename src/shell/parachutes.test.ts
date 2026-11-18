// Who starts on the simple app (docs/SIMPLE.md): a person new to the app signing in to Parachute Cloud, and no one
// else. The hub is faked at the network (its notes API); the app's own modules run as they are.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterSignIn } from "./parachutes";
import { saveVault, type VaultRecord } from "../vault/store";
import { dropClient } from "../vault/client";
import { setWhose } from "../vault/whose";

const HUB = "https://cloud.example";
type Note = { id: string; path: string; tags: string[]; metadata: Record<string, unknown>; content: string; updatedAt: string };
let notes: Record<string, Note[]>;
let refuse: Set<string>;
const writes: { method: string; vault: string; body: Record<string, unknown> }[] = [];

/** A vault this sign-in brought, the person's own (as they said on Add a Parachute) unless `theirs`. */
function hold(vault: string, theirs = false): VaultRecord {
  const rec = saveVault({ issuer: HUB, vault, tokenEndpoint: `${HUB}/oauth/token`, clientId: "c", accessToken: "t", scope: `vault:${vault}:read vault:${vault}:write`, addedAt: "2026-11-18T00:00:00Z" });
  setWhose(rec, theirs ? "theirs" : "mine");
  return rec;
}

beforeEach(() => {
  localStorage.clear();
  notes = {}; refuse = new Set(); writes.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    const m = /^\/vault\/([^/]+)\/api\/(records|notes)(?:\/([^/?]+))?$/.exec(u.pathname);
    if (!m) return new Response("no", { status: 404 });
    const [, vault, door, id] = m;
    if (door === "records") return new Response("no record door", { status: 404 });
    if (refuse.has(vault)) return new Response("down", { status: 503 });
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const list = (notes[vault] ??= []);
    if (method === "GET") {
      const tag = u.searchParams.get("tag");
      return Response.json(list.filter((n) => !tag || n.tags.includes(tag)));
    }
    const body = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : "{}"))) as Record<string, unknown>;
    writes.push({ method, vault, body });
    if (method === "POST") {
      const n: Note = { id: `n${list.length + 1}`, path: String(body.path), tags: (body.tags as string[]) ?? [], metadata: (body.metadata as Record<string, unknown>) ?? {}, content: String(body.content ?? ""), updatedAt: "2026-11-18T01:00:00Z" };
      list.push(n);
      return Response.json(n, { status: 201 });
    }
    const n = list.find((x) => x.id === id)!;
    Object.assign(n, { metadata: body.metadata ?? n.metadata, updatedAt: "2026-11-18T02:00:00Z" });
    return Response.json(n);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); for (const k of ["garden", "work"]) dropClient(k); });

const settingsWritten = () => writes.find((w) => (w.body.metadata as { parachute?: unknown } | undefined)?.parachute)?.body.metadata as { parachute: Record<string, unknown> } | undefined;

describe("who starts on the simple app", () => {
  it("a person new to the app on Parachute Cloud: their settings note is made with app: simple", async () => {
    const kept = [hold("garden"), hold("work")];
    await afterSignIn(HUB, kept, true);
    expect(settingsWritten()?.parachute).toMatchObject({ app: "simple", hubs: [{ hub: HUB }] });
  });
  it("a person whose vault already holds settings: what the note says stays", async () => {
    notes.work = [{ id: "s1", path: "Parachute/Settings", tags: ["parachute-settings"], metadata: { parachute: { hubs: [] } }, content: "", updatedAt: "2026-11-01T00:00:00Z" }];
    await afterSignIn(HUB, [hold("garden"), hold("work")], true);
    expect(settingsWritten()?.parachute).not.toHaveProperty("app");
  });
  it("a vault that couldn't be read may hold settings: no app is chosen", async () => {
    refuse.add("work");
    await afterSignIn(HUB, [hold("garden"), hold("work")], true);
    expect(settingsWritten()?.parachute ?? {}).not.toHaveProperty("app");
  });
  it("someone else's vaults on Cloud only (none of the person's own): no settings note, no app", async () => {
    await afterSignIn(HUB, [hold("garden", true)], true);
    expect(settingsWritten()).toBeUndefined();
  });
  it("a hub that isn't Parachute Cloud: as before", async () => {
    await afterSignIn(HUB, [hold("garden")], false);
    expect(settingsWritten()?.parachute).toBeDefined();
    expect(settingsWritten()?.parachute).not.toHaveProperty("app");
  });
});
