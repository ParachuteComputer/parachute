// The grant (from the Uni app's src/interface/grant2.ts, for sealed applets only): what an applet's card shows, what
// the person's Allow covers, and what the runtime checks, as one value. `opens` is part of it: adding or changing what
// an applet opens asks again, and the card says it. Pure.

import { inScope, stripExt } from "./contract.ts";
import type { Manifest, Reach, Rule, Verb } from "./manifest.ts";
import type { Opens } from "./opens.ts";
import { sha256Hex } from "./needs.ts";
import { appLines, type AppWord } from "./app.ts";
import { hostLine, serviceLines, servicesKeyPart, type LineOptions, type Service } from "./services.ts";
import { signalLines, signalsKeyPart, type Signal } from "./signals.ts";
import { settingsKeyPart, settingsLine, type SettingsSection } from "./settingsSection.ts";
import { techneKeyPart, techneLines, techneOutLine, type Techne } from "./techne.ts";

/** The card's line for a page whose embeds come from someone else's vaults ("techne at techne.example"). */
export function embedsLine(from: readonly string[]): string | null {
  if (!from.length) return null;
  const names = [...new Set(from.map((f) => f.split(" at ")[0]))];
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return from.length === 1
    ? `Shows things from ${list} (someone else's) on its page. What it reads here could reach ${list}.`
    : `Shows things from ${list} on its page. What it reads here, and what they read, could pass between them.`;
}

export type Grant = {
  applet: { id: string; name: string };
  /** The vault the applet's note lives in: the only one it reaches. */
  vault: string;
  allow: Rule[];
  opens: Opens[];
  /** What it may ask of the app beyond its vault (app.ts). */
  app: AppWord[];
  /** The other vaults its page's embeds come from, by name and host (docs/design/EMBED.md): on its card, and in its key. */
  embedsFrom?: string[];
  /** The servers it reaches through the shell (docs/design/SERVICES.md): on its card, and in its key. */
  services?: Service[];
  /** The manifest's `reach` (the microphone, docs/design/KEYRING.md): on its card, and in its key, only when named. */
  reach?: Reach[];
  /** What it counts for the bar and where the count goes (signals.ts): on its card, and in its key, only when declared. */
  signals?: Signal[];
  /** A section of Settings it draws (settingsSection.ts): on its card, and in its key, only when declared. */
  settings?: SettingsSection;
  /** What it may do as the person on Techne (techne.ts, docs/design/TECHNE.md): on its card, and in its key, only when declared. */
  techne?: Techne;
};

/** How long a grant lasts before the card comes back. */
export const GRANT_DAYS = 365;
export const grantExpiry = (from: Date): Date => new Date(from.getTime() + GRANT_DAYS * 86_400_000);

export const grantOf = (m: Manifest, vault: string, opens: readonly Opens[], app: readonly AppWord[] = [], services: readonly Service[] = [], signals: readonly Signal[] = [], settings?: SettingsSection | null, techne?: Techne | null): Grant =>
  ({ applet: { id: m.id, name: m.name }, vault, allow: m.allow.map((r) => ({ path: r.path, verbs: [...r.verbs] })), opens: opens.map((o) => ({ ...o })), app: [...app], ...(services.length ? { services: services.map((s) => ({ ...s })) } : {}), ...(m.reach?.length ? { reach: [...m.reach] } : {}),
    ...(signals.length ? { signals: signals.map((s) => ({ ...s })) } : {}), ...(settings ? { settings: { ...settings } } : {}), ...(techne ? { techne: { at: techne.at, can: [...techne.can] } } : {}) });

/** A note's path as a rule may judge it: plain segments only, no percent-encoded dot, slash, backslash or percent. */
const plainPath = (path: unknown): path is string => typeof path === "string" && !/%(?:2e|2f|5c|25)/i.test(path) && inScope([""], path);

/** May the applet do `verb` to the note at `path`? Judged on the note itself. */
export function allowsNote(g: Grant, verb: Verb, path: string | null | undefined): boolean {
  return plainPath(path) && g.allow.some((r) => r.verbs.includes(verb) && inScope([r.path], path));
}

// ── the card ──

/** One row of the card: where, and what there. `stress`: it changes something, or reaches outside its own folder. */
export type CardLine = { text: string; stress: boolean };

