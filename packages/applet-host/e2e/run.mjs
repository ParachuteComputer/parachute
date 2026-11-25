// The applet-host e2e in the MCP Apps reference host (ext-apps examples/basic-host), driven as a person would:
// a throwaway hub (hub.mjs), a loopback proxy that adds its key (basic-host sends none), basic-host, and Playwright.
//   EXT_APPS=<ext-apps checkout, basic-host built for SANDBOX_PORT> PARACHUTE_CORE=<parachute-core>
//   APPLET_HOST_HTML=<dist/applet-host.html> node e2e/run.mjs [shots dir] [--strict] [--browser webkit]
// --strict: the view gets the MCP Apps spec's default content policy (no eval, nothing from elsewhere).
// Exit 0 only when every check passes.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { start, stop, tool, mcp } from "./hub.mjs";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const browserName = args.includes("--browser") ? args[args.indexOf("--browser") + 1] : "chromium";
const shots = args.find((a) => !a.startsWith("--") && a !== browserName) ?? null;
if (shots) mkdirSync(shots, { recursive: true });
const EXT = process.env.EXT_APPS;
const HOST_PORT = Number(process.env.HOST_PORT ?? 47392), SANDBOX_PORT = Number(process.env.SANDBOX_PORT ?? 47393);
if (!EXT) throw new Error("EXT_APPS: an ext-apps checkout with examples/basic-host built");
const { chromium, webkit } = await import("@playwright/test");

let failed = 0;
const ok = (c, m) => { if (c) console.log("ok  ", m); else { failed++; console.log("FAIL", m); } };

