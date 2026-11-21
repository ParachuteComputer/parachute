// One VaultClient per vault record, with the token refreshed when the vault says it expired.
import { VaultClient } from "@openparachute/surface-client";
import { refresh, revoke } from "./oauth";
import { recordsFetch } from "./records";
import { findVault, originOf, updateVault, vaultUrlOf, type VaultRecord } from "./store";
import { limitedFetch } from "./limited";
import { whoseOf } from "./whose";
import { canWrite, needWrite } from "./writeAsk";
import { dropKept, keptFetch, markWritten } from "./readCache";

/** The fetch for a vault's hub: someone else's is read up to a limit (limited.ts), the person's own as before. Judged per
 *  call, so a change of whose it is applies at once. */
const fetchFor = (rec: Pick<VaultRecord, "issuer" | "vault">): typeof fetch => {
  const limited = limitedFetch();
  return (input, init) => (whoseOf(rec) === "mine" ? fetch(input, init) : limited(input, init));
};

const clients = new Map<string, { at: string; client: VaultClient }>();
/** One refresh at a time per vault: the hub rotates refresh tokens, so two at once could store a spent one. */
const refreshing = new Map<string, Promise<string | null>>();

/** A refresh the hub answered no to: a 4xx, but not 429 (too many asks is not a no). */
export const refusedRefresh = (e: unknown) => e instanceof Error && /^refresh failed \(4(?!29)\d\d\)$/.test(e.message);

/** How the last refresh of each vault's sign-in ended, when it failed: the hub said no, or it didn't answer. */
const refreshFailed = new Map<string, "refused" | "unreachable">();

export function refreshOnce(key: string, fetchImpl?: typeof fetch): Promise<string | null> {
  const running = refreshing.get(key);
  if (running) return running;
  const p = (async () => {
    const cur = findVault(key);
    // no refresh token: the app can't ask, so it can't say the hub refused
    if (!cur?.refreshToken) { refreshFailed.set(key, "unreachable"); return null; }
    try {
      const t = await refresh(cur.tokenEndpoint, cur.clientId, cur.refreshToken, fetchImpl ?? fetchFor(cur));
      // the sign-in was replaced while the hub answered (the person gave write back, or was given it: signInFlow.ts
      // keep): what came back belongs to the one that is gone. It is ended at the hub, never laid over the record:
      // a record that says "reads" must not hold a token that writes.
      const now = findVault(key);
      if (now?.refreshToken !== cur.refreshToken) {
        if (t.refresh_token) void revoke({ ...cur, refreshToken: t.refresh_token }, fetchImpl ?? fetchFor(cur));
        refreshFailed.delete(key);
        return now?.accessToken ?? null;
      }
      updateVault(cur.key, { accessToken: t.access_token, refreshToken: t.refresh_token ?? cur.refreshToken, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined });
      refreshFailed.delete(key);
      return t.access_token;
    } catch (e) {
      // the same, the other way round: the old sign-in was ended at the hub before this refresh of it got there. The
      // hub's no is for the one that is gone, not for the sign-in the record holds now.
      const now = findVault(key);
      if (now && now.refreshToken !== cur.refreshToken) { refreshFailed.delete(key); return now.accessToken; }
      // the hub answering no (a 4xx to the refresh) is a refusal; anything else (no answer, its own trouble) is not
      refreshFailed.set(key, refusedRefresh(e) ? "refused" : "unreachable");
      return null;
    }
  })().finally(() => refreshing.delete(key));
  refreshing.set(key, p);
  return p;
}

/** A request refused because it set off with a token that has since been replaced (a refresh for the vault's other
 *  requests finished while it was on its way) is sent once more with the current token, before anyone sees the
 *  refusal. Only a refusal of the current token sets off a refresh: on core 0.9 each refresh retires the token before
 *  it, so refreshing for such a straggler would take the fresh token away from every other request. A refusal the
 *  browser can't read (0.9 sends a refused token no CORS headers) counts the same. */
export function withCurrentToken(key: string, f: typeof fetch): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    const sent = /^Bearer (.+)$/i.exec(headers.get("Authorization") ?? "")?.[1];
    // a body that can be sent only once (a stream) isn't sent again
    const resendable = !(init?.body instanceof ReadableStream) && !(input instanceof Request && input.bodyUsed);
    /** The same request with the current token, if a newer one is stored (waiting for a refresh already on its way). */
    const again = async (): Promise<Response | null> => {
      await refreshing.get(key)?.catch(() => null);
      const now = findVault(key)?.accessToken;
      if (!sent || !now || now === sent || !resendable) return null;
      headers.set("Authorization", `Bearer ${now}`);
      try { return await f(input instanceof Request ? new Request(input, { headers }) : input, { ...init, headers }); } catch { return null; }
    };
    // a fetch that threw may have reached the hub (a write saved, then the line dropped): only a read goes again then;
    // and a request the caller stopped stays stopped
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let res: Response;
    try { res = await f(input, init); } catch (e) {
      const r = (method === "GET" || method === "HEAD") && (e as { name?: string } | null)?.name !== "AbortError" ? await again() : null;
      if (r) return r;
      throw e;
    }
    if (res.status !== 401 && res.status !== 403) return res;
    const r = await again();
    if (!r) return res;
    void res.body?.cancel().catch(() => {});
    return r;
  };
}

