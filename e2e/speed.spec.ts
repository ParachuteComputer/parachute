// T-476 speed: time what a person does in Parachute, with Aaron-shaped data, over a slow line. Opt-in (SPEED=1; needs a
// local Buzz relay at SPEED_RELAY and its owner/bob keys in SPEED_KEYS). Seeds ~3,000 records into the home vault (kitchen),
// today's journal, 13 rooms on the relay with messages from "Uni" (bob), installs Aaron's applets with this build's
// scripts/install-applets.ts (Home, Rooms, Journal, Mail, Claude accounts; the bar Home, Rooms, Journal, Mail; Home
// at start), allows each once, then times, with SPEED_LATENCY ms added to every request (Chromium's own throttling, so
// the HTTP cache still works):
//   cold     a new browser profile with only the sign-in (no HTTP cache, no IndexedDB): the app opened, Home's content
//   open     the app opened again in the same profile (Mac: quit and reopen): Home's content
//   switch   the bar: Home → Rooms → Journal → Home → Rooms (each to its content)
//   reopen   after opening the app again, Rooms (first time in this run of the app) to its content
//   record   from Home, a journal entry tapped to its words shown; then the same again (second open)
// Each action's requests: count, bytes, how many came from the cache, the same address asked twice, the headers.
// Writes e2e/.speed-<SPEED_LABEL>.json.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { api, hubState, mintToken } from "./hub";
import { person } from "./services/client";

const RUN = !!process.env.SPEED;
const RELAY = process.env.SPEED_RELAY ?? "ws://localhost:3891";
const KEYS = process.env.SPEED_KEYS ?? "";
const LAT = Number(process.env.SPEED_LATENCY ?? 100);
const REPS = Number(process.env.SPEED_REPS ?? 3);
const LABEL = process.env.SPEED_LABEL ?? "run";
const N = Number(process.env.SPEED_RECORDS ?? 3000);
const VAULT = "kitchen";
test.skip(!RUN, "opt-in: SPEED=1");
test.use({ storageState: "e2e/.signed-in.json", viewport: { width: 1280, height: 860 }, isMobile: false, hasTouch: false });
test.setTimeout(900_000);

const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const pad = (n: number) => String(n).padStart(2, "0");
const d = new Date();
const TODAY = `Journal/${d.getFullYear()}/${pad(d.getMonth() + 1)}-${pad(d.getDate())}/`;
const MARK = { uni: "#Speed room", journal: "speedmark journal line", room: "Quiet corner", older: "speedmark older entry" };
const y = new Date(d.getTime() - 86400000);
const YESTERDAY = `Journal/${y.getFullYear()}/${pad(y.getMonth() + 1)}-${pad(y.getDate())}/`;

