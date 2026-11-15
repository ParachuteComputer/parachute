import { describe, expect, it } from "vitest";
import { choose, type Kept, type Read } from "./frameChoice";

const found = (hash = "tsx:aaa", noteId = "f1"): Read => ({ state: "found", noteId, path: "Parachute/Frame", kind: "tsx", source: "export default () => null", hash, basedOn: null, updatedAt: null });
const approved = (hash = "tsx:aaa", vault = "home", noteId = "f1"): Kept => ({ approved: { vault, noteId, hash, js: "/* js */" } });
const base = { gateOpen: true, home: "home", read: found(), kept: {} as Kept, failed: null as string | null };

describe("which frame runs", () => {
  it("the built-in one with no home vault, or no frame record in it", () => {
    expect(choose({ ...base, home: null })).toEqual({ run: "built-in", why: "no-home" });
    expect(choose({ ...base, read: { state: "none" } })).toEqual({ run: "built-in", why: "no-record" });
  });
  it("the built-in one until the self-test has passed (and isn't running), even for code allowed before", () => {
    expect(choose({ ...base, gateOpen: false, kept: approved() })).toEqual({ run: "built-in", why: "gate" });
  });
  it("a record never allowed: its card, and the built-in one meanwhile", () => {
    expect(choose(base)).toMatchObject({ run: "built-in", why: "ask", card: { vault: "home", noteId: "f1", hash: "tsx:aaa", changed: false } });
  });
  it("the record, when this exact code was allowed", () => {
    expect(choose({ ...base, kept: approved() })).toEqual({ run: "vault", vault: "home", noteId: "f1", hash: "tsx:aaa", js: "/* js */" });
  });
  it("changed code: the card again, saying it changed", () => {
    expect(choose({ ...base, read: found("tsx:bbb"), kept: approved("tsx:aaa") })).toMatchObject({ run: "built-in", why: "ask", card: { hash: "tsx:bbb", changed: true } });
  });
  it("code allowed from another vault, or another note, is not this one's", () => {
    expect(choose({ ...base, kept: approved("tsx:aaa", "other") })).toMatchObject({ why: "ask", card: { changed: false } });
    expect(choose({ ...base, kept: approved("tsx:aaa", "home", "f0") })).toMatchObject({ why: "ask" });
  });
  it("code the person chose the built-in one over isn't asked about again; changed code is", () => {
    const declined: Kept = { declined: { vault: "home", noteId: "f1", hash: "tsx:aaa" } };
    expect(choose({ ...base, kept: declined })).toEqual({ run: "built-in", why: "declined" });
    expect(choose({ ...base, read: found("tsx:ccc"), kept: declined })).toMatchObject({ why: "ask" });
  });
  it("offline or not read yet: the copy last allowed for this home vault, else the built-in one", () => {
    expect(choose({ ...base, read: { state: "unreachable" }, kept: approved() })).toMatchObject({ run: "vault", hash: "tsx:aaa", js: "/* js */" });
    expect(choose({ ...base, read: null, kept: approved() })).toMatchObject({ run: "vault" });
    expect(choose({ ...base, read: { state: "unreachable" } })).toEqual({ run: "built-in", why: "unreachable" });
    expect(choose({ ...base, read: null, kept: approved("tsx:aaa", "other") })).toEqual({ run: "built-in", why: "waiting" });
  });
  it("two frame records, or one that can't be read: the built-in one", () => {
    expect(choose({ ...base, read: { state: "many", paths: ["a", "b"] }, kept: approved() })).toEqual({ run: "built-in", why: "many" });
    expect(choose({ ...base, read: { state: "bad", error: "x" } })).toEqual({ run: "built-in", why: "bad" });
  });
  it("a frame that stopped gives way to the built-in one until it changes", () => {
    expect(choose({ ...base, kept: approved(), failed: "tsx:aaa" })).toEqual({ run: "built-in", why: "failed" });
    expect(choose({ ...base, read: found("tsx:ddd"), kept: approved(), failed: "tsx:aaa" })).toMatchObject({ why: "ask" });
  });
});