/** A change (anything but a read) to a vault this device holds only read of is refused before it is sent, and the
 *  person is asked (vault/reach.ts): the hub would refuse it, and the ask is theirs to make. */
export function writesNeedWrite(key: string, f: typeof fetch): typeof fetch {
  return (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD" && !canWrite(key)) needWrite(key);
    return f(input, init);
  };
}

/** A change through any of the app's clients for a vault: what is read after it comes from the hub (readCache.ts). */
const marksWritten = (key: string, f: typeof fetch): typeof fetch => async (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method === "GET" || method === "HEAD") return f(input, init);
  // when it is sent, and again when it has landed: a read answered while it was on its way isn't trusted after it
  markWritten(key);
  try { return await f(input, init); } finally { markWritten(key); }
};
// notes calls go through the hub's record door when it has one (records.ts)
const chainFor = (rec: VaultRecord): typeof fetch => marksWritten(rec.key, writesNeedWrite(rec.key, recordsFetch(withCurrentToken(rec.key, fetchFor(rec)))));
const makeClient = (rec: VaultRecord, fetchImpl: typeof fetch) => new VaultClient({
  vaultUrl: vaultUrlOf(rec),
  tokenProvider: () => findVault(rec.key)?.accessToken ?? rec.accessToken,
  onAuthError: () => refreshOnce(rec.key),
  fetchImpl,
});

export function clientFor(rec: VaultRecord): VaultClient {
  const hit = clients.get(rec.key);
  const at = `${rec.issuer} ${rec.vault} ${rec.url ?? ""}`;
  if (hit && hit.at === at) return hit.client;
  const client = makeClient(rec, chainFor(rec));
  clients.set(rec.key, { at, client });
  return client;
}

const keptClients = new Map<string, { at: string; client: VaultClient }>();
/**
 * The same vault's client, for reads that may be answered from the copy kept of them at once while the hub is asked
 * behind it (readCache.ts): what a screen draws first. Whoever reads through it listens to `onFresh` and reads again
 * when the hub's answer differs; a write through it goes as through clientFor.
 */
export function keptClientFor(rec: VaultRecord): VaultClient {
  const hit = keptClients.get(rec.key);
  const at = `${rec.issuer} ${rec.vault} ${rec.url ?? ""}`;
  if (hit && hit.at === at) return hit.client;
  const client = makeClient(rec, keptFetchFor(rec));
  keptClients.set(rec.key, { at, client });
  return client;
}
const keptFetchFor = (rec: VaultRecord) => keptFetch(rec.key, originOf(rec.issuer), chainFor(rec), () => signInState(rec.key));

/** A kept client of its own that notes each read made through it (its path and query, as `onFresh` names them): for an
 *  applet's frame, told only of the reads it made. */
export function keptReaderFor(rec: VaultRecord): { client: VaultClient; reads: Set<string> } {
  const reads = new Set<string>(), f = keptFetchFor(rec);
  const client = makeClient(rec, (input, init) => {
    try { const u = new URL(input instanceof Request ? input.url : String(input)); if ((init?.method ?? "GET").toUpperCase() === "GET" && reads.size < 1000) reads.add(`${u.pathname}${u.search}`); } catch { /* not a URL */ }
    return f(input, init);
  });
  return { client, reads };
}

/** Sign-out: the vault's clients, and what was kept of its reads. */
export const dropClient = (key: string) => { clients.delete(key); keptClients.delete(key); void dropKept(key); };

/**
 * Is this vault's sign-in still good, when a call to its hub failed with no answer the app could read? A hub may refuse a
 * token without the headers a browser needs to see the refusal (core 0.9 does, for a revoked token), so a failure that
 * looks like the network is checked by refreshing the sign-in: the hub answering no is a refused sign-in; no answer at
 * all is a hub out of reach; a fresh token means it was neither (try again).
 */
/** What the last refresh of this vault's sign-in said, if it failed: refused by the hub, or no answer; null if it didn't
 *  fail (or none ran). Asks nothing. */
export const lastRefreshFailure = (key: string): "refused" | "unreachable" | null => refreshFailed.get(key) ?? null;

export async function signInState(key: string): Promise<"alive" | "refused" | "unreachable"> {
  const t = await refreshOnce(key);
  return t ? "alive" : refreshFailed.get(key) ?? "unreachable";
}

/** A note's kept versions, newest first, as the hub lists them (`/versions`): each the content before a write (its
 *  sha-256) and who made that write, when. null where it keeps none or can't say (an older hub, history off). */
export async function versionsOf(rec: VaultRecord, id: string, limit = 50): Promise<{ content_hash: string | null; actor: string | null; via: string | null; superseded_at: string; version_ix: number | null }[] | null> {
  // the client's own request: the vault's address, its token and a refresh on a 401, as every other call
  const c = clientFor(rec) as unknown as { request<T>(path: string, init?: RequestInit): Promise<T> };
  try {
    const r = await c.request<{ versions?: unknown }>(`/api/notes/${encodeURIComponent(id)}/versions?limit=${limit}`);
    if (!r || !Array.isArray(r.versions)) return null;
    const str = (x: unknown) => (typeof x === "string" ? x : null);
    return r.versions.flatMap((v) => {
      const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      const at = str(o.superseded_at);
      return at ? [{ content_hash: str(o.content_hash), actor: str(o.actor), via: str(o.via), superseded_at: at, version_ix: typeof o.version_ix === "number" ? o.version_ix : null }] : [];
    });
  } catch { return null; }
}
