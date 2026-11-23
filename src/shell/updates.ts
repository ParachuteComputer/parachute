// Updates outside an app store (docs/LAUNCH.md "An update channel"). A build made with PARACHUTE_UPDATE_FEED reads that
// feed (src-tauri/src/updates.rs) when the app starts, when it comes back to the front (at most every few hours) and
// when Settings opens; a newer build there is offered: one line above the bar until Later, and in Settings. Download:
// - Android: the app downloads the APK itself (src-tauri/src/updates.rs), checks it against the feed's sha256, and hands
//   it to Android's installer (UpdatePlugin.kt), which asks the person and installs it only when it is signed with the
//   key of the app it replaces. Each try is remembered, so the next start knows whether it took (`afterTry`).
// - elsewhere (the Mac): the file opens in the system's browser, and the person installs it.
// The feed, beside the builds (scripts/update-feed.sh):
//   { "v": 1, "at": <the build's commit time, seconds>, "commit": "3656d68",
//     "files": { "android": "parachute-3656d68-arm64.apk", "mac": "parachute-3656d68.dmg" },
//     "sha256": { "android": "<64 hex>", "mac": "<64 hex>" } }
// A file is named relative to the feed, or by an address on the feed's own origin; any other is ignored. `sha256` came
// later: a feed without it still offers its files, and the app says it couldn't check the download.
import { useEffect, useSyncExternalStore } from "react";
import { inShell } from "../vault/oauth";
import { openLinkOut } from "./device";

import { offerFor, parseFeed, type Build, type Offer } from "./feed.ts";
export { offerFor, parseFeed, type Build, type Feed, type Offer } from "./feed.ts";

/** "21 Nov" (and the year when it isn't this one) */
export function builtOn(at: number, today = new Date()): string {
  const d = new Date(at * 1000);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

// ── the check, shared by the line above the bar and Settings ──

export type UpdateState =
  | { kind: "none" }                   // this build has no feed (or isn't in the app's shell)
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "offer"; offer: Offer; platform: string }
  | { kind: "error"; message: string };

export const OWN: Build = typeof __BUILD__ === "undefined" ? { at: 0, commit: "" } : __BUILD__;
/** At most this often by itself (Settings checks whenever it opens). */
const EVERY_MS = 6 * 3600_000;
const LATER_KEY = "parachute.update.later";

let state: UpdateState = { kind: "none" };
let lastAt = 0;
let running: Promise<void> | null = null;
const subs = new Set<() => void>();
const set = (s: UpdateState) => { state = s; for (const f of subs) f(); };