const state = await start();
const calls = [];
// the loopback proxy: the hub's key on every call, CORS for the host page; it notes each tools/call it forwards
const proxy = createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-expose-headers": "mcp-session-id, mcp-protocol-version" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  try { const j = JSON.parse(body.toString()); if (j.method === "tools/call") calls.push(j.params?.name); } catch {}
  const h = { authorization: `Bearer ${state.token}`, "content-type": req.headers["content-type"] ?? "application/json", accept: req.headers.accept ?? "application/json, text/event-stream" };
  for (const k of ["mcp-protocol-version", "mcp-session-id"]) if (req.headers[k]) h[k] = req.headers[k];
  try {
    const r = await fetch(`http://127.0.0.1:${state.port}/vault/demo/mcp`, { method: req.method, headers: h, body: req.method === "GET" || req.method === "DELETE" ? undefined : body });
    const out = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...cors, "content-type": r.headers.get("content-type") ?? "application/json" }); res.end(out);
  } catch (e) { res.writeHead(502, cors); res.end(String(e?.message ?? e)); }
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const mcpUrl = `http://127.0.0.1:${proxy.address().port}/mcp`;
const host = spawn("bun", ["serve.ts"], { cwd: join(EXT, "examples/basic-host"), env: { ...process.env, HOST_PORT: String(HOST_PORT), SANDBOX_PORT: String(SANDBOX_PORT), SERVERS: JSON.stringify([mcpUrl]) }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let hostLog = ""; host.stdout.on("data", (d) => { hostLog += d; }); host.stderr.on("data", (d) => { hostLog += d; });
for (let i = 0; i < 100 && !/Sandbox server/.test(hostLog); i++) await new Promise((r) => setTimeout(r, 100));

const cleanup = async () => { try { process.kill(-host.pid, "SIGTERM"); } catch {} proxy.close(); await stop(state); };
let browser;
try { browser = await (browserName === "webkit" ? webkit : chromium).launch(); } catch (e) { await cleanup(); throw e; }
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
const errors = [];
const logs = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
try {
  if (strict) {
    // the spec's default policy for a view that declares no domains (apps.mdx): inline scripts, no eval, no network
    const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none';";
    await page.route(/\/sandbox\.html/, async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, headers: { ...r.headers(), "content-security-policy": CSP } }); });
  }
  const view = () => page.frames().find((f) => f.url() === "about:blank" && f.parentFrame()?.url().includes("sandbox.html"));
  const applet = () => page.frames().find((f) => f.url() === "about:srcdoc" && f.parentFrame() === view());
  const text = async (f) => (await f?.evaluate(() => document.body.innerText).catch(() => "")) ?? "";
  const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(150); } return false; };
  const open = async (name) => {
    await page.goto(`http://127.0.0.1:${HOST_PORT}/`);
    await page.waitForSelector("text=Call Tool");
    await until(async () => (await page.locator("select").nth(1).locator("option").allTextContents()).includes(name));
    await page.locator("select").nth(1).selectOption(name);
    await page.fill("textarea", "{}");
    await page.click("text=Call Tool");
  };

  // 0. what the host is offered: the approved applets as tools, each with a global entry point; never the unapproved
  const listed = (await mcp(state, "tools/list", {})).result.tools.filter((t) => t.name.startsWith("open-"));
  ok(JSON.stringify(listed.map((t) => t.name).sort()) === JSON.stringify(["open-hostile", "open-library", "open-people", "open-probe", "open-widened"]), `tools: ${listed.map((t) => t.name).join(", ")} (open-unapproved is not offered)`);
  ok(listed.every((t) => t._meta?.["openai/ui"]?.entrypoints?.[0]?.type === "global" && t._meta?.ui?.resourceUri === `ui://parachute/applet/${t.name.slice(5)}`), "each is its own tile: a global entry point and its own ui:// view");

  // 1. People, the app's own applet, from the vault: nested in the view, sealed
  await open("open-people");
  ok(await until(async () => /Maya Ortiz/.test(await text(applet()))), "People runs in its own frame inside the view and lists the vault's people");
  if (process.env.DEBUG) { console.log(page.frames().map((f) => `${f.url()} <- ${f.parentFrame()?.url()}`).join("\n")); console.log("view:", await text(view())); console.log("logs:", logs.slice(-30).join("\n")); }
  const seal = await view()?.evaluate(() => { const f = document.querySelector("iframe.applet"); return f ? { sandbox: f.getAttribute("sandbox"), allow: f.getAttribute("allow") } : null; });
  ok(seal?.sandbox === "allow-scripts" && /microphone 'none'/.test(seal?.allow ?? ""), `the applet frame is the app's seal (sandbox="${seal?.sandbox}")`);
  if (shots) await page.screenshot({ path: `${shots}/01-people.png` });
  // a write, through the session, the vault module and the host's tools/call
  const before = await tool(state, "query-records", { id: "People/Maya Ortiz" });
  if (!applet()) throw new Error("no applet frame");
  await applet().click("text=Maya Ortiz");
  await until(async () => /Favorite|☆/.test(await text(applet())));
  await applet().locator("text=/☆\\s*Favorite/").first().click().catch(() => {});
  ok(await until(async () => (await tool(state, "query-records", { id: "People/Maya Ortiz" })).fields?.favorite === true), "☆ Favorite writes fields.favorite through the host");
  const after = await tool(state, "query-records", { id: "People/Maya Ortiz" });
  ok(after.updatedAt > before.updatedAt && after.fields.email === "maya@example.org", "the write merged: her other fields kept");
  if (shots) await page.screenshot({ path: `${shots}/02-person.png` });

  // 2. Library
  await open("open-library");
  ok(await until(async () => /Seed Keepers/.test(await text(applet())) && /Slow Tools/.test(await text(applet()))), "Library opens on the vault's books");
  if (shots) await page.screenshot({ path: `${shots}/03-library.png` });

  // 3. an approved applet that tries every way out: the seal holds
  const before3 = calls.length;
  await open("open-hostile");
  ok(await until(async () => /fetch: /.test(await text(applet())), 20000), "the hostile applet ran and reported");
  const said = await text(applet());
  console.log("     hostile:", said.replace(/\n+/g, " | "));
  ok(/view document: blocked/.test(said), "it can't reach into the view (opaque origin)");
  ok(/fetch: blocked/.test(said), "it can't reach the network");
  ok(/own folder: 1/.test(said) && /other folder: refused/.test(said), "it reads its own folder and is refused another (the app's vault module)");
  await page.waitForTimeout(1500);
  ok(!calls.slice(before3).includes("delete-record"), `no tools/call it posted reached the connector (forwarded: ${calls.slice(before3).join(", ")})`);
  ok(!!(await tool(state, "query-records", { id: "Notes/Keep me" }).catch(() => null)), "the record it tried to delete is there");
  if (shots) await page.screenshot({ path: `${shots}/04-hostile.png` });

  // 4. the bridge reads and writes as the REST door the app uses does (a type read, a create where it opens a type,
  // a field filter, a date filter)
  await open("open-probe");
  ok(await until(async () => /date filter: /.test(await text(applet())), 20000), "the probe applet ran");
  const probe = await text(applet());
  console.log("     probe:", probe.replace(/\n+/g, " | "));
  ok(/type read: 4\b/.test(probe), "a read by type finds the vault's four people");
  ok(/types on a record: true/.test(probe), "a record's types are among its tags, as in the app");
  ok(/create: People\/Probe Person/.test(probe) && (await tool(state, "query-records", { id: "People/Probe Person" }).catch(() => null))?.types?.includes("person"), "a create where it opens a type lands, typed");
  ok(/field filter: [12]\b/.test(probe), "a field filter on a typed value (favorite: true) matches");
  ok(/date filter: [45]\b/.test(probe), "a filter on the record's own updated_at matches");
  // 5. approved, then widened by a vault writer (every folder, same code): the view asks again, runs nothing
  await open("open-widened");
  ok(await until(async () => /asks for more than when you approved it/.test(await text(view()))), "an approved applet whose asks were widened after approval doesn't run");
  if (process.env.DEBUG) console.log("     widened view:", await text(view()));
  ok(!applet(), "no applet frame for it");
  if (shots) await page.screenshot({ path: `${shots}/05-widened.png` });

  // 6. one not approved: no tool, and its view is refused
  const unapproved = await mcp(state, "resources/read", { uri: "ui://parachute/applet/unapproved" });
  ok(!!unapproved.error, "an applet nobody approved has no view to read");
  if (strict) ok(true, "all of the above under the spec's default content policy");
  ok(errors.length === 0, `no uncaught errors in the page (${errors.slice(0, 3).join(" / ")})`);
} finally {
  await browser.close();
  await cleanup();
}
console.log(failed ? `${failed} check(s) failed` : "every check passed");
process.exit(failed ? 1 : 0);
