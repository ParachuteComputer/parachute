// The kit's side of an applet run as a website (docs/WRITE-AN-APPLET.md "As a website"): what the sealed frame's kit
// (src/applet/kits/frameKit.ts) gives an applet, here on a VaultClient the visitor linked (LinkParachute.tsx). It is
// installed as `globalThis.parachute`, as the frame's is, so the kit's own parts (useSaved, Page, Note, links) run
// unchanged. The vault speaks record words, as in the frame: body and fields, includeBody and includeFields.
import type { VaultClient } from "@openparachute/surface-client";
import { cssOf, DEFAULT_THEME, tokensOf } from "../../../src/theme/theme.ts";

export type AppletInfo = { id: string; name: string };
type Rec = Record<string, unknown>;

// the frame's record words (frameKit.ts IN/OUT), both ways, and on a link's ends
const IN: Record<string, string> = { body: "content", fields: "metadata", includeBody: "includeContent", includeFields: "includeMetadata" };
const OUT: Record<string, string> = { content: "body", metadata: "fields" };
const renamed = (o: unknown, map: Record<string, string>): Rec => {
  if (!o || typeof o !== "object") return o as Rec;
  const r: Rec = {};
  for (const [k, v] of Object.entries(o as Rec)) r[map[k] ?? k] = v;
  return r;
};
export const toRecord = (n: unknown): Rec => {
  const r = renamed(n, OUT);
  if (r && Array.isArray(r.links)) r.links = r.links.map((l: Rec) => (l && typeof l === "object" ? { ...renamed(l, OUT), sourceNote: l.sourceNote ? renamed(l.sourceNote, OUT) : l.sourceNote, targetNote: l.targetNote ? renamed(l.targetNote, OUT) : l.targetNote } : l));
  return r;
};

let client: VaultClient | null = null;
let applet: AppletInfo = { id: "applet", name: "Applet" };
const need = () => {
  if (!client) throw Object.assign(new Error("No Parachute is linked yet."), { status: 401 });
  return client;
};

/** The vault the applet reads and writes, as `import { vault } from "parachute"` gives it. */
export const vault = {
  queryRecords: async (q: Rec = {}) => { const rows = await need().queryNotes(renamed(q, IN) as never); return Array.isArray(rows) ? rows.map(toRecord) : rows; },
  getRecord: async (id: string, o?: { includeLinks?: boolean }) => { try { const n = await need().getNote(id, o?.includeLinks ? { includeLinks: true } : {}); return n ? toRecord(n) : null; } catch (e) { if ((e as { status?: number })?.status === 404) return null; throw e; } },
  createRecord: async (r: Rec) => toRecord(await need().createNote(renamed(r, IN) as never)),
  updateRecord: async (id: string, c: Rec) => toRecord(await need().updateNote(id, renamed(c, IN) as never)),
  listTags: async () => need().listTags(),
  queryNotes: (q: Rec = {}) => need().queryNotes(q as never),
  getNote: (id: string) => need().getNote(id),
  createNote: (p: Rec) => need().createNote(p as never),
  updateNote: (id: string, p: Rec) => need().updateNote(id, p as never),
};

/** What it saved (useSaved), kept in this browser, under the applet's id. */
const savedKey = (k: string) => `parachute.applet.${applet.id}.${k}`;
const saved = {
  get: (k: string): unknown => { try { const v = localStorage.getItem(savedKey(k)); return v === null ? null : JSON.parse(v); } catch { return null; } },
  set: (k: string, v: unknown) => { try { if (v === null || v === undefined) localStorage.removeItem(savedKey(k)); else localStorage.setItem(savedKey(k), JSON.stringify(v)); } catch { /* full or off: kept for this visit only */ } },
};

const tokens = () => tokensOf(DEFAULT_THEME, typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches) as unknown as Record<string, string>;

/** The kit object the frame would give, for the parts that read it (screen.tsx, parts.tsx, links.tsx, useTheme.ts). */
const kit = {
  vault,
  saved,
  theme: { now: tokens, on: () => () => {}, get: async () => tokens() },
  // a link out opens in a new tab; a note link has no app to open in here
  app: { openLink: async (url: string) => !!window.open(url, "_blank", "noopener"), follow: async () => false, links: async (ls: string[]) => Object.fromEntries(ls.map((l) => [l, null])), address: async () => null },
  onFresh: () => () => {},
  onShown: () => () => {},
};

/** Put the theme's look on the page (its CSS variables) and the kit where the parts read it. */
export function installWebKit(info: AppletInfo) {
  applet = info;
  (globalThis as unknown as { parachute?: unknown }).parachute = kit;
  if (typeof document === "undefined") return;
  let el = document.getElementById("parachute-theme");
  if (!el) { el = document.createElement("style"); el.id = "parachute-theme"; document.head.appendChild(el); }
  el.textContent = cssOf(tokensOf(DEFAULT_THEME, false) as never);
}

/** The VaultClient the visitor linked (or null when they unlink). */
export function linkClient(c: VaultClient | null) { client = c; }

// ── the lifecycle a frame has, as a website has it: always shown, started at once, nothing handed to it ──
export const ready = () => Promise.resolve({ applet, access: [] as { path: string; verbs: string[] }[], services: [] as unknown[], shown: true });
export const shown = () => true;
export const onShown = (_cb: (on: boolean) => void) => () => {};
export const onFresh = (_cb: () => void) => () => {};
export const onOpen = (_cb: (o: { note: { id: string; path: string }; screen: string }) => void) => () => {};
export const onLaunch = (_cb: (l: unknown) => void) => () => {};
export const launch = () => null;
// the browser's own Back leaves a website; an applet's own screens close with their own ←
export const onBack = (_cb: () => void) => () => {};