type Answer = { feed: string; body: string; platform: string } | null;
/** Reads the feed (`force`: whatever the time since the last read). Never throws. */
export function checkUpdates(force = false, read: () => Promise<Answer> = nativeFeed): Promise<void> {
  if (running) return running;
  if (!force && Date.now() - lastAt < EVERY_MS) return Promise.resolve();
  lastAt = Date.now();
  const before = state.kind === "offer" ? state.offer.commit : "";
  if (state.kind !== "offer") set({ kind: "checking" });
  running = read().then((a) => {
    if (!a) return set({ kind: "none" });
    const offer = offerFor(parseFeed(a.body, a.feed), OWN, a.platform);
    set(offer ? { kind: "offer", offer, platform: a.platform } : { kind: "current" });
    // a refusal was about the build offered then
    if (installNow().install.kind === "failed" && offer?.commit !== before) setInst({ kind: "idle" });
  }, (e: unknown) => {
    // a failed read doesn't take back an offer already made (offline in Settings, the newer build is still there)
    if (state.kind !== "offer") set({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  }).finally(() => { running = null; });
  return running;
}
async function nativeFeed(): Promise<Answer> {
  if (!inShell()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Answer>("update_feed");
}

export const updateNow = () => state;
export function onUpdate(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export const useUpdate = () => useSyncExternalStore(onUpdate, updateNow);

/** The build the person put off with Later: the line above the bar stays away until a later one. */
export const laterAt = () => { try { return Number(localStorage.getItem(LATER_KEY)) || 0; } catch { return 0; } };
export function putOff(at: number) { try { localStorage.setItem(LATER_KEY, String(at)); } catch { /* private mode */ } set({ ...state }); }

/** Checks at start and whenever the app comes back to the front (at most every few hours). */
export function useUpdateChecks() {
  useEffect(() => {
    void checkUpdates();
    const back = () => { if (document.visibilityState === "visible") void checkUpdates(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);
}

// ── Download, and whether the install took ──

/** Where a Download is. `checked`: the file matched the feed's sha256 (false: the feed has none for it). */
export type Install =
  | { kind: "idle" }
  | { kind: "downloading"; got: number; total: number }  // total 0: the server didn't say
  | { kind: "installing"; checked: boolean }             // with Android's installer, which asks the person
  | { kind: "failed"; message: string; browser?: boolean };  // browser: the download itself failed, so the browser's may work

/** An install handed to Android, kept across starts: from this build to the feed's. `why`: Android's refusal, if it
 *  gave one before the app closed. */
export type Tried = { from: string; to: string; toAt: number; when: number; why?: string };
/** What the last try came to, seen from this build (`to`: the build tried). */
export type After = { kind: "none" } | { kind: "updated"; at: number } | { kind: "stuck"; to: string; at: number; why: string };

/** This build is the one tried: updated. Still the build it was tried from: stuck. Another (installed some other way):
 *  nothing to say. */
export function afterTry(t: Tried | null, own: Build): After {
  if (!t) return { kind: "none" };
  if (own.commit === t.to) return { kind: "updated", at: t.toAt };
  if (own.commit === t.from) return { kind: "stuck", to: t.to, at: t.toAt, why: t.why ?? "" };
  return { kind: "none" };
}

const TRIED_KEY = "parachute.update.tried";
function readTried(): Tried | null {
  try {
    const t = JSON.parse(localStorage.getItem(TRIED_KEY) ?? "null") as Tried | null;
    return t && typeof t.from === "string" && typeof t.to === "string" && typeof t.toAt === "number" ? t : null;
  } catch { return null; }
}

type Installing = { install: Install; after: After };
let inst: Installing | null = null;  // read from storage on first use
const instSubs = new Set<() => void>();
const installNow = (): Installing => (inst ??= { install: { kind: "idle" }, after: afterTry(readTried(), OWN) });
const publish = (next: Installing) => { inst = next; for (const f of instSubs) f(); };
const setInst = (install: Install) => publish({ ...installNow(), install });
function writeTried(t: Tried) {
  try { localStorage.setItem(TRIED_KEY, JSON.stringify(t)); } catch { /* private mode */ }
  publish({ ...installNow(), after: afterTry(t, OWN) });
}
export const useInstall = () => useSyncExternalStore((f) => { instSubs.add(f); return () => { instSubs.delete(f); }; }, installNow);

/** What the shell says while it downloads and installs (src-tauri/src/updates.rs `Step`): the build it hands Android is
 *  the one the feed names when it reads it, which may be later than the offer on screen. */
export type Step = { stage: "download"; got: number; total: number } | { stage: "install"; checked: boolean; commit: string; at: number };
type Native = (step: (s: Step) => void) => Promise<void>;

/** "12 MB" */
export const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`;
/** "40%", or "12 MB" when the server didn't say how much */
export const share = (got: number, total: number) => total > 0 ? `${Math.min(100, Math.floor((got / total) * 100))}%` : mb(got);

let tries = 0;
/** Download: on Android, the app's own download of what the feed names and Android's installer (a second Download
 *  while Android's question is open replaces the first); elsewhere, the browser. Never throws: a failure is the
 *  `failed` state, in words to show. */
export async function download(offer: Offer, platform: string, native: Native = nativeInstall): Promise<void> {
  if (platform !== "android") {
    try { await openLinkOut(offer.url); setInst({ kind: "idle" }); }
    catch (e) { setInst({ kind: "failed", message: e instanceof Error ? e.message : String(e) }); }
    return;
  }
  if (installNow().install.kind === "downloading") return;
  const mine = ++tries;
  const now = (i: Install) => { if (mine === tries) setInst(i); };  // a replaced try says nothing more
  now({ kind: "downloading", got: 0, total: 0 });
  let handed: Tried | null = null;
  let whole = false;  // every byte arrived: a failure after that is the file (its sum, its maker), not the way to it
  try {
    await native((s) => {
      if (s.stage === "download") { whole = s.total > 0 && s.got >= s.total; return now({ kind: "downloading", got: s.got, total: s.total }); }
      handed = { from: OWN.commit, to: s.commit, toAt: s.at, when: Date.now() };
      if (mine === tries) writeTried(handed);
      now({ kind: "installing", checked: s.checked });
    });
    // Android installed it (the app is usually closed by then, and the next start says so)
    now({ kind: "idle" });
  } catch (e) {
    if (mine !== tries) return;
    const message = e instanceof Error ? e.message : String(e);
    if (handed) writeTried({ ...(handed as Tried), why: message });
    setInst({ kind: "failed", message, browser: !handed && !whole });
  }
}
async function nativeInstall(step: (s: Step) => void): Promise<void> {
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  const onStep = new Channel<Step>();
  onStep.onmessage = step;
  await invoke("update_install", { onStep });
}

/** for tests */
export function resetUpdates() { state = { kind: "none" }; lastAt = 0; running = null; inst = null; tries = 0; }
export const installState = installNow;
