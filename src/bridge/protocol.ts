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
/** How much a frame may ask: calls waiting at once, and calls in a ten-second window. The shell refuses past them
 *  (shell/frameBridge.ts); the frame keeps its calls within them (frame/bridge.ts). */
export const FRAME_LIMITS = { pending: 32, perWindow: 300, windowMs: 10_000 };

/** A vault as the frame sees it: no token, no client id, nothing to sign in with. `whose` (vault/whose.ts): mine,
 *  someone else's, or someone else's that the person trusts; `home`: the person's home vault. */
/** `hub`: the origin of the Parachute it is on (FrameParachute.hub). */
/** `url`: the vault's own root (`<hub>/vault/<name>`, or where a hosted vault lives), what a note's address is made on. */
export type FrameVault = { key: string; vault: string; host: string; issuer: string; hub?: string; url?: string; whose?: "mine" | "theirs" | "trusted"; home?: boolean };
/** A pointer in the home vault (docs/design/EMBED.md): what it brings in, from where, and whether this device holds that
 *  vault (`at`: this device's key for it) and the record's status there. `changed`: its code differs from the pin. */
/** A component as the launcher lists it (component.ts): what it is and what it takes. */
export type FrameComponent = { noteId: string; path: string; id: string; name: string; glyph: string; note?: string; props: Record<string, string> };
export type FrameComponents = { ok: true; entries: FrameComponent[] } | { ok: false; error: string };
export type FramePointer = {
  noteId: string; kind: "applet" | "component"; id: string; name: string;
  from: { vault: string; host: string }; record: string;
  at: string | null; glyph?: string; status?: "ok" | "updated" | "none" | "off"; changed?: boolean;
};
/** An applet as open-with needs it, with its status on this device, judged by the shell. */
export type FrameApplet = {
  noteId: string; path: string; vault: string; opens: Opens[];
  manifest: { id: string; name: string; glyph: string; note?: string; screens: { id: string; name: string }[] };
  status: "ok" | "updated" | "none" | "off";
};
/** `why` when it failed: its Parachute wasn't reached, or refused this device's sign-in (vault/failure.ts). */
export type FrameApplets = { ok: true; entries: FrameApplet[]; skipped: number } | { ok: false; error: string; why?: "offline" | "refused" };
/** An applet as the bar names it: its vault (this device's key) and its note. */
export type FramePlace = { vault: string; noteId: string };
/** The bar and the home (docs/NAVIGATION.md): what this device can find of the person's settings note. */
/** One of the person's Parachutes (docs/design/ONE-SIGN-IN.md): a hub this device is signed in to (its vaults are the
 *  ones whose `issuer` is `hub`), or one their list names that this device isn't (`signedIn` false). The home's first.
 *  `fresh`: vaults made there since this device signed in, which it may add (vault/newVaults.ts). */
export type FrameParachute = { hub: string; host: string; name: string; home: boolean; signedIn: boolean; fresh?: string[] };
/** `look`: "notes" when the open bundle's home is Notes (docs/SIMPLE.md), else the list. `app: "simple"` says the same
 *  for frames written before 11-20, until 2026-12-20. */
/** `notice: "bundle-record"`: the bundle this device chose didn't load (its record is malformed or gone); the list says
 *  so. `"bundle-newer"`: it was made for a newer Parachute (`noticeName` is its name); the list says to update. A frame that
 *  doesn't know a notice shows none. */
/** Vault (applet/parachuteSource.ts) in the home vault: where it is, and whether it runs as allowed ("ok"), changed since
 *  ("updated"), not yet allowed ("none"), or applets don't run on this device ("off"); absent when it isn't there. */
export type FrameViewer = { vault: string; noteId: string; status: "ok" | "updated" | "none" | "off" };
export type FrameHome = { start: FramePlace | null; bar: FramePlace[]; parachutes?: FrameParachute[]; look?: "notes"; app?: "simple"; notice?: "bundle-record" | "bundle-newer"; noticeName?: string; viewer?: FrameViewer;
  /** Parachute's own applets (docs/design/PARACHUTE-SOURCE.md), in the home: from the app, not from any vault's list */
  official?: FrameApplet[] };
/** What a read of the vault may ask: a read-only subset of the vault's notes query. */
export type Query = { search?: string; tag?: string; pathPrefix?: string; orderBy?: "updated_at" | "created_at"; sort?: "asc" | "desc"; limit?: number; offset?: number; includeContent?: boolean; includeMetadata?: boolean };
/** `decided`: what the note's route already decided for this history entry (kept by the shell, which outlives the frame). */
export type Decided = "applet" | "ask" | "vault";
export type FrameLocation = { pathname: string; search: string; hash: string; key: string; decided?: Decided };

