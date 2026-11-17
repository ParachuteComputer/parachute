// Techne's Events component on the person's home (docs/design/EMBED.md): a pointer in the home vault, the embed in the
// home applet's record, each running in its own sealed frame with its own card. On two real hubs.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, ORG_VAULT, techneState, VAULT } from "./hub";
import { signInWithKey } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const org = (method: string, path: string, body?: unknown) => api(techneState(), method, path, body, ORG_VAULT);
const home = (method: string, path: string, body?: unknown) => api(hubState(), method, path, body, VAULT);
const host = (page: Page) => page.frameLocator("iframe.applet-frame");
const embed = (page: Page, name: string) => page.frameLocator(`iframe.embed-frame[title="${name}"]`);
const hostOf = (origin: string) => new URL(origin).host;
const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const EVENTS_FIELDS = { component: { contract: 1, id: "events", name: "Events", glyph: "◷", props: { days: "number" }, access: [{ vault: "here", allow: [{ path: "Events/", verbs: ["read"] }] }] } };

type Made = { org: string[]; home: string[] };
const pointerPathFor = (id: string) => `Parachute/From/${hostOf(techneState().origin).replace(/[^A-Za-z0-9.-]/g, "-")}/${ORG_VAULT}/component-${id}`;
/** A component on Techne's hub and a pointer to it in the home vault. */
async function orgComponent(made: Made, id: string, name: string, code: string, allow = [{ path: "Events/", verbs: ["read"] }]) {
  const c = await org("POST", "notes", { path: `Components/${name}`, extension: "tsx", content: code, tags: ["component"], metadata: { component: { contract: 1, id, name, access: [{ vault: "here", allow }] } } });
  made.org.push(c.id);
  made.home.push((await home("POST", "notes", { path: pointerPathFor(id), content: `${name}, from techne.`, tags: ["parachute-pointer"], metadata: { pointer: { hub: techneState().origin, vault: ORG_VAULT, record: c.id, kind: "component", id, name, code: `tsx:${await sha(code)}` } } })).id);
  return c.id as string;
}
async function setUp(made: Made, opts: { props?: Record<string, unknown>; more?: { name: string; record: string }[] } = {}) {
  for (const [title, when] of [["Seed swap", "2026-11-20"], ["Barn raising", "2026-11-28"]]) made.org.push((await org("POST", "notes", { path: `Events/${title}`, content: title, metadata: { when } })).id);
  const events = await org("POST", "notes", { path: "Components/Events", extension: "tsx", content: fixture("techne/Events.tsx"), tags: ["component"], metadata: EVENTS_FIELDS });
  made.org.push(events.id);
  const code = `tsx:${await sha(fixture("techne/Events.tsx"))}`;
  const pointerPath = `Parachute/From/${hostOf(techneState().origin).replace(/[^A-Za-z0-9.-]/g, "-")}/${ORG_VAULT}/component-events`;
  made.home.push((await home("POST", "notes", { path: pointerPath, content: "Events, from techne.", tags: ["parachute-pointer"], metadata: { pointer: { hub: techneState().origin, vault: ORG_VAULT, record: events.id, kind: "component", id: "events", name: "Events", code } } })).id);
  const h = await home("POST", "notes", { path: "Applets/Home", extension: "tsx", content: fixture("techne/Home.tsx"), tags: ["applet"],
    metadata: { applet: { contract: 2, id: "home", name: "Home", glyph: "⌂", access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read"] }] }] }, embeds: [{ name: "events", record: pointerPath, props: opts.props ?? { days: 30 } }, ...(opts.more ?? [])] } });
  made.home.push(h.id);
  return { events: events.id, home: h.id, pointerPath };
}
async function sha(s: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function tearDown(made: Made) {
  for (const id of made.home.reverse()) await home("DELETE", `notes/${id}`).catch(() => {});
  for (const id of made.org.reverse()) await org("DELETE", `notes/${id}`).catch(() => {});
}

test("Techne's Events on the home: the host's card says what its page shows, the embed asks on its own sheet, and runs seeing only Techne", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  const made: Made = { org: [], home: [] };
  try {
    const ids = await setUp(made);
    await page.goto(`/v/${VAULT}/a/${ids.home}`);
    await page.getByRole("button", { name: /Open|Allow/ }).first().waitFor();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Shows things from techne (someone else's) on its page. What it reads here could reach techne.");
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(host(page).getByRole("heading", { name: "Home" })).toBeVisible();
    // the embed's place: the shell's line and a sentence, never an Allow in the page
    const place = page.locator('.embed-place[data-embed="events"]');
    await expect(place).toContainText("«Events», from techne, asks to run here.");
    await expect(place.getByRole("button", { name: /Allow/ })).toHaveCount(0);
    await place.getByRole("button", { name: "Review" }).click();
    const sheet = page.getByRole("dialog", { name: /Events is asking/ });
    // it takes the focus: a screen reader moves into it, and no frame holds the focus while it is open
    await expect(sheet).toBeFocused();
    await expect(sheet).toContainText("A component asks for access");
    await expect(sheet).toContainText(`from techne (someone else's, at ${hostOf(techneState().origin)})`);
    await expect(sheet).toContainText("Read notes outside its own folder, in Events/");
    await expect(sheet).toContainText("Your page hands it: days 30.");
    await expect(sheet).toContainText("It acts as you in techne, with your sign-in there. It sees nothing in your own vaults.");
    await page.waitForTimeout(800);
    await sheet.getByRole("button", { name: "Allow" }).click();
    await expect(embed(page, "Events").getByText("Seed swap")).toBeVisible();
    await expect(embed(page, "Events").getByText("Barn raising")).toBeVisible();
    await expect(place.locator(".embed-line")).toContainText("Events · techne's");
    // size follows content: the frame is as tall as its list, not a screen
    const h = await page.locator('iframe.embed-frame[title="Events"]').evaluate((f) => f.getBoundingClientRect().height);
    expect(h).toBeGreaterThan(60);
    expect(h).toBeLessThan(600);
  } finally { await tearDown(made); }
});

/** Load the page again: a reload isn't a tap, so the host waits, stopped, until Open. */
async function reopen(page: Page) {
  await page.reload();
  await page.getByRole("button", { name: "Open Home" }).click();
  await expect(host(page).getByRole("heading", { name: "Home" })).toBeVisible();
}
/** Open the home page and allow the host, then each embed named (on its own sheet). */
async function openAndAllow(page: Page, homeId: string, embeds: string[]) {
  await page.goto(`/v/${VAULT}/a/${homeId}`);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(host(page).getByRole("heading", { name: "Home" })).toBeVisible();
  for (const name of embeds) {
    await page.locator(`.embed-place[data-embed="${name}"]`).getByRole("button", { name: "Review" }).click();
    const sheet = page.getByRole("dialog", { name: /is asking for access/ });
    await page.waitForTimeout(800);
    await sheet.getByRole("button", { name: /^Allow/ }).click();
    await expect(sheet).toHaveCount(0);
  }
}

test("a hostile embedded component can't read the host page, the home vault or another frame, and one that tries to leave is stopped alone", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  const made: Made = { org: [], home: [] };
  try {
    made.org.push((await org("POST", "notes", { path: "Private/Board minutes", content: "a secret about the barn" })).id);
    made.home.push((await home("POST", "notes", { path: "Journal/Plans", content: "my secret plan" })).id);
    const snoop = fixture("hostile/Snoop.tsx").replace('"__HOME__"', JSON.stringify(hubState().origin)).replace('"__ORG__"', JSON.stringify(techneState().origin));
    await orgComponent(made, "snoop", "Snoop", snoop);
    await orgComponent(made, "leaver", "Leaver", fixture("hostile/Leaver.tsx"));
    const ids = await setUp(made, { more: [{ name: "snoop", record: pointerPathFor("snoop") }, { name: "leaver", record: pointerPathFor("leaver") }] });
    await openAndAllow(page, ids.home, ["events", "snoop", "leaver"]);
    const url = page.url();
    const got = embed(page, "Snoop").getByRole("list", { name: "What it got" });
    await expect(got.getByRole("listitem")).toHaveCount(14, { timeout: 15_000 });
    const lines = await got.getByRole("listitem").allTextContents();
    expect(lines.filter((l) => !l.endsWith(": refused")), lines.join("\n")).toEqual([]);
    // the page stayed where it was, and the host and the other embed are untouched by its fakes
    await page.waitForTimeout(1200);
    expect(page.url()).toBe(url);
    await expect(host(page).getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(embed(page, "Events").getByText("Seed swap")).toBeVisible();
    for (const f of [host(page), embed(page, "Events")]) expect(await f.locator("html").evaluate((h) => getComputedStyle(h).getPropertyValue("--bg"))).not.toBe("#ff0000");
    // the one that tried to leave is stopped, alone, with the shell's sentence
    await expect(page.locator('.embed-place[data-embed="leaver"]')).toContainText("«Leaver» tried to leave its sandbox and was stopped.");
    await expect(page.locator('iframe.embed-frame[title="Leaver"]')).toHaveCount(0);
    await expect(host(page).getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.locator('iframe.embed-frame[title="Snoop"]')).toHaveCount(1);
  } finally { await tearDown(made); }
});

test("a change upstream shows the card again, Allow re-pins; new props ask again; the sheet's Allow waits for the page to settle", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  const made: Made = { org: [], home: [] };
  try {
    const ids = await setUp(made);
    await openAndAllow(page, ids.home, ["events"]);
    await expect(embed(page, "Events").getByText("Seed swap")).toBeVisible();
    // Techne changes Events
    const cur = one(await org("GET", `notes?id=${ids.events}`));
    await org("PATCH", `notes/${ids.events}`, { content: fixture("techne/Events.tsx").replace("On at Techne", "Coming up at Techne"), if_updated_at: cur.updatedAt });
    await reopen(page);
    const place = page.locator('.embed-place[data-embed="events"]');
    await expect(place).toContainText("techne changed «Events» since you brought it in.");
    await expect(page.locator('iframe.embed-frame[title="Events"]')).toHaveCount(0);
    await place.getByRole("button", { name: "Review" }).click();
    const sheet = page.getByRole("dialog", { name: /is asking for access/ });
    // a tap right away (a double tap, or a page that moved under the finger) doesn't count (forced: Playwright itself
    // would wait for the button to be ready)
    await sheet.getByRole("button", { name: "Allow this version" }).click({ force: true });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(800);
    await sheet.getByRole("button", { name: "Allow this version" }).click();
    await expect(embed(page, "Events").getByText("Coming up at Techne")).toBeVisible();
    await expect.poll(async () => one(await home("GET", `notes?path=${encodeURIComponent(ids.pointerPath)}&include_metadata=true`)).metadata.pointer.code).toBe(`tsx:${await sha(fixture("techne/Events.tsx").replace("On at Techne", "Coming up at Techne"))}`);
    // the page hands it new props: it asks again, and the card shows them
    const h = one(await home("GET", `notes?id=${ids.home}&include_metadata=true`));
    await home("PATCH", `notes/${ids.home}`, { metadata: { ...h.metadata, embeds: [{ name: "events", record: ids.pointerPath, props: { days: 7 } }] }, if_updated_at: h.updatedAt });
    await reopen(page);
    await place.getByRole("button", { name: "Review" }).click();
    await expect(sheet).toContainText("Your page hands it: days 7.");
  } finally { await tearDown(made); }
});

test("revoking stops the embed's data with a plain message: the person's Revoke, Techne's hub refusing this device, and the hub out of reach", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  const made: Made = { org: [], home: [] };
  try {
    const ids = await setUp(made);
    await openAndAllow(page, ids.home, ["events"]);
    const place = page.locator('.embed-place[data-embed="events"]');
    await expect(embed(page, "Events").getByText("Seed swap")).toBeVisible();
    // the person's Revoke: the frame goes at once; the place asks again
    await place.getByRole("button", { name: "Revoke" }).click();
    await expect(page.locator('iframe.embed-frame[title="Events"]')).toHaveCount(0);
    await expect(place).toContainText("«Events», from techne, asks to run here.");
    await place.getByRole("button", { name: "Review" }).click();
    await page.waitForTimeout(800);
    await page.getByRole("dialog", { name: /is asking for access/ }).getByRole("button", { name: "Allow" }).click();
    await expect(embed(page, "Events").getByText("Seed swap")).toBeVisible();
    // Techne's hub out of reach (the network to it cut): the place says so; the host runs on
    const cut = (u: URL) => u.origin === techneState().origin;
    await page.route(cut, (r) => r.abort());
    await reopen(page);
    await expect(place).toContainText("techne can't be reached right now.");
    await expect(host(page).getByRole("heading", { name: "Home" })).toBeVisible();
    await page.unroute(cut);
    await reopen(page);
    await expect(embed(page, "Events").getByText("Seed swap")).toBeVisible();
  } finally { await tearDown(made); }
});

test("Techne's hub stops letting this device in: the embed's place says so (core 0.9; 0.8 reads a revoked token until it expires)", async ({ page }) => {
  const door = await fetch(`${techneState().origin}/vault/${ORG_VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${techneState().token}` } });
  test.skip(door.status !== 200, "core 0.8 keeps reading with a revoked access token until it expires (docs/design/EMBED.md, core proposal 2)");
  await signInWithKey(page, techneState(), ORG_VAULT);
  const made: Made = { org: [], home: [] };
  try {
    const ids = await setUp(made);
    await openAndAllow(page, ids.home, ["events"]);
    await expect(embed(page, "Events").getByText("Seed swap")).toBeVisible();
    // the hub ends this device's sign-in (both its tokens), as an operator or the person's account page would
    const recs = await page.evaluate(() => JSON.parse(localStorage.getItem("parachute.vaults.v1") ?? "[]")) as { vault: string; accessToken: string; refreshToken: string; clientId: string }[];
    const t = recs.find((r) => r.vault === ORG_VAULT)!;
    for (const [token, hint] of [[t.refreshToken, "refresh_token"], [t.accessToken, "access_token"]]) {
      const r = await fetch(`${techneState().origin}/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token, token_type_hint: hint, client_id: t.clientId }) });
      expect(r.status).toBe(200);
    }
    await reopen(page);
    await expect(page.locator('.embed-place[data-embed="events"]')).toContainText("techne no longer lets this device in. Sign in to techne again.");
    await expect(page.locator('iframe.embed-frame[title="Events"]')).toHaveCount(0);
    await expect(host(page).getByRole("heading", { name: "Home" })).toBeVisible();
  } finally { await tearDown(made); }
});

test("a page whose embeds were running when the app stopped holds them until the person runs them again", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  const made: Made = { org: [], home: [] };
  try {
    const ids = await setUp(made);
    await openAndAllow(page, ids.home, ["events"]);
    await expect(embed(page, "Events").getByText("Seed swap")).toBeVisible();
    // the app is killed while the page runs: the mark stays (no pagehide); the next start finds it
    expect(await page.evaluate(() => localStorage.getItem("parachute.pagemark.v1"))).toBe(`${VAULT}|${ids.home}`);
    const ctx = page.context();
    const state = await ctx.storageState();
    const again = await (await ctx.browser()!.newContext({ storageState: state, viewport: page.viewportSize()! })).newPage();
    await again.goto(`/v/${VAULT}/a/${ids.home}`);
    // a new start: the host runs on a tap, as always; its embeds don't
    await again.getByRole("button", { name: "Open Home" }).click();
    await expect(again.locator(".embeds")).toContainText("The app stopped while these were running.");
    await expect(again.locator("iframe.embed-frame")).toHaveCount(0);
    await again.locator(".embeds").getByRole("button", { name: "Review" }).click();
    await again.waitForTimeout(800);
    await again.getByRole("dialog", { name: "Run them again?" }).getByRole("button", { name: "Run them" }).click();
    await expect(again.frameLocator('iframe.embed-frame[title="Events"]').getByText("Seed swap")).toBeVisible();
    await again.context().close();
  } finally { await tearDown(made); }
});
