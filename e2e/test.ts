// The `test` every spec uses: Playwright's, with the saved sign-ins kept as a device keeps its own (T-476).
//
// A spec's browser starts from a saved state (e2e/.signed-in.json and the like), as a device starts from what it kept. Core
// 0.9 rotates a sign-in at every refresh: the refresh token sent is spent, and a spent one sent again is let through only
// once, within 30 s; after that the hub reads it as stolen and ends the whole sign-in. So when the hub rotates a sign-in in
// one of these browsers, the new pair is written back to the state that browser started from, before the next spec
// starts. Without it, every spec after the access token's 15 minutes restored the same spent refresh token, and from the
// third on the hub refused them all: 401 on every read, 400 on every refresh (e2e/expiry.spec.ts; T-476 CAUSE).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
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
/** The saved states the browsers of this run started from. */
const files = new Set<string>();

/** What the hub gave for `spent` (answer number `n`), written to the saved states: the record holding any refresh token of
 *  the same sign-in now holds the new pair, as vault/client.ts `refreshOnce` stores it on the device. The hub's latest
 *  answer is its live one, even for a spent token it let through again (its grace window rotates the live one). A browser
 *  a spec opened from another's state (an object, not a file) is kept too: its sign-in is one of the files'. */
function keepRotation(spent: string, t: Rotated, n: number) {
  const family = families.get(spent) ?? { tokens: new Set([spent]), last: 0 };
  if (t.refresh_token) { family.tokens.add(t.refresh_token); families.set(t.refresh_token, family); }
  families.set(spent, family);
  // an answer older than one already kept (two browsers refreshing the same sign-in at once) is no longer the live one
  if (n < family.last) return;
  family.last = n;
  for (const file of files) keepIn(file, family, t);
}

function keepIn(file: string, family: Family, t: Rotated) {
  let saved: Saved;
  try { saved = JSON.parse(readFileSync(file, "utf8")) as Saved; } catch { return; /* not written yet, or removed */ }
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
  // whole or not at all: a browser opened from the file meanwhile reads the one before or this one
  if (changed) { writeFileSync(`${file}.keeping`, JSON.stringify(saved)); renameSync(`${file}.keeping`, file); }
}

const watched = new WeakSet<BrowserContext>();

/** Follow the refreshes a browser makes (started from `file`, if from a file), and keep each one the hub grants; the
 *  browser closes only once every refresh it sent is answered and kept, so the next spec starts from them. */
function watch(ctx: BrowserContext, file?: string) {
  if (file) files.add(file);
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
      if (t?.access_token) keepRotation(spent, t, n);
    })().catch((e) => console.warn(`e2e/test.ts: a refresh wasn't kept: ${e}`));
    pending.add(p);
    void p.finally(() => pending.delete(p));
  });
  const close = ctx.close.bind(ctx);
  // (a refresh can set off another while the first is kept: vaultsDeps.ts checks a refusal by refreshing)
  ctx.close = async (options) => { while (pending.size) await Promise.all([...pending]); return close(options); };
}

export const test = base.extend({
  // a spec's own browser (`page`, `context`), from the saved state its project or `test.use` names
  context: async ({ context, storageState }, use) => {
    watch(context, typeof storageState === "string" ? storageState : undefined);
    await use(context);
  },
  // and those it opens by hand from one
  browser: [async ({ browser }, use) => {
    const open = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const ctx = await open(options);
      watch(ctx, typeof options?.storageState === "string" ? options.storageState : undefined);
      return ctx;
    };
    await use(browser);
    browser.newContext = open;
  }, { scope: "worker" }],
});
