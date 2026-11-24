// What Parachute holds of a vault, and why, in plain words, for Settings → Your Parachutes (T-476; docs/design/SCOPES.md,
// docs/ACCESS.md). One line under the vault's name says what it holds and what for; the rest is behind a tap on it.
// Pure: Settings gathers the facts (vault/reach.ts heldLevel, the grants on this device, the home).
import type { Level } from "../vault/parachute";

export type ReachFacts = {
  /** What this device holds of it at its hub: read, write, or nothing it can read (null). */
  level: Level | null;
  /** It is the home: Parachute's own applets write there, and the settings and bundles live there. */
  home: boolean;
  /** The applets allowed here on this device, by name (any order), and components from here allowed on a page. */
  applets: readonly string[];
  /** Applets are allowed here but this device hasn't read them (yet, or they are a newer app's): what they need is unknown. */
  unknown?: boolean;
  /** Applets that reach it because it is in their pick (docs/ACCESS.md proposal 5): Parachute's own that read across
   *  vaults, Journal and Capture where they keep notes, and applets allowed here that ask; by name. */
  across?: readonly string[];
  /** The person let Parachute change notes here for a change of their own. */
  own: boolean;
  /** Someone else's vault (whose.ts). */
  theirs: boolean;
};

/** "Mail", "Mail and Journal", "Mail, Journal and Rooms", "Mail, Journal and 2 more". */
export function names(list: readonly string[]): string {
  const xs = [...new Set(list)].sort((a, b) => a.localeCompare(b));
  if (xs.length <= 1) return xs[0] ?? "";
  if (xs.length <= 3) return `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  return `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`;
}

/** What it holds: the verb. */
export const holds = (level: Level | null) => (level === "write" ? "reads and changes notes" : level === "read" ? "reads notes" : "reads nothing yet");

/** What it holds it for: the home, the applets allowed there, the person's own change; else nothing (`idle`). */
export function why(f: ReachFacts): { short: string; long: string; idle: boolean } {
  if (f.home) return { short: "your home", idle: false,
    long: "Your home: your settings and bundle are kept here, and Parachute's own applets (Notes, Journal, Capture) write here." };
  const one = new Set(f.applets).size === 1;
  if (f.applets.length) return { short: `for ${names(f.applets)}`, idle: false,
    long: `${names(f.applets)} ${one ? "reaches" : "reach"} it, as you allowed on ${one ? "its card" : "their cards"}. Revoking one in Applets gives back what it needed.` };
  if (f.unknown) return { short: "for applets you allowed", idle: false,
    long: "Applets you allowed reach it; their list hasn't been read on this device yet, so they aren't named here." };
  if (f.own) return { short: "for your own changes", idle: false, long: "You let Parachute change notes here for a change of your own." };
  if (f.across?.length) { const one = new Set(f.across).size === 1; return { short: `for ${names(f.across)}`, idle: false,
    long: `${names(f.across)} ${one ? "reaches" : "reach"} it: you picked it for ${one ? "it" : "them"} (Settings → Applets, Change). Taking it out there, or signing out, takes it out of what ${one ? "it reaches" : "they reach"}.` }; }
  return { short: "no applet uses it", idle: true,
    long: "No applet you allowed uses it, and none has it in its pick: Parachute holds it because you opened it, or from an earlier sign-in. Signing out takes it off this device." };
}

/** The line under a vault's name: "reads and changes notes · your home", "Someone else's · reads notes · for Post". */
export const reachLine = (f: ReachFacts) => [f.theirs ? "Someone else's" : "", holds(f.level), why(f).short].filter(Boolean).join(" · ");

/** The sentence over a Parachute's vaults: how many it reaches here (the ones it doesn't read are counted on their own
 *  line, under them). */
export const reachCount = (held: number) => `Parachute reaches ${held} ${held === 1 ? "vault" : "vaults"} here.`;
