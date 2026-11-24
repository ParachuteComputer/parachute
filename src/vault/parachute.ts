// A Parachute: one hub a person signs in to once (docs/design/ONE-SIGN-IN.md). What a person types to name one, what the
// hub says about itself, and the vaults the person may reach there.
//
//   "uni.example", "https://uni.example", "https://uni.example/vault/notes"  → the hub at https://uni.example
// The hub describes itself at /.well-known/parachute-account (core 0.8, 0.9 and Cloud): its OAuth issuer, its account
// MCP (where `list-vaults` answers which vaults the person may reach) and where its vaults live.
import { cleanVaultNames, isLoopback, isVaultName, MAX_VAULTS } from "./address";

export const CLOUD = "https://cloud.parachute.computer";
export const CLOUD_NAME = "Parachute Cloud";

export type HubParse = { ok: true; hub: string } | { ok: false; error: string };

/** A Parachute's address, from what a person typed or a record says: its origin (https, or http on this machine). */
export function parseHub(input: string): HubParse {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Type your Parachute's address." };
  if (raw.length > 500) return { ok: false, error: "That address is too long." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That isn't a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "A Parachute's address starts with https://." };
  // tokens never travel in the clear: plain http only to this machine itself
  if (url.protocol === "http:" && !isLoopback(url.hostname)) return { ok: false, error: "A Parachute's address starts with https://." };
  if (url.username || url.password) return { ok: false, error: "An address with a name and password in it isn't accepted." };
  if (!url.hostname || !/[a-z0-9]/i.test(url.hostname)) return { ok: false, error: "That isn't a web address." };
  return { ok: true, hub: url.origin };
}

/** What a hub says about itself: where to sign in, where to ask which vaults are the person's, where vaults live.
 *  Tokens go to those addresses, so they must be on the hub's own origin; only Parachute Cloud keeps its vaults and
 *  account on another host of its own domain (cloud.parachute.computer → my.parachute.computer). */
export type Parachute = { hub: string; issuer: string; accountMcp: string; vaultTemplate: string;
  /** "cloud": the hub says it is Parachute Cloud (its descriptor's `door`), which keeps the name "Parachute" for its own
   *  pages: the app registers there under another (oauth.ts cloudClientName: "Vault app on Android", "on a Mac"…) */
  door?: "cloud";
  /** The id the hub reserves for the Parachute app (its descriptor's `app_client_id`, Parachute Cloud's `parachute-app`):
   *  the app on a device signs in under it, named Parachute, instead of registering itself (oauth.ts). */
  appClientId?: string;
  /** The one address an AI gets (its descriptor's `mcp_endpoint`, core 0.9.1 on, T-476): `<hub>/mcp`, every vault the
   *  person lets it reach. */
  mcp?: string;
  /** The hub's descriptor named `account_mcp_endpoint` itself (rather than the app taking the path for granted). */
  accountMcpListed?: boolean };

/** Where an AI connects to every vault the person lets it reach on this hub, or null when it only takes one vault per
 *  address. The hub's one address (`mcp_endpoint`); else, on a hub (not Parachute Cloud, whose account door doesn't carry
 *  the vault's tools yet), its account door, which asks the same of the person; else none, and each vault's own
 *  `<vault>/mcp` is the address (docs/design/VERSIONS.md: older hubs). */
export const oneAddress = (p: Parachute): string | null => p.mcp ?? (p.door !== "cloud" && p.accountMcpListed ? p.accountMcp : null);

/** https, or http on this machine. */
const safe = (raw: unknown): raw is string => {
  if (typeof raw !== "string" || raw.length > 500) return false;
  try { const u = new URL(raw); return !u.username && !u.password && (u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname))); } catch { return false; }
};

const onHubOrDomain = (raw: string, hub: string) => {
  const u = new URL(raw);
  if (u.origin === hub) return true;
  return hub === CLOUD && u.protocol === "https:" && u.hostname.endsWith(".parachute.computer");
};