/** Every call, its parameters and its answer. */
export type Calls = {
  "vaults.list": [Record<string, never>, FrameVault[]];
  "vault.query": [{ vault: string; query: Query }, Note[]];
  /** `kept`: answered at once from the copy this device kept of that read (vault/readCache.ts), the hub asked behind
   *  it; the frame is told (`changed`, what: "note") when the hub's answer differs. */
  "vault.note": [{ vault: string; id: string; kept?: boolean }, Note | null];
  /** The vault's role tags; null when they couldn't be read (open-with then opens nothing in an applet). */
  "vault.roles": [{ vault: string }, string[] | null];
  /** `fresh`: read the vault's applets again before answering. */
  "applets.list": [{ vault: string; fresh: boolean }, FrameApplets];
  "defaults.get": [{ vault: string }, Record<string, string>];
  /** `choice` null clears it. */
  "defaults.set": [{ vault: string; type: string; choice: string | null }, null];
  "home.get": [Record<string, never>, FrameHome];
  /** Pin an applet to the bar, or unpin it; only during a tap. */
  "home.pin": [{ vault: string; noteId: string; on: boolean }, null];
  /** Make an applet the home (it opens on start), or none (`noteId` null); only during a tap. */
  "home.start": [{ vault: string; noteId: string | null }, null];
  /** The home vault's pointers, each resolved on this device. */
  "pointers.list": [Record<string, never>, FramePointer[]];
  /** Bring an applet or a component of someone else's vault into the person's own: a pointer in the home vault; only
   *  during a tap. */
  "home.bringIn": [{ vault: string; noteId: string }, null];
  /** A vault's components. */
  "components.list": [{ vault: string }, FrameComponents];
  /** Put a component on the home applet's page (a pointer when it is from another vault, and the embed); only during a
   *  tap. "already" when it is there. */
  "home.addEmbed": [{ vault: string; noteId: string }, "added" | "already"];
  /** Add a vault the Parachute offers (FrameParachute.fresh): the shell opens the hub's consent for it; only during a
   *  tap. */
  "home.addVault": [{ hub: string; vault: string }, null];
  /** Don't offer that vault again on this device; only during a tap. */
  "home.dismissVault": [{ hub: string; vault: string }, null];
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
export const METHODS = ["vaults.list", "vault.query", "vault.note", "vault.roles", "applets.list", "defaults.get", "defaults.set", "home.get", "home.pin", "home.start", "pointers.list", "home.bringIn", "components.list", "home.addEmbed", "home.addVault", "home.dismissVault", "nav.go", "nav.back", "nav.decided", "clipboard.write", "link.out"] as const satisfies readonly Method[];

export type Events = { location: FrameLocation;
  /** what: "note": the hub's answer for a note the frame read from the copy (`vault.note` with `kept`) differs from it */
  changed: { what: "vaults" | "applets" | "defaults" | "home" | "pointers" } | { what: "note"; vault: string; id: string }; /** the look's tokens (src/theme), each a CSS variable --<key> */ theme: Record<string, string>;
  /** the frame is on screen again (true) after a shell screen (an applet, Settings) hid it, or hidden (false): kept
   *  running meanwhile (shell/FrameArea.tsx), it draws what it read at once and reads it again behind */
  shown: boolean };

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
    case "vaults.list": case "nav.back": case "home.get": case "pointers.list": return only(p, []);
    case "home.bringIn": case "home.addEmbed": return only(p, ["vault", "noteId"]) && str(p.vault, 120) && str(p.noteId);
    case "components.list": return only(p, ["vault"]) && str(p.vault, 120);
    case "home.addVault": case "home.dismissVault": return only(p, ["hub", "vault"]) && str(p.hub, 500) && str(p.vault, 120);
    case "home.pin": return only(p, ["vault", "noteId", "on"]) && str(p.vault, 120) && str(p.noteId) && typeof p.on === "boolean";
    case "home.start": return only(p, ["vault", "noteId"]) && str(p.vault, 120) && (p.noteId === null || str(p.noteId));
    case "vault.note": return only(p, ["vault", "id", "kept"]) && str(p.vault, 120) && str(p.id) && optBool(p.kept);
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
      return only(q, ["search", "tag", "pathPrefix", "orderBy", "sort", "limit", "offset", "includeContent", "includeMetadata"])
        && optStr(q.search, 500) && optStr(q.tag, 120) && optStr(q.pathPrefix, 300)
        && (q.orderBy === undefined || q.orderBy === "updated_at" || q.orderBy === "created_at")
        && (q.sort === undefined || q.sort === "asc" || q.sort === "desc")
        && (q.limit === undefined || (Number.isInteger(q.limit) && (q.limit as number) > 0 && (q.limit as number) <= 200))
        && (q.offset === undefined || (Number.isInteger(q.offset) && (q.offset as number) >= 0 && (q.offset as number) <= 1_000_000))
        && optBool(q.includeContent) && optBool(q.includeMetadata);
    }
  }
}

/** The app addresses the frame may send the person to: the vault list, a vault, a note, an applet, Settings, Add; and the
 *  shell's own editor (a new note, a note's words), Connect, Capture and Journal (docs/SIMPLE.md). */
export function allowedDestination(to: string): boolean {
  let u: URL;
  try { u = new URL(to, "http://app.invalid"); } catch { return false; }
  if (u.origin !== "http://app.invalid" || !/^\/(?![\/\\])/.test(to)) return false;
  return u.pathname === "/" || u.pathname === "/settings" || u.pathname === "/add" || u.pathname === "/connect" || u.pathname === "/capture" || u.pathname === "/journal" || u.pathname === "/vault"
    || /^\/v\/[^/]+(?:\/[na]\/[^/]+|\/n\/[^/]+\/edit|\/new)?$/.test(u.pathname);
}
