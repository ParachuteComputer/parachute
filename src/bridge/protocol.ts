// The one way between the frame and the shell. The frame (navigation, the vault view, open-with) runs in a sealed
// frame: a srcdoc iframe with sandbox="allow-scripts" and no same origin, so it has no storage of its own and can't
// reach the shell's (where the sign-ins' tokens and the applets' grants are kept). It asks the shell for what it needs,
// one typed call at a time, and the shell answers only what is in this table. Nothing here returns a token, and no
// call grants anything: the card and Allow are the shell's own screen.
//
//   frame → shell   {pf: 1, id, method, params}
//   shell → frame   {pf: 1, id, result} | {pf: 1, id, error}
//   shell → frame   {pf: 1, event, data}       events: location, changed
// Pure: types and checks, shared by both sides.

import type { Note } from "@openparachute/surface-client";
import type { Opens } from "../applet/opens.ts";

export const PF = 1;

/** A vault as the frame sees it: no token, no client id, nothing to sign in with. */
export type FrameVault = { key: string; vault: string; host: string; issuer: string };
/** An applet as open-with needs it, with its status on this device, judged by the shell. */
export type FrameApplet = {
  noteId: string; path: string; vault: string; opens: Opens[];
  manifest: { id: string; name: string; glyph: string; screens: { id: string; name: string }[] };
  status: "ok" | "updated" | "none" | "off";
};
export type FrameApplets = { ok: true; entries: FrameApplet[]; skipped: number } | { ok: false; error: string };
/** What a read of the vault may ask: a read-only subset of the vault's notes query. */
export type Query = { search?: string; tag?: string; pathPrefix?: string; orderBy?: "updated_at" | "created_at"; sort?: "asc" | "desc"; limit?: number; includeContent?: boolean; includeMetadata?: boolean };
/** `decided`: what the note's route already decided for this history entry (kept by the shell, which outlives the frame). */
export type Decided = "applet" | "ask" | "vault";
export type FrameLocation = { pathname: string; search: string; hash: string; key: string; decided?: Decided };

/** Every call, its parameters and its answer. */
export type Calls = {
  "vaults.list": [Record<string, never>, FrameVault[]];
  "vault.query": [{ vault: string; query: Query }, Note[]];
  "vault.note": [{ vault: string; id: string }, Note | null];
  /** The vault's role tags; null when they couldn't be read (open-with then opens nothing in an applet). */
  "vault.roles": [{ vault: string }, string[] | null];
  /** `fresh`: read the vault's applets again before answering. */
  "applets.list": [{ vault: string; fresh: boolean }, FrameApplets];
  "defaults.get": [{ vault: string }, Record<string, string>];
  /** `choice` null clears it. */
  "defaults.set": [{ vault: string; type: string; choice: string | null }, null];
  /** Go to an address in the app. `carryFrom`: the address a tap led to, which the app now sends on to `to`. */
  "nav.go": [{ to: string; replace?: boolean; carryFrom?: string }, null];
  "nav.back": [Record<string, never>, null];
  /** The note's route decided for this history entry: it acts on that once, never again on a return. */
  "nav.decided": [{ key: string; kind: Decided }, null];
  /** Only during a tap. */
  "clipboard.write": [{ text: string }, boolean];
  /** An http(s) address, opened outside the app; only during a tap. */
  "link.out": [{ url: string }, boolean];
};
export type Method = keyof Calls;
export type Params<M extends Method> = Calls[M][0];
export type Result<M extends Method> = Calls[M][1];
export const METHODS = ["vaults.list", "vault.query", "vault.note", "vault.roles", "applets.list", "defaults.get", "defaults.set", "nav.go", "nav.back", "nav.decided", "clipboard.write", "link.out"] as const satisfies readonly Method[];

export type Events = { location: FrameLocation; changed: { what: "vaults" | "applets" | "defaults" } };

export type Request = { pf: 1; id: string; method: Method; params: unknown };
export type Reply = { pf: 1; id: string; result: unknown } | { pf: 1; id: string; error: string };

// ── checks (the shell's side: everything from the frame is checked before it is used) ──

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const only = (x: Record<string, unknown>, keys: readonly string[]) => Object.keys(x).every((k) => keys.includes(k));
const str = (x: unknown, max = 300): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
const optStr = (x: unknown, max = 300) => x === undefined || (typeof x === "string" && x.length <= max);
const optBool = (x: unknown) => x === undefined || typeof x === "boolean";

/** A request as the frame sent it, or null: an unknown method, a wrong shape or a bad parameter is never answered with data. */
export function parseRequest(data: unknown): { id: string; method: Method; params: Record<string, unknown> } | { id: string | null; error: string } {
  if (!plain(data) || data.pf !== PF) return { id: null, error: "bad_request" };
  const id = str(data.id, 64) ? data.id : null;
  if (!id) return { id: null, error: "bad_request" };
  if (!(METHODS as readonly string[]).includes(data.method as string)) return { id, error: "unknown_method" };
  const method = data.method as Method;
  const p = data.params === undefined ? {} : data.params;
  if (!plain(p) || !paramsOk(method, p)) return { id, error: "bad_params" };
  return { id, method, params: p };
}

function paramsOk(m: Method, p: Record<string, unknown>): boolean {
  switch (m) {
    case "vaults.list": case "nav.back": return only(p, []);
    case "vault.note": return only(p, ["vault", "id"]) && str(p.vault, 120) && str(p.id);
    case "vault.roles": case "defaults.get": return only(p, ["vault"]) && str(p.vault, 120);
    case "applets.list": return only(p, ["vault", "fresh"]) && str(p.vault, 120) && typeof p.fresh === "boolean";
    case "defaults.set": return only(p, ["vault", "type", "choice"]) && str(p.vault, 120) && str(p.type, 120) && (p.choice === null || str(p.choice, 120));
    case "nav.go": return only(p, ["to", "replace", "carryFrom"]) && str(p.to, 2000) && optBool(p.replace) && optStr(p.carryFrom, 2000);
    case "nav.decided": return only(p, ["key", "kind"]) && str(p.key, 64) && (p.kind === "applet" || p.kind === "ask" || p.kind === "vault");
    case "clipboard.write": return only(p, ["text"]) && str(p.text, 4000);
    case "link.out": return only(p, ["url"]) && str(p.url, 4000);
    case "vault.query": {
      if (!only(p, ["vault", "query"]) || !str(p.vault, 120) || !plain(p.query)) return false;
      const q = p.query;
      return only(q, ["search", "tag", "pathPrefix", "orderBy", "sort", "limit", "includeContent", "includeMetadata"])
        && optStr(q.search, 500) && optStr(q.tag, 120) && optStr(q.pathPrefix, 300)
        && (q.orderBy === undefined || q.orderBy === "updated_at" || q.orderBy === "created_at")
        && (q.sort === undefined || q.sort === "asc" || q.sort === "desc")
        && (q.limit === undefined || (Number.isInteger(q.limit) && (q.limit as number) > 0 && (q.limit as number) <= 200))
        && optBool(q.includeContent) && optBool(q.includeMetadata);
    }
  }
}

/** The app addresses the frame may send the person to: the vault list, a vault, a note, an applet, Settings, Add. */
export function allowedDestination(to: string): boolean {
  let u: URL;
  try { u = new URL(to, "http://app.invalid"); } catch { return false; }
  if (u.origin !== "http://app.invalid" || !/^\/(?![\/\\])/.test(to)) return false;
  return u.pathname === "/" || u.pathname === "/settings" || u.pathname === "/add" || /^\/v\/[^/]+(?:\/[na]\/[^/]+)?$/.test(u.pathname);
}
