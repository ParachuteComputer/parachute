// The `test` every spec uses: Playwright's, with the saved sign-ins kept as a device keeps its own (T-476).
//
// A spec's browser starts from a saved state (e2e/.signed-in.json and the like), as a device starts from what it kept. Core
// 0.9 rotates a sign-in at every refresh: the refresh token sent is spent, and a spent one sent again is let through only
// once, within 30 s; after that the hub reads it as stolen and ends the whole sign-in. So when the hub rotates a sign-in in
// one of these browsers, the new pair is written back to the state that browser started from, before the next spec
// starts. Without it, every spec after the access token's 15 minutes restored the same spent refresh token, and from the
// third on the hub refused them all: 401 on every read, 400 on every refresh (e2e/expiry.spec.ts; T-476 CAUSE).
import { readFileSync, writeFileSync } from "node:fs";
import { test as base, type BrowserContext } from "@playwright/test";

export * from "@playwright/test";

const VAULTS = "parachute.vaults.v1";
type Saved = { origins: { localStorage: { name: string; value: string }[] }[] };
type Rotated = { access_token: string; refresh_token?: string; expires_in?: number };
type Rec = { refreshToken?: string; accessToken: string; expiresAt?: number };

/** One sign-in's refresh tokens as the hub rotated them in this run: every one seen, and the pair it gave last. */
type Family = { tokens: Set<string>; last: number };
const families = new Map<string, Family>();
let answered = 0;

/** What the hub gave for `spent` (answer number `n`), written to the saved state in `file`: the record holding any refresh
 *  token of the same sign-in now holds the new pair, as vault/client.ts `refreshOnce` stores it on the device. The hub's
 *  latest answer is its live one, even for a spent token it let through again (its grace window rotates the live one). */
export function keepRotation(file: string, spent: string, t: Rotated, n = ++answered) {
  const family = families.get(spent) ?? { tokens: new Set([spent]), last: 0 };
  if (t.refresh_token) { family.tokens.add(t.refresh_token); families.set(t.refresh_token, family); }
  families.set(spent, family);
  // an answer older than one already kept (two browsers refreshing the same sign-in at once) is no longer the live one
  if (n < family.last) return;
  family.last = n;
  const saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
  let changed = false;
  for (const item of saved.origins.flatMap((o) => o.localStorage)) {
    if (item.name !== VAULTS) continue;
    const recs = JSON.parse(item.value) as Rec[];
    // only this sign-in's record: a state written since with a sign-in of its own (a setup again) is left as it is
    const rec = recs.find((r) => r.refreshToken && family.tokens.has(r.refreshToken));
    if (!rec) continue;
    Object.assign(rec, { accessToken: t.access_token, refreshToken: t.refresh_token ?? rec.refreshToken, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined });
    item.value = JSON.stringify(recs);
    changed = true;
  }
  if (changed) writeFileSync(file, JSON.stringify(saved));
}

const watched = new WeakSet<BrowserContext>();

/** Follow the refreshes a browser started from `file` makes, and keep each one the hub grants; the browser closes only
 *  once every refresh it sent is answered and kept, so the next spec starts from them. */
function watch(ctx: BrowserContext, file: string) {
  if (watched.has(ctx)) return;
  watched.add(ctx);
  const pending = new Set<Promise<void>>();
  ctx.on("request", (req) => {
    if (req.method() !== "POST" || !new URL(req.url()).pathname.endsWith("/oauth/token")) return;
    const form = new URLSearchParams(req.postData() ?? "");
    const spent = form.get("refresh_token");
    if (form.get("grant_type") !== "refresh_token" || !spent) return;
    const p = (async () => {
      const res = await req.response();
      if (!res?.ok()) return;
      const n = ++answered;
      const t = await res.json() as Rotated;
      if (t?.access_token) keepRotation(file, spent, t, n);
    })().catch((e) => console.warn(`e2e/test.ts: a refresh wasn't kept in ${file}: ${e}`));
    pending.add(p);
    void p.finally(() => pending.delete(p));
  });
  const close = ctx.close.bind(ctx);
  ctx.close = async (options) => { await Promise.all([...pending]); return close(options); };
}

export const test = base.extend({
  // a spec's own browser (`page`, `context`), from the saved state its project or `test.use` names
  context: async ({ context, storageState }, use) => {
    if (typeof storageState === "string") watch(context, storageState);
    await use(context);
  },
  // and those it opens by hand from one
  browser: [async ({ browser }, use) => {
    const open = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const ctx = await open(options);
      if (typeof options?.storageState === "string") watch(ctx, options.storageState);
      return ctx;
    };
    await use(browser);
    browser.newContext = open;
  }, { scope: "worker" }],
});