type Req = { id: string; url: string; method: string; t: number; status?: number; bytes?: number; cached?: boolean; cc?: string; type?: string; done?: number };
class Net {
  reqs = new Map<string, Req>();
  ws = 0;
  constructor(cdp: CDPSession) {
    cdp.on("Network.requestWillBeSent", (e) => { if (e.request.url.startsWith("data:")) return; this.reqs.set(e.requestId, { id: e.requestId, url: e.request.url, method: e.request.method, t: Date.now(), type: e.type }); });
    cdp.on("Network.responseReceived", (e) => { const r = this.reqs.get(e.requestId); if (r) { r.status = e.response.status; r.cached = !!(e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache); r.cc = e.response.headers["cache-control"] ?? e.response.headers["Cache-Control"]; } });
    cdp.on("Network.requestServedFromCache", (e) => { const r = this.reqs.get(e.requestId); if (r) r.cached = true; });
    cdp.on("Network.loadingFinished", (e) => { const r = this.reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.done = Date.now(); } });
    cdp.on("Network.webSocketFrameSent", () => { this.ws++; });
  }
  since(t: number) { return [...this.reqs.values()].filter((r) => r.t >= t); }
}
/** A request's address with ids and values blurred, so the same kind of call counts as one. */
const shape = (u: string) => { try { const x = new URL(u); return `${x.host.replace(/:\d+$/, "")}${x.pathname.replace(/\/[0-9A-Z]{20,}/g, "/:id")}${x.search ? "?" + [...x.searchParams.keys()].join("&") : ""}`; } catch { return u; } };
function summary(rs: Req[]) {
  const api = rs.filter((r) => /\/vault\/|\/api\/|\/oauth|\/\.well-known/.test(r.url));
  const urls = new Map<string, number>();
  for (const r of api) urls.set(`${r.method} ${r.url}`, (urls.get(`${r.method} ${r.url}`) ?? 0) + 1);
  const shapes = new Map<string, number>();
  for (const r of api) shapes.set(`${r.method} ${shape(r.url)}`, (shapes.get(`${r.method} ${shape(r.url)}`) ?? 0) + 1);
  return {
    all: rs.length, hub: api.length, bytes: rs.reduce((s, r) => s + (r.bytes ?? 0), 0), cached: rs.filter((r) => r.cached).length,
    twice: [...urls.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0),
    cacheControl: [...new Set(api.map((r) => r.cc ?? "(none)"))],
    shapes: Object.fromEntries([...shapes.entries()].sort((a, b) => b[1] - a[1])),
    list: rs.map((r) => `${r.t - (rs[0]?.t ?? 0)}+${(r.done ?? r.t) - r.t} ${r.method} ${r.status ?? "-"} ${r.cached ? "cache " : ""}${r.url.replace(/^https?:\/\/[^/]+/, "")}`),
  };
}

/** In every frame (the shell's and each applet's), from its start: each time one of the markers comes on screen (in the
 *  frame's text, the frame drawn at a size), the time, kept in window.__speedSeen. Checked each animation frame. */
const WATCH = (marks: string[]) => {
  const w = window as unknown as { __speedSeen?: Record<string, number[]>; __speedOn?: Record<string, boolean> };
  const seen: Record<string, number[]> = (w.__speedSeen = {});
  const on: Record<string, boolean> = (w.__speedOn = {});
  // drawn at all: a kept applet's frame is hidden (display: none), and so not in the viewport; hidden, it runs no
  // animation frames, so the observer itself marks it gone and checks again when it is back
  let vis = window === window.top;
  // the moment a tap lands (the measure starts there, not when the test asked for it)
  addEventListener("pointerdown", () => { (window as unknown as { __speedTap?: number }).__speedTap = Date.now(); }, true);
  const check = () => {
    const text = document.body ? document.body.textContent ?? "" : "";
    for (const m of marks) { const now = vis && text.includes(m); if (now && !on[m]) (seen[m] ??= []).push(Date.now()); on[m] = now; }
  };
  const watch = () => { if (!document.documentElement) { setTimeout(watch, 5); return; } new IntersectionObserver((es) => { vis = es[es.length - 1].isIntersecting; check(); }).observe(document.documentElement); };
  if (window !== window.top) watch();
  const tick = () => { check(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};

/** When `text` is first on screen after t0, in any frame shown: ms since t0 (from the frames' own clocks). */
async function shown(page: Page, text: string, t0: number, timeout = 60_000, already = false): Promise<number> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    let best = Infinity;
    for (const f of page.frames()) {
      try {
        const [ts, now] = await f.evaluate((m) => { const w = window as unknown as { __speedSeen?: Record<string, number[]>; __speedOn?: Record<string, boolean> }; return [w.__speedSeen?.[m] ?? [], !!w.__speedOn?.[m]] as const; }, text);
        if (already && now) return 0;
        for (const t of ts) if (t >= t0 && t < best) best = t;
      } catch { /* a frame going away */ }
    }
    if (best < Infinity) return best - t0;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`"${text}" not shown in ${timeout} ms`);
}

/** When the last tap landed in the page (or `fallback`). */
async function tapAt(page: Page, fallback: number): Promise<number> {
  let at = 0;
  for (const f of page.frames()) { try { at = Math.max(at, await f.evaluate(() => (window as unknown as { __speedTap?: number }).__speedTap ?? 0)); } catch { /* gone */ } }
  return at >= fallback ? at : fallback;
}
/** When the page's navigation started. */
const navAt = (page: Page) => page.evaluate(() => Math.round(performance.timeOrigin));

