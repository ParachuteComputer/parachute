// The web build as a hosted page (T-476, docs/HOSTING.md): served the way Parachute Cloud serves it. A small server
// here stands in for Cloud's identity worker: the built files at the root, the app's page for every address the host
// doesn't keep for itself, the policy from dist/hosted.json on every answer, `/vault` and `/mcp` kept by the host, and
// /.well-known/parachute-account on the page's own origin naming the hub people sign in to (as my.parachute.computer
// names cloud.parachute.computer). Against that: the first screen has nothing to type, the sign-in comes back to
// /oauth/callback on the host, applets run under the host's policy, a reload on any address stays in the app, and the
// console's `/?add=<vault address>` links go to the vault with one ask.
// (What only real Cloud can show is walked on its staging: its name on Cloud's consent page, a vault host apart from
// the sign-in host.)
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { expect, test, type Page } from "./test";
import { api, hubState, VAULT } from "./hub";
import { approveUntilBack } from "./helpers";

// the hub's own sign-in is kept from the setup (no password here: the hub takes few of those in a row)
test.use({ storageState: "e2e/.hub-session.json" });

const DIST = join(import.meta.dirname, "..", "dist");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain" };
/** What Cloud's identity worker keeps for itself (parachute-cloud workers/identity/src/route-manifest.ts): never the app's page. */
const KEPT = [/^\/vault(\/|$)/, /^\/mcp(\/|$)/, /^\/oauth\/(?!callback$)/, /^\/account\//, /^\/console(\/|$)/, /^\/login$/, /^\/health$/];
let server: Server, origin = "";
const seen: string[] = [];
/** How long the host takes to say what it is (a slow link). */
let slowMs = 0;

test.beforeAll(async () => {
  const hub = hubState();
  const hosted = JSON.parse(readFileSync(join(DIST, "hosted.json"), "utf8")) as { csp: string; spa: string[] };
  // the tests' hub is on this machine in the clear: a real host's policy takes https only. Nothing else is loosened.
  const csp = hosted.csp.replace("connect-src 'self'", `connect-src 'self' ${hub.origin} ${hub.origin.replace(/^http/, "ws")}`);
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    seen.push(`${req.method} ${path}`);
    const send = (status: number, type: string, body: string | Buffer) => { res.writeHead(status, { "content-type": type, "content-security-policy": csp, "cache-control": "no-store" }); res.end(body); };
    if (path === "/.well-known/parachute-account") return void setTimeout(() => send(200, "application/json", JSON.stringify({ issuer: hub.origin, door: "cloud", account_mcp_endpoint: `${hub.origin}/account/mcp`, vault_url_template: `${hub.origin}/vault/{name}` })), slowMs);
    if (KEPT.some((k) => k.test(path))) return send(503, "application/json", JSON.stringify({ error: "route_missing" }));
    const file = normalize(join(DIST, path));
    if (file.startsWith(DIST) && path !== "/" && existsSync(file) && statSync(file).isFile()) return send(200, TYPES[extname(file)] ?? "application/octet-stream", readFileSync(file));
    // any other address: the app's page (Cloud's not_found_handling = "single-page-application")
    return send(req.method === "GET" ? 200 : 405, TYPES[".html"], readFileSync(join(DIST, "index.html")));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

const vaultUi = (page: Page) => page.frameLocator("iframe.applet-frame");
const errors = (page: Page) => { const out: string[] = []; page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) out.push(m.text().slice(0, 200)); }); return out; };

