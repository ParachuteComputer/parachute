// What every address the app reads shares: a vault's name, and this machine (where plain http is allowed: a hub run for
// development or tests). Parachute addresses themselves are read in parachute.ts; links in links/parse.ts.

export const VAULT_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** This machine itself: plain http is allowed only here (a hub run for development or tests). */
export const isLoopback = (host: string) => host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