async function slow(page: Page): Promise<Net> {
  const cdp = await page.context().newCDPSession(page);
  const net = new Net(cdp);
  await cdp.send("Network.enable");
  return net;
}

/** A forward proxy that puts the line's round trip on every request to the hub and the relay (preflights too: the
 *  browser's own throttling lets them through free), half each way; the app's own files (on a device, in the app) go
 *  straight through. Each request pays one round trip; a WebSocket pays half a trip per chunk each way. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function slowLine(appPort: string): Promise<{ port: number; close(): void }> {
  const half = LAT / 2;
  const server = createServer(async (req, res) => {
    const u = new URL(req.url!);
    const local = u.port === appPort;
    if (!local) await wait(half);
    const up = httpRequest({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers }, async (r) => {
      if (!local) await wait(half);
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  server.on("connect", (req, sock, head) => {
    const [host, port] = req.url!.split(":");
    const up = connect(Number(port), host, () => {
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) up.write(head);
      sock.on("data", (d) => { void wait(half).then(() => up.write(d)); });
      up.on("data", (d) => { void wait(half).then(() => sock.write(d)); });
    });
    const end = () => { sock.destroy(); up.destroy(); };
    up.on("error", end); sock.on("error", end); up.on("close", end); sock.on("close", end);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as { port: number }).port, close: () => server.close() };
}

const key = () => hubState().key;
async function prepare(page: Page) {
  await page.addInitScript(WATCH, [MARK.uni, MARK.journal, MARK.room, MARK.older, "only its record shows this"]);
  await page.addInitScript((k) => { if (window === window.top) { (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; (window as unknown as { __parachuteE2EUnlock: string }).__parachuteE2EUnlock = "pass"; } }, key());
}

/** Allow what asks, on the screen now: the card's Allow (and the hub's Approve, when it goes there). */
async function allowHere(page: Page, mark: string) {
  const allow = page.getByRole("button", { name: "Allow" });
  const open = page.getByRole("button", { name: "Open", exact: true });
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    try { await shown(page, mark, t0, 4000, true); return; } catch { /* not yet */ }
    if (await allow.isVisible().catch(() => false)) { await allow.click(); continue; }
    if (await open.isVisible().catch(() => false)) { await open.click(); continue; }
    const hub = hubState().origin;
    if (page.url().startsWith(hub)) { const ap = page.getByRole("button", { name: "Approve" }); if (await ap.isVisible().catch(() => false)) await ap.click(); }
  }
  await shown(page, mark, Date.now(), 30_000, true);
}

const bar = (page: Page, name: string) => page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: new RegExp(name) });

