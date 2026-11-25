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

/** The saved state in `file`, with the record that held `spent` holding what the hub gave for it (as vault/client.ts
 *  `refreshOnce` stores it on the device). */
export function keepRotation(file: string, spent: string, t: Rotated) {
  const saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
  let changed = false;
  for (const item of saved.origins.flatMap((o) => o.localStorage)) {
    if (item.name !== VAULTS) continue;
    const recs = JSON.parse(item.value) as Rec[];
    const rec = recs.find((r) => r.refreshToken === spent);
    if (!rec) continue;
    Object.assign(rec, { accessToken: t.access_token, refreshToken: t.refresh_token ?? spent, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined });
    item.value = JSON.stringify(recs);
    changed = true;
  }
  if (changed) writeFileSync(file, JSON.stringify(saved));
}

const watched = new WeakSet<BrowserContext>();

/** Follow the refreshes a browser started from `file` makes, and keep each one the hub grants; the browser closes only
 *  once they are kept, so the next spec starts from them. */
function watch(ctx: BrowserContext, file: string) {
  if (watched.has(ctx)) return;
  watched.add(ctx);
  const pending = new Set<Promise<void>>();
  ctx.on("response", (res) => {
    const req = res.request();
    if (req.method() !== "POST" || !res.ok() || !new URL(res.url()).pathname.endsWith("/oauth/token")) return;
    const form = new URLSearchParams(req.postData() ?? "");
    const spent = form.get("refresh_token");
    if (form.get("grant_type") !== "refresh_token" || !spent) return;
    const p = res.json().then((t: Rotated) => { if (t?.access_token) keepRotation(file, spent, t); }, () => { /* the browser closed first */ });
    pending.add(p);
    void p.finally(() => pending.delete(p));
  });
  const close = ctx.close.bind(ctx);
  ctx.close = async (options) => { await Promise.all([...pending]); return close(options); };
}

// every browser a spec opens from a saved state's file: its own (`page`, `context`) and those it opens by hand
export const test = base.extend({
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
