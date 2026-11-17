// A pointer: a record in the person's home vault that brings in an applet or a component from another vault (usually
// another Parachute's), pinned to the code hash the person allowed (docs/design/EMBED.md).
//
//   path: Parachute/From/techne/Events
//   tags: [parachute-pointer]
//   fields:
//     pointer: { hub: https://techne.example, vault: techne, record: 01M7…, kind: component, id: events, name: Events, code: tsx:9b13… }
//
// The pin (`code`) is a claim, never a grant: what runs is decided by this device's Allow for that exact hash. Pure.

import { hasHidden, hasOnly, plain } from "./contract.ts";

export const POINTER_TAG = "parachute-pointer";
export const POINTER_FOLDER = "Parachute/From/";
export const POINTER_KINDS = ["applet", "component"] as const;
export type PointerKind = (typeof POINTER_KINDS)[number];
export type Pointer = { hub: string; vault: string; record: string; kind: PointerKind; id: string; name: string; code: string };
export type PointerParse = { ok: true; pointer: Pointer } | { ok: false; error: string };

const KEYS = ["hub", "vault", "record", "kind", "id", "name", "code"];
const VAULT = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RECORD = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^(?:(?:tsx|jsx):)?[0-9a-f]{64}$/;

/** The hub's origin, as a pointer names it: http(s), no path, no credentials. */
export function hubOrigin(x: unknown): string | null {
  if (typeof x !== "string" || x.length > 300 || hasHidden(x)) return null;
  try {
    const u = new URL(x);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
    return u.origin;
  } catch { return null; }
}

export function parsePointer(raw: unknown): PointerParse {
  if (!plain(raw) || !hasOnly(raw, KEYS)) return { ok: false, error: "a pointer is {hub, vault, record, kind, id, name, code}" };
  const hub = hubOrigin(raw.hub);
  if (!hub) return { ok: false, error: "hub is the other hub's address (https://…)" };
  if (typeof raw.vault !== "string" || !VAULT.test(raw.vault)) return { ok: false, error: "vault is the vault's name on that hub" };
  if (typeof raw.record !== "string" || !RECORD.test(raw.record)) return { ok: false, error: "record is the record's id there" };
  if (!(POINTER_KINDS as readonly string[]).includes(raw.kind as string)) return { ok: false, error: "kind is applet or component" };
  if (typeof raw.id !== "string" || raw.id.length > 40 || !ID.test(raw.id)) return { ok: false, error: "id is its kebab-case id there" };
  const name = typeof raw.name === "string" && !hasHidden(raw.name) && !/[\n\t]/.test(raw.name) ? raw.name.trim() : "";
  if (!name || [...name].length > 40) return { ok: false, error: "name is one short line" };
  if (typeof raw.code !== "string" || !CODE.test(raw.code)) return { ok: false, error: "code is the code hash that was allowed" };
  return { ok: true, pointer: { hub, vault: raw.vault, record: raw.record, kind: raw.kind as PointerKind, id: raw.id, name, code: raw.code } };
}

/** Where the app writes a pointer: Parachute/From/<host>/<vault>/<kind>-<id>. Ids are kebab-case and unique per kind in a
 *  vault, and the host keeps two hubs' vaults of one name apart. */
export const pointerPath = (host: string, vault: string, kind: PointerKind, id: string) => `${POINTER_FOLDER}${host.replace(/[^A-Za-z0-9.-]/g, "-")}/${vault}/${kind}-${id}`;
