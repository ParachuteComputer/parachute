import { describe, expect, it } from "vitest";
import { parseComponent, propsFor } from "./component";
import { parsePointer, pointerPath } from "./pointer";
import { compositeHash, importsOf } from "./imports";
import { createTrustStore } from "./trust";

const EVENTS = { contract: 1, id: "events", name: "Events", glyph: "◷", props: { days: "number", title: "string" }, access: [{ vault: "here", allow: [{ path: "Events/", verbs: ["read"] }] }] };

describe("a component's fields", () => {
  it("reads what it takes and what it may touch", () => {
    const r = parseComponent(EVENTS);
    expect(r.ok && r.component).toEqual({ contract: 1, id: "events", name: "Events", glyph: "◷", props: { days: "number", title: "string" }, allow: [{ path: "Events/", verbs: ["read"] }] });
  });
  it.each([
    [{ ...EVENTS, contract: 2 }, /contract/],
    [{ ...EVENTS, screens: [] }, /doesn't know/],
    [{ ...EVENTS, props: { days: "date" } }, /one of string/],
    [{ ...EVENTS, props: { "a b": "string" } }, /plain word/],
    [{ ...EVENTS, access: [{ vault: "home", allow: [{ path: "Journal/", verbs: ["read"] }] }] }, /here/],
    [{ ...EVENTS, access: [{ vault: "here", allow: [{ path: ".parachute/", verbs: ["read"] }] }] }, /\.parachute/],
    [{ ...EVENTS, access: [{ vault: "here", allow: [{ path: "Events/", verbs: ["delete"] }] }] }, /delete/],
  ])("refuses %#", (raw, why) => { const r = parseComponent(raw); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(why); });
  it("hands it only the props it declares, of their kinds, and nothing over 2 KB", () => {
    const c = { props: { days: "number", title: "string" } as const };
    expect(propsFor(c, { days: 7, title: "Soon", secret: "x", constructor: "y" })).toEqual({ days: 7, title: "Soon" });
    expect(propsFor(c, { days: "7", title: 3 })).toEqual({});
    expect(propsFor(c, { days: Infinity })).toEqual({});
    expect(propsFor(c, "days=7")).toEqual({});
  });
});

describe("a pointer", () => {
  const P = { hub: "https://techne.example", vault: "techne", record: "01M7KARHZC1VBJJPNSM13ZSW9C", kind: "component", id: "events", name: "Events", code: `tsx:${"a".repeat(64)}` };
  it("reads a pointer, its hub as an origin", () => { const r = parsePointer({ ...P, hub: "https://techne.example/" }); expect(r.ok && r.pointer.hub).toBe("https://techne.example"); });
  it.each([
    [{ ...P, hub: "javascript:alert(1)" }], [{ ...P, hub: "https://u:p@techne.example" }], [{ ...P, hub: "https://techne.example/vault/techne" }],
    [{ ...P, kind: "frame" }], [{ ...P, code: "tsx:abc" }], [{ ...P, extra: 1 }], [{ ...P, name: "Ev​ents" }],
  ])("refuses %#", (raw) => expect(parsePointer(raw).ok).toBe(false));
  it("is written under Parachute/From/<vault>/", () => expect(pointerPath("techne", "Events / soon")).toBe("Parachute/From/techne/Events - soon"));
});

describe("imports", () => {
  it("finds component imports, not ones in comments or strings", () => {
    expect(importsOf(`import Events from "component:events";\n// import X from "component:hidden"\nconst s = "from 'component:nope'";\nimport { A } from 'component:a-b';\nconst L = import("component:lazy");`)).toEqual(["events", "a-b", "lazy"]);
  });
  it("the hash covers what it imports, in any order", async () => {
    const a = await compositeHash("tsx", "src", [{ id: "a", hash: "1" }, { id: "b", hash: "2" }]);
    expect(await compositeHash("tsx", "src", [{ id: "b", hash: "2" }, { id: "a", hash: "1" }])).toBe(a);
    expect(await compositeHash("tsx", "src", [{ id: "a", hash: "1" }, { id: "b", hash: "3" }])).not.toBe(a);
    expect(a).toMatch(/^tsx:[0-9a-f]{64}$/);
  });
});

describe("trust", () => {
  it("is per hub and vault, kept on the device", () => {
    const mem = new Map<string, string>();
    const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const t = createTrustStore(s);
    t.trust("https://techne.example/x", "techne");
    expect(createTrustStore(s).has("https://techne.example", "techne")).toBe(true);
    expect(t.has("https://techne.example", "other")).toBe(false);
    t.untrust("https://techne.example", "techne");
    expect(createTrustStore(s).has("https://techne.example", "techne")).toBe(false);
  });
});
