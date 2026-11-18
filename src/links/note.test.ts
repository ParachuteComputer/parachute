import { describe, expect, it } from "vitest";
import { findLinks, findNoteRefs, noteAddress, parseNoteRef } from "./note";

const ID = "01KA3Z9V6B2W8XQJ4M7N5P0R1S";

describe("noteAddress: the one form written", () => {
  it("is the note's view on its vault", () => {
    expect(noteAddress("https://hub.example/vault/kitchen", ID)).toBe(`https://hub.example/vault/kitchen/view/${ID}`);
    expect(noteAddress("https://hub.example/vault/kitchen/", ID)).toBe(`https://hub.example/vault/kitchen/view/${ID}`);
  });
  it("reads back as the note it was made for", () => {
    expect(parseNoteRef(noteAddress("https://hub.example/vault/kitchen", ID))).toEqual({ kind: "address", issuer: "https://hub.example", vault: "kitchen", note: ID });
  });
});

describe("parseNoteRef", () => {
  it.each([
    [`kitchen:${ID}`, { kind: "short", vault: "kitchen", note: ID }],
    [`uni:${ID}`, { kind: "short", vault: "uni", note: ID }],
    ["[[Recipes/Tomato toast]]", { kind: "wiki", target: "Recipes/Tomato toast" }],
    ["[[Tomato toast#Method|the toast]]", { kind: "wiki", target: "Tomato toast" }],
    [`https://hub.example/surface/parachute/v/kitchen/n/${ID}`, { kind: "address", issuer: "https://hub.example", vault: "kitchen", note: ID }],
    [`http://127.0.0.1:4000/vault/kitchen/view/${ID}`, { kind: "address", issuer: "http://127.0.0.1:4000", vault: "kitchen", note: ID }],
  ])("reads %s", (raw, ref) => expect(parseNoteRef(raw)).toEqual(ref));

  it.each([
    ["kitchen:not-a-ulid"],
    [`Kitchen:${ID}`], // a vault's name is lower case
    [`kitchen:${ID.toLowerCase()}`],
    [`kitchen:${ID}0`],
    ["https://hub.example/vault/kitchen"],
    [`http://hub.example/vault/kitchen/view/${ID}`], // plain http only on this machine
    [`https://u:p@hub.example/vault/kitchen/view/${ID}`],
    [`https://hub.example/vault/Kitchen/view/${ID}`],
    [`https://hub.example/vault/kitchen/view/..%2Fx`],
    [`https://hub.example/evil/vault/kitchen/view/${ID}`],
    ["[[]]"], ["[[a\nb]]"], [`[[${"a".repeat(600)}]]`],
    ["mailto:me@example.com"], [""],
  ])("refuses %j", (raw) => expect(parseNoteRef(raw)).toBeNull());
});

describe("findLinks", () => {
  it("finds Uni's short form in a sentence, and an address with its sentence's full stop left out", () => {
    const text = `Logged it as uni:${ID}, see https://hub.example/vault/kitchen/view/${ID}.`;
    const f = findLinks(text);
    expect(f.map((x) => x.raw)).toEqual([`uni:${ID}`, `https://hub.example/vault/kitchen/view/${ID}`]);
    expect(f.map((x) => text.slice(x.start, x.end))).toEqual(f.map((x) => x.raw));
    expect(f[1].ref).toMatchObject({ kind: "address", vault: "kitchen" });
  });
  it("gives other web addresses with no ref, and keeps a bracket the address opened", () => {
    const f = findLinks("see (https://en.wikipedia.org/wiki/Bean_(plant)) and https://example.com/a?b=c!");
    expect(f.map((x) => [x.raw, x.ref])).toEqual([["https://en.wikipedia.org/wiki/Bean_(plant)", null], ["https://example.com/a?b=c", null]]);
  });
  it("doesn't take a short form inside an address, a mail address or a word", () => {
    expect(findNoteRefs(`https://hub.example/x?ref=kitchen:${ID}`)).toEqual([]);
    expect(findNoteRefs(`me@kitchen:${ID}`)).toEqual([]);
    expect(findNoteRefs(`xkitchen:${ID}abc`)).toEqual([]);
    expect(findNoteRefs(`[kitchen:${ID}](https://x.example)`)).toHaveLength(0);
  });
});