/** Read the hub's own description; a hub with none (older than 0.8) is read as one that keeps everything on its origin. */
export async function describe(hub: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<Parachute> {
  const plainHub: Parachute = { hub, issuer: hub, accountMcp: `${hub}/account/mcp`, vaultTemplate: `${hub}/vault/{name}` };
  let res: Response;
  try {
    res = await fetchImpl(`${hub}/.well-known/parachute-account`, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("The hub didn't answer at that address.");
  }
  if (res.status === 404) return plainHub;
  if (!res.ok) throw new Error(`The hub didn't say what it is (${res.status}).`);
  let d: Record<string, unknown>;
  try { d = await res.json() as Record<string, unknown>; } catch { throw new Error("The hub's answer about itself couldn't be read."); }
  // the hub must name itself as the address typed: a description that sends the sign-in elsewhere is refused
  let issuer = "";
  try { issuer = new URL(String(d.issuer)).origin; } catch { /* refused below */ }
  if (issuer !== hub) throw new Error(`That hub calls itself ${String(d.issuer).slice(0, 80)}, not ${hub}. Nothing was added.`);
  const accountMcp = safe(d.account_mcp_endpoint) && onHubOrDomain(d.account_mcp_endpoint, hub) ? d.account_mcp_endpoint : plainHub.accountMcp;
  const vaultTemplate = safe(d.vault_url_template) && (d.vault_url_template as string).includes("{name}") && onHubOrDomain(d.vault_url_template.replace("{name}", "x"), hub) ? d.vault_url_template as string : plainHub.vaultTemplate;
  const appClientId = typeof d.app_client_id === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(d.app_client_id) ? d.app_client_id : null;
  // an address a person copies into their AI is taken only as the hub wrote it in its plain form: no spaces, line
  // breaks or other text after it (what a URL parser would quietly drop or rewrite)
  const plainUrl = (raw: string) => { try { return new URL(raw).href === raw; } catch { return false; } };
  const accountMcpListed = accountMcp === d.account_mcp_endpoint && plainUrl(accountMcp);
  const mcp = safe(d.mcp_endpoint) && onHubOrDomain(d.mcp_endpoint, hub) && plainUrl(d.mcp_endpoint) ? d.mcp_endpoint : null;
  return { hub, issuer, accountMcp, vaultTemplate, ...(d.door === "cloud" ? { door: "cloud" as const } : {}), ...(appClientId ? { appClientId } : {}),
    ...(mcp ? { mcp } : {}), ...(accountMcpListed ? { accountMcpListed } : {}) };
}

/** A vault's API root, from where the Parachute says its vaults live. */
export const vaultUrlFrom = (template: string, name: string) => template.replace("{name}", encodeURIComponent(name)).replace(/\/$/, "");

/** A JSON-RPC answer from an MCP door: JSON, or one server-sent event carrying it (`data: {…}`). */
export function rpcAnswer(text: string): unknown {
  const json = text.trimStart().startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "";
  try { return JSON.parse(json); } catch { throw new Error("The hub's list of your vaults couldn't be read."); }
}

/** The vaults the hub lists for the person, and whether they are every vault on it (`covered: "all"`: the person runs
 *  the hub) rather than the ones given to them. `home`: the one that holds their settings or app record, when the sign-in
 *  could ask (homeFrom). */
export type Listed = { vaults: string[]; all: boolean; home?: string | null };

/** What the hub answered to `list-vaults` (a JSON-RPC result whose text is JSON). Only names a vault can have, each once,
 *  sorted; at most MAX_VAULTS. */
export function listFrom(body: unknown): Listed {
  const r = body as { result?: { isError?: boolean; content?: { type?: string; text?: string }[] }; error?: unknown } | null;
  if (!r || r.error || r.result?.isError) throw new Error("The hub didn't list your vaults.");
  const text = r.result?.content?.find((c) => c.type === "text")?.text;
  let parsed: { vaults?: { name?: unknown }[]; covered?: unknown };
  try { parsed = JSON.parse(text ?? "") as typeof parsed; } catch { throw new Error("The hub's list of your vaults couldn't be read."); }
  return { vaults: cleanVaultNames((Array.isArray(parsed.vaults) ? parsed.vaults : []).map((v) => v?.name)), all: parsed.covered === "all" };
}

/** The one call that lists the person's vaults: `list-vaults` on the hub's account MCP. */
export const LIST_VAULTS_BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list-vaults", arguments: {} } });

/** The tags of the records that make a vault the person's home: their settings (homeSettings.ts), else their app record
 *  (apps.ts; `parachute-app`, being renamed `parachute-bundle`). */
export const HOME_TAGS = ["parachute-settings", "parachute-app", "parachute-bundle"] as const;
/** The second call a sign-in makes on the account MCP, beside the listing: which of the person's vaults hold those
 *  records (`query-notes` across every vault the token reaches, at most 50 rows each: the hub's lean rows, with path,
 *  tags and a short preview, no content and no fields). The key signs this same body (src-tauri/src/door.rs). */
export const HOME_RECORDS_BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "query-notes", arguments: { tag: [...HOME_TAGS], include_content: false, include_metadata: false, limit: 50 } } });

