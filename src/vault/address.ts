// What a person types to add a vault, read as a hub and (maybe) a vault name. Pure.
//   "https://hub.example/vault/recipes"  → { issuer: "https://hub.example", vault: "recipes" }
//   "hub.example/vault/recipes/"          → the same (https is assumed when no scheme is given)
// A hub's address alone is refused with a hint: one sign-in is one vault, so the address names it.
// Anything else (a path that isn't /vault/<name>, a scheme other than http or https, credentials in the address) is refused.

export type Address = { issuer: string; vault: string };
export type AddressParse = { ok: true; address: Address } | { ok: false; error: string };

const VAULT_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function parseAddress(input: string): AddressParse {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Type the vault's address." };
  if (raw.length > 500) return { ok: false, error: "That address is too long." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That isn't a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "A vault's address starts with https://." };
  if (url.username || url.password) return { ok: false, error: "An address with a name and password in it isn't accepted." };
  if (url.search || url.hash) return { ok: false, error: "Leave out anything after ? or #." };
  const segments = url.pathname.split("/").filter(Boolean);
  // a pasted API or MCP address names the same vault
  if (segments.length >= 3 && segments[0] === "vault" && (segments[2] === "api" || segments[2] === "mcp")) segments.length = 2;
  if (segments.length === 0) return { ok: false, error: `Add the vault's name: ${url.origin}/vault/name.` };
  if (segments.length === 2 && segments[0] === "vault") {
    let name: string;
    try { name = decodeURIComponent(segments[1]); } catch { return { ok: false, error: "That vault name can't be read." }; }
    if (!VAULT_NAME.test(name)) return { ok: false, error: "That vault name can't be right: lower-case letters, digits, - and _." };
    return { ok: true, address: { issuer: url.origin, vault: name } };
  }
  return { ok: false, error: "A vault's address looks like https://your-hub/vault/name." };
}

/** The vault's API root on its hub. */
export const vaultUrl = (issuer: string, vault: string) => `${issuer}/vault/${encodeURIComponent(vault)}`;
