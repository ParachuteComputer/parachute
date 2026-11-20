import { describe, expect, it } from "vitest";
import { approvalsShown, ownFrame, settingsShown, usesCards, type SettingsFacts } from "./settingsShown";
import type { Service } from "../applet/services";

const notes: { services: Service[] } = { services: [] };
const rooms: { services: Service[] } = { services: [{ id: "rooms", kind: "nostr-relay", url: "wss://relay.example/", publish: [9], media: false, private: [], approvals: { from: ["a".repeat(64)] } }] };
const mail: { services: Service[] } = { services: [{ id: "mail", kind: "http", url: "https://mail.example/", auth: "nip98", approve: { field: "op", ops: ["send.approve"] } }] };
const plainHttp: { services: Service[] } = { services: [{ id: "x", kind: "http", url: "https://x.example/", auth: "none" }] };
const newcomer: SettingsFacts = { key: false, home: true, applets: [], securitySet: false, anchor: false, frame: false, ownVaults: 1 };

describe("which key sections Settings shows", () => {
  it("a newcomer (no key here, one vault, no frame of their own) sees none, with or without applets", () => {
    expect(settingsShown(newcomer)).toEqual({ security: false, approving: false, frame: false });
    expect(settingsShown({ ...newcomer, applets: [notes, rooms] })).toEqual({ security: false, approving: false, frame: false });
  });
  it("the key alone, with nothing to approve, shows nothing either", () => {
    expect(settingsShown({ ...newcomer, key: true })).toEqual({ security: false, approving: false, frame: false });
  });
  it("the key and an applet whose Allow it signs: Security, and Approving code where a home of theirs keeps it", () => {
    expect(settingsShown({ ...newcomer, key: true, applets: [notes] })).toMatchObject({ security: true, approving: true });
    expect(settingsShown({ ...newcomer, key: true, applets: [notes], home: false })).toMatchObject({ security: true, approving: false });
  });
  it("stays while something is set: Security's levels, idle lock or passcode (key or not), a root key kept here", () => {
    expect(settingsShown({ ...newcomer, securitySet: true }).security).toBe(true);
    expect(settingsShown({ ...newcomer, key: true, anchor: true }).approving).toBe(true);
    expect(settingsShown({ ...newcomer, anchor: true }).approving).toBe(false);
  });
  it("Frame: a frame of their own, or more than one vault of theirs to pick home from", () => {
    expect(settingsShown({ ...newcomer, frame: true }).frame).toBe(true);
    expect(settingsShown({ ...newcomer, ownVaults: 2 }).frame).toBe(true);
    expect(settingsShown({ ...newcomer, ownVaults: 0 }).frame).toBe(false);
  });
});

describe("the parts they're decided from", () => {
  it("an applet uses approval cards when a relay answers them or an http service holds sends for approval", () => {
    expect([notes, rooms, mail, plainHttp].map(usesCards)).toEqual([false, true, true, false]);
  });
  it("Approvals (trusted keys): with the key, an applet that uses cards, or something to undo", () => {
    const k = { same: true, approvers: [] };
    expect(approvalsShown(false, k)).toBe(false);
    expect(approvalsShown(true, k)).toBe(true);
    expect(approvalsShown(false, { same: true, approvers: [{}] })).toBe(true);
    expect(approvalsShown(false, { same: false, approvers: [] })).toBe(true);
    expect(approvalsShown(true, null)).toBe(false);
  });
  it("a frame of their own: found or several in the home vault, or their kept copy runs", () => {
    expect(ownFrame({ state: "found" }, "built-in")).toBe(true);
    expect(ownFrame({ state: "many" }, "built-in")).toBe(true);
    expect(ownFrame(null, "vault")).toBe(true);
    for (const state of ["none", "bad", "unreachable"]) expect(ownFrame({ state }, "built-in")).toBe(false);
    expect(ownFrame(null, "built-in")).toBe(false);
  });
});
