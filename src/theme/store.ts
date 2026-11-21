// The theme the app shows now (theme.ts): the built-in one, or the home vault's theme record. Like the settings and the
// frame records, it lives on the person's side, so their agent can change it by writing that note, and the app keeps
// the last copy it read, so it opens in their look even when the vault can't be reached.
//
//   live      the shell holds a live query on the record's tag (the vault's `subscribe`, over a WebSocket): a change to
//             the note restyles the shell, the frame and every applet at once, without a restart or a poll. While the
//             socket is down, the note is read again on the usual occasions (at start, when the frame area or Settings
//             is shown).
//   copy-on-write  the built-in theme until the first change: "Make this look mine" (or a change made in Settings) writes it,
//             in full, into the home vault; from then on that note is the theme.
//   applied   the shell sets the tokens on its own document; the frame and applets are sent them (theme events).
import { useSyncExternalStore } from "react";
import type { Note } from "@openparachute/surface-client";
import { plain, stripExt } from "../applet/contract";
import { clientFor, keptClientFor } from "../vault/client";
import { onFresh } from "../vault/readCache";
import { homeVault } from "../shell/frameSource";
import { DEFAULT_THEME, MOTION_CSS, recordOf, themeFrom, TOKEN_KEYS, TYPE_SCALE, tokensOf, withLook, withTodaysFonts, type Theme, type Tokens } from "./theme";
import { FONTS_CSS } from "./fonts";

export const THEME_TAG = "parachute-theme";
export const THEME_PATH = "Parachute/Theme";
export const THEME_KEY = "parachute.theme.v1";

type Kept = { vault: string; theme: Theme; noteId: string | null };
const storage = () => (typeof localStorage === "undefined" ? null : localStorage);
// The copy in memory is the one used; storage is where it outlasts the app. Read once, parsed (and held to the grammar)
// once per change, never per call.
let memory: Kept | null | undefined;
function kept(): Kept | null {
  if (memory !== undefined) return memory;
  try {
    const v = JSON.parse(storage()?.getItem(THEME_KEY) ?? "null") as { vault?: unknown; theme?: unknown; noteId?: unknown } | null;
    memory = v && typeof v.vault === "string" ? { vault: v.vault, theme: themeFrom({ theme: v.theme }), noteId: typeof v.noteId === "string" ? v.noteId : null } : null;
  } catch { memory = null; }
  return memory;
}
function keep(vault: string, raw: unknown, noteId: string | null) {
  memory = { vault, theme: themeFrom({ theme: raw }), noteId };
  try { storage()?.setItem(THEME_KEY, JSON.stringify({ vault, theme: raw, noteId })); } catch { /* kept in memory, for this session */ }
}

/** The theme now: the home vault's record as last read, else the built-in one. */
export function themeNow(): { theme: Theme; from: "built-in" | "vault"; noteId: string | null } {
  const k = kept();
  const home = homeVault();
  if (!k || !home || k.vault !== home.key || !k.noteId) return { theme: DEFAULT_THEME, from: "built-in", noteId: null };
  return { theme: k.theme, from: "vault", noteId: k.noteId };
}

const darkQuery = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);
/** The tokens as applied now: the theme, in the palette the device's scheme (or the record) picks. */
export const tokensNow = (): Tokens => tokensOf(themeNow().theme, !!darkQuery()?.matches);

// ── the store ──

let rev = 0;
let read: "none" | "reading" | "read" | "unreachable" = "none";
let live = false;
const listeners = new Set<() => void>();
let appliedCss = "";
function bump() {
  rev++;
  applyToDocument();
  listeners.forEach((f) => f());
}
/** Put the tokens on the shell's own document (inline on <html>, over styles.css). Only when they changed. */
export function applyToDocument() {
  if (typeof document === "undefined") return;
  const t = tokensNow();
  const css = JSON.stringify(t);
  if (css === appliedCss) return;
  appliedCss = css;
  const s = document.documentElement.style;
  for (const k of TOKEN_KEYS) s.setProperty(`--${k}`, t[k]);
  for (const [k, v] of Object.entries(TYPE_SCALE)) s.setProperty(`--fs-${k}`, `calc(var(--size) * ${v})`);
  s.setProperty("color-scheme", t.scheme);
  // how things move: the curves and times once, in a sheet (so the device's reduce-motion can still them), and the
  // theme's choice on the root
  if (!document.getElementById("pa-motion")) {
    const m = document.createElement("style");
    m.id = "pa-motion";
    m.textContent = MOTION_CSS;
    document.head.appendChild(m);
  }
  // the faces the app carries (fonts.ts), once
  if (!document.getElementById("pa-fonts")) {
    const f = document.createElement("style");
    f.id = "pa-fonts";
    f.textContent = FONTS_CSS;
    document.head.appendChild(f);
  }
  document.documentElement.dataset.motion = t.motion;
}
darkQuery()?.addEventListener?.("change", () => bump());

