// Updates outside an app store (docs/LAUNCH.md "An update channel"). A build made with PARACHUTE_UPDATE_FEED reads that
// feed (src-tauri/src/updates.rs) when the app starts, when it comes back to the front (at most every few hours) and
// when Settings opens; a newer build there is offered: one line above the bar until Later, and in Settings. Download
// opens the file in the system's browser, and the system installs it (Android takes an APK only when it is signed with
// the key of the app it replaces). The feed, beside the builds:
//   { "v": 1, "at": <the build's commit time, seconds>, "commit": "3656d68",
//     "files": { "android": "parachute-3656d68-arm64.apk", "mac": "parachute-3656d68.dmg" } }
// A file is named relative to the feed, or by an address on the feed's own origin; any other is ignored.
import { useEffect, useSyncExternalStore } from "react";
import { inShell } from "../vault/oauth";

export type Build = { at: number; commit: string };
export type Feed = Build & { files: Record<string, string> };
export type Offer = Build & { url: string };

/** The feed's words, or null when they aren't a feed. Files resolve against the feed, on its own origin only. */
export function parseFeed(body: string, feedUrl: string): Feed | null {
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { v, at, commit, files } = raw as Record<string, unknown>;
  if (v !== 1 || typeof at !== "number" || !Number.isSafeInteger(at) || at <= 0) return null;
  if (typeof commit !== "string" || !/^[0-9a-f]{7,40}$/.test(commit)) return null;
  if (!files || typeof files !== "object" || Array.isArray(files)) return null;
  let base: URL;
  try { base = new URL(feedUrl); } catch { return null; }
  const out: Record<string, string> = {};
  for (const [platform, name] of Object.entries(files as Record<string, unknown>)) {
    if (typeof name !== "string" || !name) continue;
    try {
      const u = new URL(name, base);
      if (u.origin === base.origin && (u.protocol === "https:" || u.protocol === "http:")) out[platform] = u.toString();
    } catch { /* not an address */ }
  }
  return { at, commit, files: out };
}

/** What to offer this build on this platform: the feed's build when it is later than this one and has a file here. A
 *  build not made from git (at 0) is offered nothing: it can't tell newer from older. */
export function offerFor(feed: Feed | null, own: Build, platform: string): Offer | null {
  if (!feed || own.at <= 0 || feed.at <= own.at || feed.commit === own.commit) return null;
  const url = feed.files[platform];
  return url ? { at: feed.at, commit: feed.commit, url } : null;
}

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
  if (state.kind !== "offer") set({ kind: "checking" });
  running = read().then((a) => {
    if (!a) return set({ kind: "none" });
    const offer = offerFor(parseFeed(a.body, a.feed), OWN, a.platform);
    set(offer ? { kind: "offer", offer, platform: a.platform } : { kind: "current" });
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

/** for tests */
export function resetUpdates() { state = { kind: "none" }; lastAt = 0; running = null; }
