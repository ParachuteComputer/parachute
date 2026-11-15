import { describe, expect, it } from "vitest";
import { choose, type Approved, type Kept, type Mode, type Read } from "./frameChoice";

const found = (hash = "tsx:aaa", noteId = "f1", vault = "home"): Read => ({ vault, state: "found", noteId, path: "Parachute/Frame", kind: "tsx", source: "export default () => null", hash, basedOn: null, updatedAt: null });
const ok = (hash = "tsx:aaa", vault = "home", noteId = "f1", mode: Mode = "sealed"): Approved => ({ vault, noteId, hash, js: "/* js */", t: "t", source: "s", kind: "tsx", mode });
const approved = (...a: Parameters<typeof ok>): Kept => ({ approved: ok(...a) });
const base = { mode: "sealed" as Mode | "closed", home: "home" as string | null, read: found() as Read | null, kept: {} as Kept };
const at = (state: "none" | "unreachable", vault = "home"): Read => ({ vault, state });

describe("which frame runs", () => {
  it("the built-in one with no home vault, or no frame record in it", () => {
    expect(choose({ ...base, home: null })).toEqual({ run: "built-in", why: "no-home" });
    expect(choose({ ...base, read: at("none") })).toEqual({ run: "built-in", why: "no-record" });
  });
  it("the built-in one until the self-test has passed (and isn't running), even for code allowed before", () => {
    expect(choose({ ...base, mode: "closed", kept: approved() })).toEqual({ run: "built-in", why: "gate" });
  });
  it("a record never allowed: its card", () => {
    expect(choose(base)).toMatchObject({ run: "built-in", why: "ask", card: { vault: "home", noteId: "f1", hash: "tsx:aaa", changed: null } });
  });
  it("the record, when this exact code was allowed", () => {
    expect(choose({ ...base, kept: approved() })).toMatchObject({ run: "vault", vault: "home", noteId: "f1", hash: "tsx:aaa", approved: { js: "/* js */" } });
  });
  it("changed code: the card again, saying it changed", () => {
    expect(choose({ ...base, read: found("tsx:bbb"), kept: approved("tsx:aaa") })).toMatchObject({ run: "built-in", why: "ask", card: { hash: "tsx:bbb", changed: "code" } });
  });
  it("allowed under a sealed pass, now approved code only here: the card again, online and offline", () => {
    expect(choose({ ...base, mode: "approved-code", kept: approved() })).toMatchObject({ why: "ask", card: { changed: "mode" } });
    expect(choose({ ...base, mode: "approved-code", read: at("unreachable"), kept: approved() })).toEqual({ run: "built-in", why: "unreachable" });
    expect(choose({ ...base, mode: "approved-code", kept: approved("tsx:aaa", "home", "f1", "approved-code") })).toMatchObject({ run: "vault" });
    // allowed under approved code only, now sealed: it still runs (sealed is the stronger seal)
    expect(choose({ ...base, mode: "sealed", kept: approved("tsx:aaa", "home", "f1", "approved-code") })).toMatchObject({ run: "vault" });
  });
  it("code allowed from another vault, or another note, is not this one's", () => {
    expect(choose({ ...base, kept: approved("tsx:aaa", "other") })).toMatchObject({ why: "ask", card: { changed: null } });
    expect(choose({ ...base, kept: approved("tsx:aaa", "home", "f0") })).toMatchObject({ why: "ask" });
  });
  it("a read of another vault than home counts as not read yet", () => {
    expect(choose({ ...base, read: found("tsx:aaa", "f1", "other") })).toEqual({ run: "built-in", why: "waiting" });
  });
  it("code the person chose the built-in one over isn't asked about again; changed code is", () => {
    const declined: Kept = { declined: { vault: "home", noteId: "f1", hash: "tsx:aaa" } };
    expect(choose({ ...base, kept: declined })).toEqual({ run: "built-in", why: "declined" });
    expect(choose({ ...base, read: found("tsx:ccc"), kept: declined })).toMatchObject({ why: "ask" });
  });
  it("offline or not read yet: the copy last allowed for this home vault, else the built-in one", () => {
    expect(choose({ ...base, read: at("unreachable"), kept: approved() })).toMatchObject({ run: "vault", hash: "tsx:aaa" });
    expect(choose({ ...base, read: null, kept: approved() })).toMatchObject({ run: "vault" });
    expect(choose({ ...base, read: at("unreachable") })).toEqual({ run: "built-in", why: "unreachable" });
    expect(choose({ ...base, read: null, kept: approved("tsx:aaa", "other") })).toEqual({ run: "built-in", why: "waiting" });
  });
  it("two frame records, or one that can't be read: the built-in one", () => {
    expect(choose({ ...base, read: { vault: "home", state: "many", paths: ["a", "b"] }, kept: approved() })).toEqual({ run: "built-in", why: "many" });
    expect(choose({ ...base, read: { vault: "home", state: "bad", error: "x" } })).toEqual({ run: "built-in", why: "bad" });
  });
  it("a frame that stopped (or hung the app) gives way to the built-in one until it changes, offline too", () => {
    const failed: Kept = { ...approved(), failed: { hash: "tsx:aaa", why: "boom" } };
    expect(choose({ ...base, kept: failed })).toEqual({ run: "built-in", why: "failed" });
    expect(choose({ ...base, read: null, kept: failed })).toEqual({ run: "built-in", why: "failed" });
    expect(choose({ ...base, read: found("tsx:ddd"), kept: failed })).toMatchObject({ why: "ask" });
  });
});