export function subscribeTheme(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
export function useTheme() {
  useSyncExternalStore(subscribeTheme, () => `${rev}:${homeVault()?.key ?? ""}`);
  return { ...themeNow(), tokens: tokensNow(), read, live };
}

/** The theme note among those tagged so: the only one, else the one at the usual path (two elsewhere: none). */
const pick = (rows: Note[]) => (rows.length === 1 ? rows[0] : rows.find((r) => stripExt(r.path ?? "") === THEME_PATH) ?? null);
const themeOf = (n: Note | null) => (n && plain(n.metadata) ? (n.metadata as Record<string, unknown>).theme ?? null : null);
/** Take what the vault holds now as the theme (or none). */
function take(vault: string, rows: Note[]) {
  const n = pick(rows);
  keep(vault, themeOf(n), n?.id ?? null);
  read = "read";
  bump();
}

let generation = 0;
// read from the copy kept of it (vault/readCache.ts), and again when the hub's answer differs
onFresh((vault, key) => { if (vault === homeVault()?.key && /[?&]tag=parachute-theme(?:&|$)/.test(key)) void readTheme(); });
/** Read the record again. A read a newer one (or a change of home) overtook is dropped. */
export async function readTheme(): Promise<void> {
  const home = homeVault();
  const mine = ++generation;
  if (!home) { read = "read"; bump(); return; }
  try {
    const rows = await keptClientFor(home).queryNotes({ tag: THEME_TAG, includeMetadata: true, limit: 20 });
    if (mine !== generation || homeVault()?.key !== home.key) return;
    take(home.key, rows);
  } catch {
    if (mine !== generation) return;
    read = "unreachable";
    bump();
  }
}

/** Follow the home vault's record live. Returns the way to stop (call it when the home vault changes). */
export function watchTheme(): () => void {
  const home = homeVault();
  if (!home) return () => {};
  const rows = new Map<string, Note>();
  // a live change is newer than any read still on its way: that read is dropped (readTheme's generation)
  const now = () => { if (homeVault()?.key === home.key) { generation++; take(home.key, [...rows.values()]); } };
  let stop: () => void = () => {};
  try {
    stop = clientFor(home).subscribe({ tag: THEME_TAG, includeMetadata: true, limit: 20 }, {
      onSnapshot: (notes) => { rows.clear(); for (const n of notes) rows.set(n.id, n); now(); },
      onUpsert: (n) => { rows.set(n.id, n); now(); },
      onRemove: (id) => { if (rows.delete(id)) now(); },
      onStatus: (s) => { const was = live; live = s === "open"; if (was !== live) bump(); },
      onError: () => { /* the subscription retries; until then the record is read at the usual times */ },
    });
  } catch { /* no live query here: the record is read at the usual times */ }
  return () => { stop(); if (live) { live = false; bump(); } };
}

/** Change the theme (a tap's): read the record as it is now, change only what was asked, and write it back. The first
 *  change writes the built-in theme in full, with the change, as the person's own (copy-on-write). */
async function changeTheme(change: (raw: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const home = homeVault();
  if (!home) throw new Error("There's no home vault yet.");
  const c = clientFor(home);
  const rows = await c.queryNotes({ tag: THEME_TAG, includeMetadata: true, limit: 20 });
  const n = pick(rows);
  if (!n && rows.length > 1) throw new Error(`Your home vault has ${rows.length} theme notes; keep one, at ${THEME_PATH}.`);
  if (n) {
    const was = themeOf(n);
    const theme = change(plain(was) ? withTodaysFonts({ ...was }) : recordOf(DEFAULT_THEME));
    const updatedAt = (n as { updatedAt?: string }).updatedAt;
    await c.updateNote(n.id, { metadata: { ...(n.metadata ?? {}), theme }, ...(updatedAt ? { if_updated_at: updatedAt } : {}) } as Parameters<typeof c.updateNote>[1]);
  } else {
    const theme = change(recordOf(DEFAULT_THEME));
    await c.createNote({ path: THEME_PATH, content: "The look of the Parachute app: its look, colours, fonts and density. See docs/THEME.md.", tags: [THEME_TAG], metadata: { theme } } as Parameters<typeof c.createNote>[0]);
  }
  await readTheme();
}

/** Copy the built-in theme into the home vault, to change it there (by hand, or by the person's agent). */
export const makeThemeMine = () => changeTheme((r) => r);
export const setDensity = (density: Theme["density"]) => changeTheme((r) => ({ ...r, density }));
export const setScheme = (scheme: Theme["scheme"]) => changeTheme((r) => ({ ...r, scheme }));
export const setMotion = (motion: Theme["motion"]) => changeTheme((r) => ({ ...r, motion }));
/** Another built-in look: its palettes and style, over which the colours the person chose stay (theme.ts withLook). */
export const setLook = (look: Theme["look"]) => changeTheme((r) => withLook(r, look));

/** Signing out of a vault: the copy kept from it goes. */
export function forgetVaultTheme(vault: string) {
  if (kept()?.vault === vault) { memory = null; try { storage()?.removeItem(THEME_KEY); } catch { /* nothing kept */ } bump(); }
}