const VERB_WORDS: Record<Verb, string> = { read: "Read", create: "Add", update: "Change" };
const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The card's rows, every word the app's. `ownFolder`: the folder the applet's note lives in, or null at the top. */
export function grantLines(g: Grant, ownFolder: string | null, keyring: LineOptions = {}): CardLine[] {
  const out: CardLine[] = [];
  for (const r of g.allow) {
    // as in the Uni app: a folder outside the one its note lives in (every folder, for a note at the top) is stressed
    const outside = !(ownFolder && r.path.startsWith(ownFolder));
    const verbs = joinWords(r.verbs.map((v, i) => (i ? VERB_WORDS[v].toLowerCase() : VERB_WORDS[v])));
    out.push(r.verbs.length === 1 && r.verbs[0] === "read" && outside
      ? { text: `Read notes outside its own folder, in ${r.path}`, stress: true }
      : { text: `${verbs} notes in ${r.path}`, stress: outside || r.verbs.some((v) => v !== "read") });
  }
  for (const o of g.opens) {
    out.push({ text: `Open ${o.type} notes in ${o.path} when you tap one`, stress: false });
    if (g.allow.some((r) => r.verbs.includes("create") && (r.path.startsWith(o.path) || o.path.startsWith(r.path)))) out.push({ text: `Tag the notes it adds in ${o.path} as ${o.type}`, stress: false });
  }
  out.push(...appLines(g.app));
  if (g.reach?.includes("voice")) out.push({ text: "Record from your microphone when you press record (the app shows its own recorder)", stress: false });
  out.push(...serviceLines(g.services ?? [], keyring));
  if (g.techne) out.push(...techneLines(g.techne));
  // what it reads as the person on Techne could leave through a server it declares: said, as for its notes
  if (g.techne?.can.includes("read") && g.services?.length) out.push(techneOutLine([...new Set(g.services.map(hostLine))]));
  out.push(...signalLines(g.signals ?? []));
  if (g.settings) out.push(settingsLine(g.settings, g.applet.name));
  const page = embedsLine(g.embedsFrom ?? []);
  if (page) out.push({ text: page, stress: true });
  return out;
}

// ── the key ──

/** Canonical JSON: sorted keys, no spaces. */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object") return `{${Object.keys(x).sort().filter((k) => (x as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(x ?? null);
}

/** SHA-256 of what is granted, where the applet's note is, and what it opens. The name is not in it: a rename changes nothing it can reach. */
export function grantKey(g: Grant, notePath: string): Promise<string> {
  const allow = [...new Set(g.allow.map((r) => canonical({ path: r.path, verbs: [...r.verbs].sort() })))].sort();
  const opens = [...new Set(g.opens.map((o) => canonical({ type: o.type, path: o.path, screen: o.screen })))].sort();
  // `app` only when it asks something: the keys of applets that ask nothing of the app stay as they were
  const app = g.app?.length ? [...new Set(g.app)].sort() : undefined;
  // only when its page shows things from someone else's vaults: every other key stays as it was
  const embeds = g.embedsFrom?.length ? [...new Set(g.embedsFrom)].sort() : undefined;
  // only when it reaches servers: every other key stays as it was
  const services = g.services?.length ? servicesKeyPart(g.services) : undefined;
  // only when it reaches the microphone: every other key stays as it was
  const reach = g.reach?.length ? [...new Set(g.reach)].sort() : undefined;
  // only when it declares signals: every other key stays as it was
  const signals = g.signals?.length ? signalsKeyPart(g.signals) : undefined;
  // only when it draws a section of Settings: every other key stays as it was
  const settings = settingsKeyPart(g.settings, g.applet.name);
  // only when it acts on Techne: every other key stays as it was
  const techne = techneKeyPart(g.techne);
  return sha256Hex(canonical({ v: 3, note: stripExt(notePath), applet: g.applet.id, vault: g.vault, allow, opens, app, embeds, services, reach, signals, settings, techne }));
}

/** "9b13 b2ae": the first eight digits of the key, to tell two cards apart. */
export const fingerprint = (key: string): string => `${key.slice(0, 4)} ${key.slice(4, 8)}`;
