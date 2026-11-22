// A page's embeds (docs/design/EMBED.md): `fields.embeds` on an applet in a vault of the person's own. Each names a
// component (in the host's vault) or a pointer to one (in the home vault), and the props the page hands it. Each runs in
// its own sealed frame, made and spoken to only by the shell, under the page's own content; each has its own grant,
// per place. Pure.
//
//   embeds:
//     - name: events                                         # a word for it on this page
//       record: Parachute/From/techne.example/techne/component-events
//       props: { days: 7 }

import { hasHidden, hasOnly, plain } from "./contract.ts";
import { canonical as canonicalJson } from "./grant.ts";
import { sha256Hex } from "./needs.ts";
import type { Rule } from "./manifest.ts";
import { COLOR_KEYS, DEFAULT_LOOK, DEFAULT_THEME, DENSITY, DENSITY_KEYS, FONT_KEYS, LOOK_NAMES, LOOKS, type Density, type LookName } from "../theme/theme.ts";

export type Embed = { name: string; record: string; props: Record<string, unknown> };
export const MAX_EMBEDS = 8;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `fields.embeds` as a list: at most 8, each name once (a later one with a taken name is dropped), anything that
 *  isn't an embed dropped. Absent is none. */
export function parseEmbeds(raw: unknown): Embed[] {
  if (!Array.isArray(raw)) return [];
  const out: Embed[] = [];
  for (const e of raw.slice(0, 50)) {
    if (out.length >= MAX_EMBEDS) break;
    if (!plain(e) || !hasOnly(e, ["name", "record", "props"])) continue;
    if (typeof e.name !== "string" || e.name.length > 40 || !NAME.test(e.name) || out.some((x) => x.name === e.name)) continue;
    if (typeof e.record !== "string" || !e.record || e.record.length > 300 || hasHidden(e.record) || /[\u0000-\u001f]/.test(e.record)) continue;
    out.push({ name: e.name, record: e.record, props: plain(e.props) ? e.props : {} });
  }
  return out;
}

/** What an embed's grant is stored under: the place on the page (the host's vault and note, the embed's name) and the
 *  vault its component comes from (this device's key for it), so signing out of either ends it. It starts with a
 *  character no vault's key can, so no applet's grant (grants.ts `subjectOf`) can share it. */
export const embedSubject = (hostVault: string, hostNote: string, name: string, from: string) => `\u0001embed\u0000${hostVault}\u0000${hostNote}\u0000${name}\u0000${from}`;
export const isEmbedSubject = (s: string) => s.startsWith("\u0001embed\u0000");
/** The parts of an embed's subject. */
export function embedSubjectParts(s: string): { hostVault: string; hostNote: string; name: string; from: string } | null {
  if (!isEmbedSubject(s)) return null;
  const [hostVault, hostNote, name, from] = s.slice("\u0001embed\u0000".length).split("\u0000");
  return hostVault && hostNote && name && from ? { hostVault, hostNote, name, from } : null;
}
/** Does this grant belong to that vault (an applet's in it, or an embed's on a page in it or of a component from it)? */
export const grantInVault = (subject: string, vaultSubjectPrefix: string, key: string) => {
  const e = embedSubjectParts(subject);
  return e ? e.hostVault === key || e.from === key : subject.startsWith(vaultSubjectPrefix);
};

/** The grant's key for an embed: what the component is (hub, vault, record), its rules, and the props the page hands
 *  it. A change to any asks again. */
export const embedKey = (what: { hub: string; vault: string; record: string; allow: Rule[]; props: Record<string, unknown> }) =>
  sha256Hex(canonicalJson({ v: 1, kind: "embed", hub: what.hub, vault: what.vault, record: what.record, allow: what.allow.map((r) => ({ path: r.path, verbs: [...r.verbs].sort() })), props: what.props }));

/** The look an embed gets: the colours, each as #rrggbb (anything else is the built-in one), the density's values, and
 *  the app's own fonts. The theme record is free text an agent can write, so only these cross (docs/design/EMBED.md). */
export function embedTokens(t: Record<string, string>): Record<string, string> {
  const dark = t.scheme === "dark";
  const out: Record<string, string> = { scheme: dark ? "dark" : "light", density: ["compact", "regular", "roomy"].includes(t.density) ? t.density : "regular" };
  // a colour that doesn't come as hex falls back to the host's built-in look's own
  const own = LOOKS[(LOOK_NAMES as readonly string[]).includes(t.look) ? (t.look as LookName) : DEFAULT_LOOK];
  for (const k of COLOR_KEYS) {
    const v = typeof t[k] === "string" ? t[k].trim() : "";
    const six = /^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v) ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : /^#[0-9a-f]{8}$/i.test(v) ? v.slice(0, 7) : null;
    out[k] = (six ?? (dark ? own.dark : own.colors)[k]).toLowerCase();
  }
  for (const k of FONT_KEYS) out[k] = DEFAULT_THEME.fonts[k];
  for (const k of DENSITY_KEYS) out[k] = DENSITY[out.density as Density][k];
  // how the parts are drawn: a built-in look's own values, by its name (the record's own style tokens don't come along)
  const look = LOOKS[(LOOK_NAMES as readonly string[]).includes(t.look) ? (t.look as LookName) : DEFAULT_LOOK];
  Object.assign(out, look.style, dark ? look.darkStyle : {});
  out.look = (LOOK_NAMES as readonly string[]).includes(t.look) ? t.look : DEFAULT_LOOK;
  return out;
}
