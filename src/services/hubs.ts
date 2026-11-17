// The Parachute hubs the person uses, as the web side knows them: the hubs of the vaults on this device and the ones
// their settings list. No applet reaches one as a service (docs/design/SERVICES.md); the native side checks again at each
// signed request, with the hubs it signed in to and a probe of the origin.
import { listVaults, originOf } from "../vault/store";
import { settingsNow } from "../shell/homeSettings";

/** An origin made comparable: lower case, no trailing dot on the host. */
export function plainOrigin(origin: string): string {
  try { const u = new URL(origin); u.hostname = u.hostname.replace(/\.$/, ""); return u.origin; } catch { return origin.toLowerCase(); }
}

export function knownHubs(): string[] {
  const hubs = [...listVaults().map((v) => originOf(v.issuer)), ...settingsNow().hubs.map((h) => h.hub)];
  return [...new Set(hubs.filter(Boolean).map(plainOrigin))];
}

export const isKnownHub = (origin: string): boolean => knownHubs().includes(plainOrigin(origin));