async function seed() {
  const w = { ...hubState(), token: mintToken(`vault:${VAULT}:write`) };
  const admin = { ...hubState(), token: mintToken(`vault:${VAULT}:admin`) };
  const types: Record<string, Record<string, unknown>> = {
    task: { status: { type: "string", enum: ["open", "doing", "done"] }, due: { type: "date" }, priority: { type: "integer" } },
    person: { email: { type: "string" }, company: { type: "string" } },
    meeting: { held_on: { type: "date" } },
  };
  for (const [name, fields] of Object.entries(types)) await api(admin, "PUT", `types/${name}`, { fields }, VAULT).catch(() => {});
  const words = ["river", "garden", "lantern", "harbor", "orchard", "meadow", "copper", "willow", "ember", "quarry", "tide", "cedar"];
  const recs: Record<string, unknown>[] = [];
  for (let k = 0; k < N; k++) {
    const kind = k % 6;
    const day = new Date(Date.UTC(2026, 0, 1) + (k % 320) * 86400000).toISOString().slice(0, 10);
    if (kind === 0) recs.push({ types: ["task"], path: `Tasks/${words[k % 12]} ${words[(k * 7) % 12]} ${k}`, content: `# Task ${k}\n\nFor [[People/p ${k % 400}]].`, metadata: { status: ["open", "doing", "done"][k % 3], due: day, priority: (k % 5) + 1 } });
    else if (kind === 1) recs.push({ types: ["person"], path: `People/p ${k}`, content: `Met at the ${words[k % 12]} meetup.`, metadata: { email: `p${k}@example.com`, company: `${words[k % 12]} co` } });
    else if (kind === 2) recs.push({ types: ["meeting"], path: `Meetings/${day} ${words[k % 12]} ${k}`, content: `- about [[Tasks/${words[k % 12]}]]\n\n${"Notes from the meeting. ".repeat(20)}`, metadata: { held_on: day } });
    else if (kind === 3) recs.push({ path: `Journal/2026/${pad(1 + (k % 10))}-${pad(1 + (k % 28))}/${pad(k % 24)}-${pad(k % 60)} ${words[k % 12]} ${k}`, content: `An older entry ${k}. ${"Words of the day. ".repeat(10)}` });
    else recs.push({ path: `Notes/${words[k % 12]}/${words[(k * 5) % 12]} ${k}`, content: `# A note ${k}\n\n${"Some words in a note. ".repeat(30)}` });
  }
  for (let i = 0; i < recs.length; i += 100) await api(w, "POST", "records", { records: recs.slice(i, i + 100) }, VAULT);
  await api(w, "POST", "notes", { path: `${YESTERDAY}08-00 ${MARK.older}`, content: `${MARK.older}: only Journal lists it.` });
  for (let i = 0; i < 4; i++) await api(w, "POST", "notes", { path: `${TODAY}0${i}-1${i} ${MARK.journal} ${i}`, content: `${MARK.journal} ${i}\n\nThe rest of entry ${i}: only its record shows this.` });
}

