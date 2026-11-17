// What every address the app reads shares: a vault's name, and this machine (where plain http is allowed: a hub run for
// development or tests). Parachute addresses themselves are read in parachute.ts; links in links/parse.ts.

export const VAULT_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The most vaults one sign-in brings (each is a page load of its own sign-in). */
export const MAX_VAULTS = 60;
/** Vault names as a hub lists them, made safe to use: only names a vault can have, each once, sorted, at most
 *  MAX_VAULTS. The key path (the shell's list) and the page path read them alike. */
export const cleanVaultNames = (names: readonly unknown[]): string[] =>
  [...new Set(names.filter((n): n is string => typeof n === "string" && VAULT_NAME.test(n)))].sort().slice(0, MAX_VAULTS);

/** This machine itself: plain http is allowed only here (a hub run for development or tests). */
export const isLoopback = (host: string) => host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
