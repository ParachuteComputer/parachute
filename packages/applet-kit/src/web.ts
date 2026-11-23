// The kit's side of an applet run as a website (docs/WRITE-AN-APPLET.md "As a website"): what the sealed frame's kit
// (src/applet/kits/frameKit.ts) gives an applet, here on a VaultClient the visitor linked (LinkParachute.tsx). It is
// installed as `globalThis.parachute`, as the frame's is, so the kit's own parts (useSaved, Page, Note, links) run
// unchanged. The vault speaks record words, as in the frame: body and fields, includeBody and includeFields.
import type { VaultClient } from "@openparachute/surface-client";
import { cssOf, DEFAULT_THEME, tokensOf } from "../../../src/theme/theme.ts";
import { FONTS_CSS } from "../../../src/theme/fonts.ts";
import { attachedMedia, storagePath } from "../../../src/applet/files.ts";

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
/** Whose vault the saved state is of: the hub and vault linked, so relinking elsewhere starts afresh. */
let linkedTo = "";
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
  getNote: (id: string, o?: { includeLinks?: boolean; includeAttachments?: boolean }) => need().getNote(id, o),
  createNote: (p: Rec) => need().createNote(p as never),
  updateNote: (id: string, p: Rec) => need().updateNote(id, p as never),
  // a picture or a short sound attached to the record (the Note asks for pictures by itself, given the record's id):
  // the frame's one rule, a file the hub lists as the record's own (docs/design/PICTURES.md)
  file: async (id: string, src: string) => {
    const want = storagePath(src);
    if (!want) throw new Error("only a picture or a sound attached to the record");
    const c = need();
    const got = await attachedMedia(want, await c.listAttachments(id), (p) => c.fetchAttachmentBlob(`/api/storage/${p.split("/").map(encodeURIComponent).join("/")}`), (e) => e as never);
    return new Blob([got.bytes], { type: got.type });
  },
};

/** What it saved (useSaved), kept in this browser, under the applet's id and the vault linked. */
const savedPrefix = () => `parachute.applet.${applet.id}.`;
const savedKey = (k: string) => `${savedPrefix()}${linkedTo}.${k}`;
export const saved = {
  get: (k: string): unknown => { try { const v = localStorage.getItem(savedKey(k)); return v === null ? null : JSON.parse(v); } catch { return null; } },
  set: (k: string, v: unknown) => { try { if (v === null || v === undefined) localStorage.removeItem(savedKey(k)); else localStorage.setItem(savedKey(k), JSON.stringify(v)); } catch { /* full or off: kept for this visit only */ } },
  all: (): Record<string, unknown> => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith(`${savedPrefix()}${linkedTo}.`)).map((k) => [k.slice(`${savedPrefix()}${linkedTo}.`.length), saved.get(k.slice(`${savedPrefix()}${linkedTo}.`.length))])),
  flush: () => Promise.resolve(null),
};
/** Forget everything this applet saved in this browser (Unlink). */
export function forgetSaved() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(savedPrefix())) localStorage.removeItem(k); } catch { /* nothing kept */ }
}

// the theme's tokens for the system's light or dark, made once each (useTheme reads them as a store: the same object
// until the scheme changes), and told to whoever listens when it does
const dark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
const made: { light?: Record<string, string>; dark?: Record<string, string> } = {};
const tokens = (): Record<string, string> => {
  const d = dark();
  return (made[d ? "dark" : "light"] ??= tokensOf(DEFAULT_THEME, d) as unknown as Record<string, string>);
};
const themeCbs = new Set<(t: Record<string, string>) => void>();
const paint = () => {
  if (typeof document === "undefined") return;
  let el = document.getElementById("parachute-theme");
  if (!el) { el = document.createElement("style"); el.id = "parachute-theme"; document.head.appendChild(el); }
  // the app's own faces (data: URLs, nothing fetched), then the theme's variables that name them
  el.textContent = FONTS_CSS + cssOf(tokens() as never);
};
if (typeof matchMedia === "function") matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { paint(); for (const cb of themeCbs) cb(tokens()); });
export const theme = {
  now: tokens,
  get: async () => tokens(),
  on: (cb: (t: Record<string, string>) => void) => { themeCbs.add(cb); return () => { themeCbs.delete(cb); }; },
};
// a link out opens in a new tab; a note link has no app to open in here, so it reads as nothing to follow
export const app = {
  openLink: async (url: string) => { window.open(url, "_blank", "noopener"); return true; },
  follow: async () => false,
  links: async (ls: string[]) => ls.map(() => null),
  address: async () => null,
};

/** The kit object the frame would give, for the parts that read it (screen.tsx, parts.tsx, links.tsx, useTheme.ts). */
const kit = {
  vault,
  saved,
  theme,
  app,
  onFresh: () => () => {},
  onShown: () => () => {},
};

/** Put the theme's look on the page (its CSS variables) and the kit where the parts read it. */
export function installWebKit(info: AppletInfo) {
  applet = info;
  (globalThis as unknown as { parachute?: unknown }).parachute = kit;
  paint();
}

/** The VaultClient the visitor linked (or null when they unlink), and whose vault it is (hub and vault). */
export function linkClient(c: VaultClient | null, to = "") { client = c; linkedTo = to; }

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
// what a website has nothing to give for: props (an embed's), and what is the app's (every vault, servers, the
// device's storage and microphone, the bar's counts). Undefined, as an older app's missing call is, so an applet can
// fall back (typeof vaults === "undefined")
export const props = () => ({});
export const onProps = (_cb: (p: Record<string, unknown>) => void) => () => {};
export const vaults = undefined;
export const services = undefined;
export const storage = undefined;
export const voice = undefined;
export const signal = undefined;
