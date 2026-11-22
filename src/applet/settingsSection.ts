// A section of Settings from an applet (docs/WRITE-AN-APPLET.md "A section of Settings"): `fields.settings` beside its
// manifest names one of its screens and a heading; Settings draws the heading and, under it, that screen in a small
// sealed frame that only reads, in the folders its card allowed. For the small things a bundle wants a person to see
// where they look for them (Aaron, 11-22: "it was easy to see Claude usage in settings").
//
//   "settings": { "name": "Claude usage", "screen": "usage" }
//
// Additive: a build from before it leaves the field out (discovery.ts reads only what it knows) and shows nothing.
// Pure.
import { hasHidden, hasOnly, plain } from "./contract.ts";
import type { Manifest } from "./manifest.ts";

export const SETTINGS_LIMITS = { name: 40 };
/** The smallest and largest a section's frame is drawn. */
export const SECTION_MIN = 40, SECTION_MAX = 640;

export type SettingsSection = { name: string; screen: string };

/** `fields.settings`, checked against the applet's own screens: one heading, one of its screens. */
export function parseSettings(raw: unknown, m: Manifest): { ok: true; value: SettingsSection | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!plain(raw) || !hasOnly(raw, ["name", "screen"])) return { ok: false, error: "settings is { name, screen }" };
  const { name, screen } = raw;
  if (typeof name !== "string" || !name.trim() || name.length > SETTINGS_LIMITS.name || /[\n\r\t]/.test(name) || hasHidden(name)) return { ok: false, error: `settings' name is one line of ${SETTINGS_LIMITS.name} characters at most` };
  if (typeof screen !== "string" || !m.screens.some((s) => s.id === screen)) return { ok: false, error: "settings' screen is one of the applet's screens" };
  return { ok: true, value: { name: name.trim(), screen } };
}

/** Its line on the card's face, as an approval signed on another device keeps it (face.ts, approvals.ts `face`). */
export const sectionFace = (s: SettingsSection) => `Shows a section in Settings, «${s.name}»: what it reads, nothing it changes.`;

/** Whether an approval signed on another device covers this applet's section: `settings` is left out of the approval's
 *  hash (older builds agree on it), so its card's face must have said it. One from a device that didn't show it (an
 *  older build, or before the section was added) doesn't: the card asks here. */
export const approvalCoversSection = (s: SettingsSection | null | undefined, face: readonly string[] | undefined) => !s || !!face?.includes(sectionFace(s));

/** Its line on the card. */
export const settingsLine = (s: SettingsSection) => ({ text: `Show a section in Settings, «${s.name}»: what it reads, nothing it changes`, stress: false });

/** Its part of the grant's key, only when declared: every other key stays as it was. */
export const settingsKeyPart = (s: SettingsSection | null | undefined) => (s ? { name: s.name, screen: s.screen } : undefined);