async function relay() {
  const owner = await person(RELAY, secret("owner"));
  const bob = await person(RELAY, secret("bob"));
  const me = getPublicKey(Uint8Array.from(Buffer.from(key(), "hex")));
  for (const p of [me, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  const stamp = Date.now().toString(36);
  for (let i = 1; i <= 13; i++) {
    const id = crypto.randomUUID();
    expect((await owner.publish({ kind: 9007, tags: [["h", id], ["name", `Speed room ${pad(i)} ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
    for (const p of [me, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", id], ["p", p]] })).ok).toBe(true);
    for (let m = 0; m < 25; m++) await bob.publish({ kind: 9, content: m === 24 ? `${MARK.uni} in room ${i}` : `Message ${m} in room ${i}: ${"words ".repeat(12)}`, tags: [["h", id]] });
  }
  // a room Uni says nothing in: Home never lists it; Rooms does (its marker)
  const quiet = crypto.randomUUID();
  expect((await owner.publish({ kind: 9007, tags: [["h", quiet], ["name", `Quiet corner ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [me, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", quiet], ["p", p]] })).ok).toBe(true);
  owner.close();
  return bob;
}

function install(bob: string) {
  const tokenFile = join(process.env.TMPDIR ?? tmpdir(), `speed-token-${process.pid}`);
  writeFileSync(tokenFile, mintToken(`vault:${VAULT}:write`), { mode: 0o600 });
  const args = ["scripts/install-applets.ts", "--hub", hubState().origin, "--vault", VAULT, "--token-file", tokenFile,
    "--applet", "today", "--applet", "rooms", "--applet", "mail", "--applet", "journal", "--applet", "accounts",
    "--set", `relay=${RELAY}`, "--set", "mail=http://127.0.0.1:9/mail/", "--set", `uni=${bob}`,
    "--app", "uni", "--app-name", "Uni", "--source", "*", "--bar", "today,rooms,journal,mail", "--start", "today",
    "--service", `Rooms=nostr-relay:${RELAY}`, "--service", "Mail=http:http://127.0.0.1:9/mail/", "--apply"];
  const out = execFileSync("node", args, { stdio: "pipe" }).toString();
  return out;
}

type Times = Record<string, number[]>;
const results: { times: Times; net: Record<string, ReturnType<typeof summary>[]> } = { times: {}, net: {} };
let lastPage: Page | null = null, lastT = 0;
async function marks(): Promise<string> {
  if (!process.env.SPEED_MARKS || !lastPage) return "";
  const t = lastT;
  return (await lastPage.evaluate((t0) => performance.getEntriesByType("mark").filter((m) => m.name.startsWith("ps:") && m.startTime + performance.timeOrigin >= t0).map((m) => `${Math.round(m.startTime + performance.timeOrigin - t0)} ${m.name.slice(3)}`).join(" | "), t).catch(() => "")) as string;
}
function note(name: string, ms: number, rs: Req[]) {
  (results.times[name] ??= []).push(ms);
  (results.net[name] ??= []).push(summary(rs));
  console.log(`${LABEL} ${name}: ${ms} ms, ${rs.length} requests`);
  void marks().then((m) => { if (m) console.log(`${LABEL} marks ${name}: ${m}`); });
}
const settle = () => new Promise((r) => setTimeout(r, 2500));

test("speed: Aaron-shaped app over a slow line", async ({ browser, page, context }) => {
  // setup
  await seed();
  const bob = await relay();
  console.log(install(bob.pubkey));
  bob.close();
  // SPEED_PARACHUTE=1: the bundle names Parachute's publisher, as the bundles the app ships do, so Parachute's own
  // applets (Vault among them) are offered; without it, as apply.sh installs Aaron's: a record opens in the plain view
  if (process.env.SPEED_PARACHUTE) {
    const w = { ...hubState(), token: mintToken(`vault:${VAULT}:write`) };
    // (the install writes the older form, Parachute/Apps/<id> under `app`, while the vault has no newer one)
    for (const [tag, key] of [["parachute-bundle", "bundle"], ["parachute-app", "app"]] as const) for (const b of await api(w, "GET", `notes?tag=${tag}`, undefined, VAULT)) {
      const full = await api(w, "GET", `notes?id=${b.id}`, undefined, VAULT);
      const bundle = { ...(full.metadata?.[key] ?? {}), publishers: [{ url: "https://parachute.computer/applets/" }] };
      await api(w, "PATCH", `notes/${b.id}`, { metadata: { ...(full.metadata ?? {}), [key]: bundle }, if_updated_at: full.updatedAt }, VAULT);
      console.log(`bundle ${b.path}: publishers`, JSON.stringify(bundle.publishers));
    }
  }
  await prepare(page);
  // the first start reads the settings the install wrote; the next start opens Home
  await page.goto("/"); await page.waitForTimeout(4000); await page.goto("about:blank"); await page.goto("/");
  await allowHere(page, MARK.journal);
  await shown(page, MARK.uni, Date.now(), 30_000, true);
  for (const [name, mark] of [["Rooms", MARK.room], ["Journal", MARK.older]] as const) { await bar(page, name).click(); await allowHere(page, mark); }
  await bar(page, "Mail").click(); await page.waitForTimeout(1500);
  const allow = page.getByRole("button", { name: "Allow" }); if (await allow.isVisible().catch(() => false)) await allow.click();
  await bar(page, "Home").click(); await shown(page, MARK.journal, Date.now(), 30_000, true);
  // a record opened once, so its viewer is allowed too
  await openRecord(page, true);
  await page.waitForTimeout(1500);
  const state = join(process.env.TMPDIR ?? tmpdir(), `speed-state-${process.pid}.json`);
  await context.storageState({ path: state });
  await page.close();

  const line = await slowLine(process.env.E2E_PORT ?? "4173");
  const proxy = { server: `http://127.0.0.1:${line.port}`, bypass: "<-loopback>" };
  for (let rep = 0; rep < REPS; rep++) {
    // cold: a new profile with only what storageState keeps (the sign-in, grants, local storage)
    const cold = await browser.newContext({ proxy, storageState: state, viewport: { width: 1280, height: 860 }, userAgent: (test.info().project.use as { userAgent?: string }).userAgent, isMobile: false, hasTouch: false });
    const cp = await cold.newPage(); await prepare(cp); const cn = await slow(cp);
    let t0 = Date.now(); await cp.goto("/"); let t1 = await navAt(cp);
    note("cold: Home's journal", await shown(cp, MARK.journal, t1), cn.since(t0));
    note("cold: Home's rooms", await shown(cp, MARK.uni, t1), cn.since(t0));
    note("cold: the app's own start (DOMContentLoaded)", Math.round(await cp.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).domContentLoadedEventEnd)), []);
    await settle(); note("cold: settled requests", 0, cn.since(t0));
    await cold.close();

    // a profile that has run the app (one per rep, warmed once), then opened again
    const ctx = await browser.newContext({ proxy, storageState: state, viewport: { width: 1280, height: 860 }, userAgent: (test.info().project.use as { userAgent?: string }).userAgent, isMobile: false, hasTouch: false });
    const warm = await ctx.newPage(); await prepare(warm); await warm.goto("/"); await shown(warm, MARK.uni, Date.now(), 60_000, true);
    for (const name of ["Rooms", "Journal"]) { await bar(warm, name).click(); await shown(warm, name === "Rooms" ? MARK.room : MARK.older, Date.now(), 60_000, true); }
    await warm.close();
    const p = await ctx.newPage(); await prepare(p); const net = await slow(p);
    t0 = Date.now(); await p.goto("/"); t1 = await navAt(p); lastPage = p; lastT = t1;
    note("open: Home's journal", await shown(p, MARK.journal, t1), net.since(t0));
    note("open: Home's rooms", await shown(p, MARK.uni, t1), net.since(t0));
    // the app's own start (its files read and run, before any applet): what a person waits for in any app
    note("open: the app's own start (DOMContentLoaded)", Math.round(await p.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).domContentLoadedEventEnd)), []);
    await settle();
    // reopen: Rooms, first time in this run of the app
    t0 = Date.now(); await bar(p, "Rooms").click(); t1 = await tapAt(p, t0); lastPage = p; lastT = t1;
    note("reopen: Rooms", await shown(p, MARK.room, t1), net.since(t0));
    await settle();
    for (const [name, mark, said] of [["Journal", MARK.older, "Journal, first time this run"], ["Home", MARK.journal, "Home (kept)"], ["Rooms", MARK.room, "Rooms (kept)"], ["Journal", MARK.older, "Journal (kept)"], ["Home", MARK.uni, "Home again (kept)"]] as const) {
      t0 = Date.now(); await bar(p, name).click(); t1 = await tapAt(p, t0); lastPage = p; lastT = t1;
      note(`switch: ${said}`, await shown(p, mark, t1), net.since(t0));
      await settle();
    }
    t0 = Date.now();
    note("record: first open", await openRecord(p), net.since(t0));
    await settle();
    await bar(p, "Home").click(); await shown(p, MARK.journal, Date.now(), 60_000, true); await settle();
    t0 = Date.now();
    note("record: open again", await openRecord(p), net.since(t0));
    await settle();
    await ctx.close();
  }
  line.close();
  writeFileSync(join(import.meta.dirname, `.speed-${LABEL}.json`), JSON.stringify({ label: LABEL, latency: LAT, records: N, ...results }, null, 1));
});

/** From Home, a journal entry of today tapped: until its words are on screen (the viewer it opens in). */
async function openRecord(page: Page, allow = false): Promise<number> {
  let row: import("@playwright/test").Locator | null = null;
  const frames = await page.locator("iframe.applet-frame").all();
  for (let i = 0; i < frames.length; i++) {
    if (!(await frames[i].isVisible())) continue;
    const r = page.frameLocator("iframe.applet-frame").nth(i).getByRole("region", { name: "Today's journal" }).getByRole("button").first();
    if (await r.isVisible().catch(() => false)) { row = r; break; }
  }
  if (!row) throw new Error("no journal row on Home");
  const t0 = Date.now();
  await row.click();
  if (allow) { await allowHere(page, "only its record shows this"); return 0; }
  lastPage = page; lastT = await tapAt(page, t0);
  return shown(page, "only its record shows this", lastT);
}
