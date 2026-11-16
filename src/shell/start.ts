// Open on start (docs/NAVIGATION.md). When the app starts on the launcher and the person's settings name a home applet,
// the shell opens that applet's address instead, before the first screen is drawn. The settings note is theirs and their
// agent's to write, so it alone never starts code: the applet runs by itself only when this device holds both
//   - the person's Allow for its code (its card, as for any applet), and
//   - their choice of it as home, made here (a tap: the long-press "Open on start", or Open / Allow on the screen a start
//     led to).
// Otherwise the applet's screen shows its card, or waits, stopped, with Open; that tap is the choice.
import { gateNow, whenGateKnown } from "../applet/selftest/run";
import { barNow, readSettings } from "./homeSettings";

export const START_KEY = "parachute.start.v1";
/** How long the app waits for the settings note before it decides from the copy it kept. */
export const START_WAIT_MS = 1500;

type Chosen = { vault: string; noteId: string };
const storage = () => (typeof localStorage === "undefined" ? null : localStorage);
function chosen(): Chosen | null {
  try { const v = JSON.parse(storage()?.getItem(START_KEY) ?? "null") as Chosen | null; return v && typeof v.vault === "string" && typeof v.noteId === "string" ? v : null; } catch { return null; }
}
/** The person chose this applet as home, on this device. */
export function chooseStart(vault: string, noteId: string) { try { storage()?.setItem(START_KEY, JSON.stringify({ vault, noteId })); } catch { /* this session only */ } }
/** Signing out of a vault forgets a home chosen in it. */
export function forgetVaultStart(vault: string) { const c = chosen(); if (c?.vault === vault) forgetStart(); }
export function forgetStart() { try { storage()?.removeItem(START_KEY); } catch { /* nothing kept */ } }
export const startChosenHere = (vault: string, noteId: string) => { const c = chosen(); return !!c && c.vault === vault && c.noteId === noteId; };

type Arrival = { path: string; chosen: boolean; vault: string; noteId: string };
/** The address a start led to, this session, and whether it was chosen here. Taken once by the applet's screen. */
let arrival: Arrival | null = null;
/** For the applet screen: was this address reached by a start? `chosen`: the person chose it as home on this device. */
export function takeStart(path: string): { chosen: boolean; vault: string; noteId: string } | null {
  const a = arrival && arrival.path === path ? arrival : null;
  arrival = null;
  return a;
}

/** Where the app opens: the home applet, or null for the launcher. Waits for the settings note a moment. Call
 *  `go` only if the app is still where it started (a link from outside may have moved it meanwhile). */
export async function startPlace(): Promise<{ href: string; go(): void } | null> {
  arrival = null;
  await Promise.race([Promise.all([readSettings(), whenGateKnown()]), new Promise((r) => setTimeout(r, START_WAIT_MS))]);
  if (gateNow() === "closed") return null;
  const s = barNow().start;
  if (!s) return null;
  const a: Arrival = { path: s.href, chosen: startChosenHere(s.vault, s.noteId), vault: s.vault, noteId: s.noteId };
  return { href: s.href, go: () => { arrival = a; } };
}