test("served by a Parachute: nothing to type, sign in there, and Vault runs under the host's policy; a reload stays in the app", async ({ page }) => {
  test.setTimeout(120_000);
  const refused = errors(page);
  const hub = hubState();
  await page.goto(`${origin}/`);
  // the host said which Parachute this is: no address to type, no "whose is it"
  await expect(page.getByText("Your notes on Parachute Cloud, in your browser.")).toBeVisible();
  await expect(page.getByLabel("Your Parachute's address")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.origin === hub.origin);
  await approveUntilBack(page, hub.origin, origin, async (p) => { const home = p.getByRole("radio", { name: VAULT, exact: true }); if (await home.count()) await home.check(); });
  // the sign-in came back to the host's own /oauth/callback, which answered with the app's page
  expect(seen).toContain("GET /oauth/callback");

  // Vault, an applet in a sealed frame, runs under the policy the host sent
  await page.goto(`${origin}/v/${VAULT}/a/parachute%3Avault`);
  await expect(vaultUi(page).getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  // a reload on an applet's address, and on a note's, is still the app
  await page.reload();
  await expect(vaultUi(page).getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  const welcome = (await api(hub, "GET", "notes?id=Welcome")).id as string;
  await page.goto(`${origin}/v/${VAULT}/n/${welcome}`);
  await expect(vaultUi(page).getByRole("article", { name: "Welcome" })).toBeVisible({ timeout: 20_000 });
  // nothing the app needs was refused by the host's policy. (The seal's own self-test is refused on purpose, and says so
  // in the console: a probe inside a sealed frame trying a made-up address, a frame of its own and a blob. Those name
  // `connect-src` or `frame-src` and never the hub or this page.)
  const needed = [...new Set(refused)].filter((m) => /script-src|style-src|font-src|img-src|media-src|default-src|Refused to (?:execute|apply|load the (?:script|stylesheet|font|image))/.test(m)
    || [hub.origin, origin].some((o) => (/(?:Connecting to|Framing|load) '([^']+)'/.exec(m)?.[1] ?? "").startsWith(o)) || /Framing 'about:/.test(m));
  expect(needed).toEqual([]);
  expect(refused.some((m) => /selftest/.test(m)), "the self-test ran under the host's policy, and its probe was refused").toBe(true);

  // the host keeps /vault and /mcp for itself: a page load there never reaches the app, and nothing in the app led there
  expect((await page.request.get(`${origin}/vault`)).status()).toBe(503);
  expect(seen.filter((s) => /^GET \/(vault|mcp)(\/|$)/.test(s))).toEqual(["GET /vault"]);
});

test("the console's links: /?add=<a vault's address> signs in for that vault with one ask; with redirect=/new it starts a note; held already, it just opens", async ({ page }) => {
  test.setTimeout(120_000);
  const hub = hubState();
  const add = encodeURIComponent(`${hub.origin}/vault/${VAULT}`);
  await page.goto(`${origin}/?add=${add}&redirect=${encodeURIComponent("/new")}`);
  // straight to the hub: one consent, for that vault alone (no listing first)
  await page.waitForURL((u) => u.origin === hub.origin);
  // Back from the hub's page stays back: the first screen, on a plain address (it sent the person forward again)
  await page.goBack();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(`${origin}/`);
  // a No on the hub, with nothing held: said, and the way on is the first screen (not an address inside a vault)
  await page.goto(`${origin}/oauth/callback?error=access_denied&state=x`);
  await expect(page.getByRole("alert")).toContainText("You said no");
  await expect(page.getByRole("link", { name: "Go back" })).toHaveCount(0);
  // the link again, tapped afresh, asks again (nothing is kept in the tab that would stop it)
  await page.goto(`${origin}/?add=${add}&redirect=${encodeURIComponent("/new")}`);
  await page.waitForURL((u) => u.origin === hub.origin);
  const asked = await approveUntilBack(page, hub.origin, origin, undefined, `/v/${VAULT}/a/parachute%3Avault`);
  expect(asked).toBe(1);
  // "Write a note": a new note is open (a page that just loaded can't take the caret for itself: one tap, then type)
  const box = vaultUi(page).getByRole("textbox", { name: "The note's words" });
  await expect(box).toBeVisible({ timeout: 20_000 });
  await expect(box).toHaveValue("");
  await box.click();
  await box.pressSequentially("Written from the console's link");
  await expect(vaultUi(page).getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  const made = (await api(hub, "GET", "notes?path_prefix=Notes%2F&include_content=true")) as { id: string; content?: string }[];
  expect(made.filter((n) => n.content === "Written from the console's link")).toHaveLength(1);
  for (const n of made) if (n.content === "Written from the console's link") await api(hub, "DELETE", `notes/${n.id}`);

  // the same link again, signed in: no hub page, the vault opens
  await page.goto(`${origin}/?add=${add}`);
  await expect(page).toHaveURL(new RegExp(`/v/${VAULT}/a/parachute%3Avault\\?vault=${VAULT}`));
  await expect(vaultUi(page).getByRole("heading", { level: 1, name: VAULT })).toBeVisible({ timeout: 20_000 });

  // a person on Parachute Simplified, whose home opens on Vault, taps "Write a note" in a new tab on a slow link: the
  // host says what it is only after the app has decided where to start. The link still acts (going home first dropped it).
  await page.evaluate((v) => localStorage.setItem("parachute.app.open.v1", JSON.stringify({ [v]: "simple" })), VAULT);
  const tab = await page.context().newPage();
  await tab.goto(`${origin}/`);
  await expect(tab).toHaveURL(new RegExp(`/v/${VAULT}/a/parachute%3Avault`));
  await tab.close();
  slowMs = 2500;
  const slow = await page.context().newPage();
  try {
    await slow.goto(`${origin}/?add=${add}&redirect=${encodeURIComponent("/new")}`);
    await expect(slow).toHaveURL(/show=new/, { timeout: 15_000 });
    await expect(vaultUi(slow).getByRole("textbox", { name: "The note's words" })).toBeVisible({ timeout: 20_000 });
  } finally { slowMs = 0; await slow.close(); }
  await page.evaluate(() => localStorage.removeItem("parachute.app.open.v1"));

  // an address that isn't one of this Parachute's vaults does nothing: the home, as a plain visit would show it
  await page.goto(`${origin}/?add=${encodeURIComponent("https://elsewhere.example/vault/x")}`);
  await expect(page).not.toHaveURL(/add=/);
  await expect(page).toHaveURL((u) => u.origin === origin && !/elsewhere/.test(u.href));
  await expect(page.locator("nav[aria-label=Bar]")).toBeVisible();
});
