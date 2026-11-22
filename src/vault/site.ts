// A Parachute's address as a sentence says it: its site, without a port (hosts and ports go under Details). Pure: the
// frame uses it too, so it stays apart from the store that holds sign-ins (frame/boundary.test.ts).

/** From an issuer or hub address ("https://example.org:8443" → "example.org"). */
export function siteOf(issuer: string): string { try { return new URL(issuer).hostname.replace(/^\[|\]$/g, ""); } catch { return siteOfHost(issuer); } }
/** From a host ("example.org:8443" → "example.org"). */
export const siteOfHost = (host: string) => host.replace(/:\d+$/, "");
