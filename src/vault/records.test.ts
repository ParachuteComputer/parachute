// The record door's words and its detection. The hub is faked here only as the network it is; the e2e runs the real
// thing against core 0.8 (no door) and 0.9 (the door).
import { beforeEach, describe, expect, it } from "vitest";
import { answerOut, bodyIn, doorsKnown, forgetDoors, recordsFetch, splitTypes, urlIn } from "./records";

const V = "https://hub.example/vault/v/api";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("words", () => {
  it("a notes call becomes a records call, its query and body in record words", () => {
    expect(urlIn(`${V}/notes?tag=applet&include_content=true&include_metadata=true&limit=5`)).toBe(`${V}/records?tag=applet&include_body=true&include_fields=true&limit=5`);
    expect(urlIn(`${V}/notes/Applets%2FHome`)).toBe(`${V}/records/Applets%2FHome`);
    expect(urlIn(`${V}/tags`)).toBe(`${V}/tags`);
    expect(bodyIn({ path: "A", content: "x", metadata: { content: 1 }, tags: ["t"] })).toEqual({ path: "A", body: "x", fields: { content: 1 }, tags: ["t"] });
    expect(bodyIn({ notes: [{ content: "a" }] })).toEqual({ records: [{ body: "a" }] });
  });

  it("an answer comes back as notes, with types among the tags and fields untouched", () => {
    const rec = { id: "1", path: "Applets/X", body: "code", fields: { applet: { body: "kept" }, records: [1] }, tags: ["x"], types: ["applet"] };
    expect(answerOut(rec)).toEqual({ id: "1", path: "Applets/X", content: "code", metadata: { applet: { body: "kept" }, records: [1] }, tags: ["applet", "x"], types: ["applet"] });
    expect(answerOut([rec])).toEqual([answerOut(rec)]);
    expect(answerOut({ records: [rec], next_cursor: "c" })).toEqual({ notes: [answerOut(rec)], next_cursor: "c" });
    expect(answerOut({ error: "Not found", error_type: "not_found" })).toEqual({ error: "Not found", error_type: "not_found" });
  });
});

describe("detection, once per vault", () => {
  beforeEach(forgetDoors);
  const hub = (door: boolean, seen: string[], probe?: () => Response) => (async (input: RequestInfo | URL) => {
    const url = String(input); seen.push(url.replace("https://hub.example/vault/v/api", ""));
    if (url.includes("/records?limit=1")) return probe ? probe() : door ? json(200, []) : json(404, { error: "Not found" });
    if (url.includes("/records")) return door ? (url.includes("missing") ? json(404, { error: "Not found", error_type: "not_found" }) : json(200, [{ id: "1", body: "b", fields: {}, tags: [], types: ["applet"] }])) : json(404, { error: "Not found" });
    return json(200, [{ id: "1", content: "b", metadata: {}, tags: ["applet"] }]);
  }) as typeof fetch;

  it("a hub with the door gets every notes call there, after one probe; a missing record doesn't change that", async () => {
    const seen: string[] = [];
    const f = recordsFetch(hub(true, seen));
    expect(await (await f(`${V}/notes?tag=applet`)).json()).toEqual([{ id: "1", content: "b", metadata: {}, tags: ["applet"], types: ["applet"] }]);
    expect((await f(`${V}/notes/missing`)).status).toBe(404);
    await f(`${V}/notes?tag=x`);
    expect(seen).toEqual(["/records?limit=1", "/records?tag=applet", "/records/missing", "/records?tag=x"]);
    expect(doorsKnown().get(V)).toBe("records");
  });

  it("a hub without it (404 on the probe) keeps /api/notes, and is asked once", async () => {
    const seen: string[] = [];
    const f = recordsFetch(hub(false, seen));
    await f(`${V}/notes?tag=applet`); await f(`${V}/notes?tag=x`);
    expect(seen).toEqual(["/records?limit=1", "/notes?tag=applet", "/notes?tag=x"]);
  });

  it("a probe that says nothing (refused, or no network) decides nothing: the call goes to /api/notes and the next asks again", async () => {
    const seen: string[] = [];
    let n = 0;
    const f = recordsFetch(hub(true, seen, () => (n++ === 0 ? json(401, { error: "expired" }) : json(200, []))));
    await f(`${V}/notes?tag=a`); await f(`${V}/notes?tag=b`);
    expect(seen).toEqual(["/records?limit=1", "/notes?tag=a", "/records?limit=1", "/records?tag=b"]);
  });

  it("anything not under /api/notes is left alone", async () => {
    const seen: string[] = [];
    await recordsFetch(hub(true, seen))(`${V}/tags`);
    expect(seen).toEqual(["/tags"]);
  });
});

describe("types on a write", () => {
  beforeEach(forgetDoors);
  it("a name the vault holds as a type goes in types; the rest stay tags", () => {
    expect(splitTypes({ path: "A", tags: ["recipe", "x"] }, new Set(["recipe"]))).toEqual({ path: "A", tags: ["x"], types: ["recipe"] });
    expect(splitTypes({ path: "A", tags: ["x"] }, new Set(["recipe"]))).toEqual({ path: "A", tags: ["x"] });
    expect(splitTypes({ records: [{ tags: ["recipe"] }] }, new Set(["recipe"]))).toEqual({ records: [{ tags: [], types: ["recipe"] }] });
  });

  it("asks the vault's types once, and again (with one retry) when the vault says a name became a type", async () => {
    const seen: string[] = [];
    let types = ["applet"];
    const f = recordsFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("https://hub.example/vault/v/api", ""); seen.push(url);
      if (url === "/records?limit=1") return json(200, []);
      if (url === "/types") return json(200, types.map((name) => ({ name, kind: "type" })));
      const b = JSON.parse(String(init?.body));
      if ((b.tags ?? []).some((t: string) => types.includes(t))) return json(422, { error_type: "tag_kind" }); // as core 0.9 answers it
      return json(201, { id: "1", body: b.body, fields: {}, tags: b.tags, types: b.types ?? [] });
    }) as typeof fetch);
    const one = await (await f(`${V}/notes`, { method: "POST", body: JSON.stringify({ path: "A", content: "x", tags: ["applet", "y"] }) })).json();
    expect(one).toMatchObject({ content: "x", tags: ["applet", "y"] });
    types = ["applet", "recipe"];
    const two = await f(`${V}/notes`, { method: "POST", body: JSON.stringify({ path: "B", content: "x", tags: ["recipe"] }) });
    expect(two.status).toBe(201);
    expect(seen).toEqual(["/records?limit=1", "/types", "/records", "/records", "/types", "/records"]);
  });
});