/** Of `among`, the one vault that holds the person's settings, else the one that holds an app record; null when none
 *  does, when two do (a hub the person runs may hold someone else's settings too: they pick), or when the answer can't
 *  be read. A vault the hub couldn't read answers with an error and is passed over. */
export function homeFrom(body: unknown, among: readonly string[]): string | null {
  try {
    const r = body as { result?: { isError?: boolean; content?: { type?: string; text?: string }[] } } | null;
    if (!r?.result || r.result.isError) return null;
    const text = r.result.content?.find((c) => c.type === "text")?.text;
    const parsed = JSON.parse(text ?? "") as { results?: { vault?: unknown; notes?: unknown }[] };
    const settings = new Set<string>(), apps = new Set<string>();
    for (const v of Array.isArray(parsed.results) ? parsed.results : []) {
      if (typeof v?.vault !== "string" || !among.includes(v.vault)) continue;
      // each vault's answer: its rows, or { notes: rows } (core 0.9)
      const rows = Array.isArray(v.notes) ? v.notes : Array.isArray((v.notes as { notes?: unknown } | null)?.notes) ? (v.notes as { notes: unknown[] }).notes : [];
      for (const n of rows as { tags?: unknown }[]) {
        const tags = Array.isArray(n?.tags) ? n.tags : [];
        if (tags.includes(HOME_TAGS[0])) settings.add(v.vault);
        else if (tags.includes(HOME_TAGS[1]) || tags.includes(HOME_TAGS[2])) apps.add(v.vault);
      }
    }
    const one = (s: Set<string>) => (s.size === 1 ? [...s][0] : null);
    return settings.size ? one(settings) : one(apps);
  } catch { return null; }
}

/** One fixed call to the hub's account MCP with an account token: its answer. */
async function postAccount(accountMcp: string, token: string, body: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Response> {
  return fetchImpl(accountMcp, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body, ...(signal ? { signal } : {}) });
}

/** Which of `among` is the person's home, asked with the sign-in's account token (homeFrom). Never throws, and gives up
 *  after a few seconds: the sign-in goes on with the first by name. */
export async function homeWithToken(accountMcp: string, token: string, among: readonly string[], fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<string | null> {
  try {
    const res = await postAccount(accountMcp, token, HOME_RECORDS_BODY, fetchImpl, AbortSignal.timeout(HOME_WAIT_MS));
    return res.ok ? homeFrom(rpcAnswer(await res.text()), among) : null;
  } catch { return null; }
}
/** How long a sign-in waits to learn which vault is the home. */
export const HOME_WAIT_MS = 4000;

/** List the person's vaults with an account token (the sign-in without a key). */
export async function listWithToken(accountMcp: string, token: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<Listed> {
  const res = await postAccount(accountMcp, token, LIST_VAULTS_BODY, fetchImpl);
  if (!res.ok) throw new Error(`The hub didn't list your vaults (${res.status}).`);
  return listFrom(rpcAnswer(await res.text()));
}

/** Does the person reach every vault on the hub (they run it)? The hub's public list of its vaults
 *  (`/.well-known/parachute.json`, core 0.8 and 0.9; Cloud has none) against theirs. Without that list: no. */
export async function reachesEvery(hub: string, theirs: readonly string[], fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<boolean> {
  const every = await everyVault(hub, fetchImpl);
  // a list cut at MAX_VAULTS can't show it covers every vault: asked, rather than taken as the person's
  return !!every && every.length > 1 && (theirs.length >= MAX_VAULTS || every.every((n) => theirs.includes(n)));
}

/** Every vault on the hub, from its public list (`/.well-known/parachute.json`, core 0.8 and 0.9; Cloud has none):
 *  names a vault can have, each once. Null when the hub has no such list or didn't answer. */
export async function everyVault(hub: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${hub}/.well-known/parachute.json`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const d = (await res.json()) as { vaults?: { name?: unknown }[] };
    return [...new Set((Array.isArray(d.vaults) ? d.vaults : []).map((v) => v?.name).filter(isVaultName))];
  } catch { return null; }
}

/** How much of one vault the app asks a hub for (docs/design/SCOPES.md): `read` (every note in it), or `write` (read,
 *  and add, change and delete notes). The hub narrows no further: folders are the app's own rule. */
export type Level = "read" | "write";
/** The scope that asks for one vault at one level: read, or read and write. Never more than one vault: each vault is
 *  asked for when something the person allows needs it. */
export const scopeFor = (vault: string, level: Level) => (level === "write" ? `vault:${vault}:read vault:${vault}:write` : `vault:${vault}:read`);
/** What a token's scope holds of a vault: write, read, or nothing. As granted (the hub may give read where write was
 *  asked: the person holds only read there). */
export function levelIn(scope: string | undefined, vault: string): Level | null {
  const words = new Set((scope ?? "").split(/\s+/));
  // (a record kept from an older sign-in may hold the vault-wide words, `vault:write`, that its audience pins)
  if (words.has(`vault:${vault}:write`) || words.has(`vault:${vault}:admin`) || words.has("vault:write") || words.has("vault:admin")) return "write";
  return words.has(`vault:${vault}:read`) || words.has("vault:read") ? "read" : null;
}
/** Does `held` cover `need`? */
export const covers = (held: Level | null, need: Level) => held === "write" || (held === "read" && need === "read");
/** The scope that asks only to see which vaults are the person's: the un-narrowed account-vaults scope, which core 0.8
 *  and 0.9 and Parachute Cloud all take (Cloud refuses `account:self:vaults`: `self` isn't an account id there). */
export const LIST_SCOPE = "account:vaults";
/** Does a token's scope let it list the person's vaults? As granted: `account:vaults`, `account:<id>:vaults` (0.8,
 *  Cloud), or per vault, `account:<id>:vaults:<vault>:<verb>` (0.9). */
export const canList = (scope: string | undefined) => (scope ?? "").split(/\s+/).some((w) => w === LIST_SCOPE || /^account:[^:\s]+:vaults(:|$)/.test(w));
/** Can a sign-in's account token make a vault? Parachute Cloud grants it as `account:<id>:vault-create` when the person
 *  leaves "Create new vaults" ticked on its page (a person with no vault yet is offered it there, T-476). */
export const canCreate = (scope: string | undefined) => (scope ?? "").split(/\s+/).some((w) => /^account:[^:\s]+:vault-create$/.test(w));

/** The hub said no, in its own words (a name taken, the plan's limit): the person can answer it and try again. */
export class HubRefused extends Error {}

/** Make a vault with the sign-in's account token (the account door's `create-vault`). Resolves to its name as the hub
 *  made it; throws HubRefused in the hub's own words when it refuses, a plain Error when its answer can't be read. */
export async function createWithToken(accountMcp: string, token: string, name: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<string> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create-vault", arguments: { name } } });
  // a hub that never answers ends the step (signInFlow firstVault) rather than holding "Making it…" for good
  const res = await postAccount(accountMcp, token, body, fetchImpl, AbortSignal.timeout(20_000));
  if (!res.ok) throw new Error(`The hub didn't make the vault (${res.status}).`);
  let a: { error?: { message?: unknown }; result?: { isError?: boolean; content?: { text?: unknown }[] } };
  try { a = rpcAnswer(await res.text()) as typeof a; } catch { throw new Error("The hub's answer couldn't be read."); }
  const said = (m: unknown) => (typeof m === "string" && m.trim() ? m.replace(/^Error:\s*/, "").slice(0, 200) : "The hub didn't make the vault.");
  if (a?.error) throw new HubRefused(said(a.error.message));
  const text = a?.result?.content?.[0]?.text;
  if (a?.result?.isError) throw new HubRefused(said(text));
  let made: unknown;
  try { made = (JSON.parse(String(text)) as { name?: unknown }).name; } catch { made = null; }
  if (!isVaultName(made)) throw new Error("The hub's answer couldn't be read.");
  return made;
}
