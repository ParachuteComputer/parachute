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
const EVENTS_FIELDS = { component: { contract: 1, id: "events", name: "Events", glyph: "◷", props: { days: "number" }, access: [{ vault: "here", allow: [{ path: "Events/", verbs: ["read"] }] }] } };

type Made = { org: string[]; home: string[] };
async function setUp(made: Made, opts: { props?: Record<string, unknown> } = {}) {
  for (const [title, when] of [["Seed swap", "2026-11-20"], ["Barn raising", "2026-11-28"]]) made.org.push((await org("POST", "notes", { path: `Events/${title}`, content: title, metadata: { when } })).id);
  const events = await org("POST", "notes", { path: "Components/Events", extension: "tsx", content: fixture("techne/Events.tsx"), tags: ["component"], metadata: EVENTS_FIELDS });
  made.org.push(events.id);
  const code = `tsx:${await sha(fixture("techne/Events.tsx"))}`;
  const pointerPath = `Parachute/From/${hostOf(techneState().origin).replace(/[^A-Za-z0-9.-]/g, "-")}/${ORG_VAULT}/component-events`;
  made.home.push((await home("POST", "notes", { path: pointerPath, content: "Events, from techne.", tags: ["parachute-pointer"], metadata: { pointer: { hub: techneState().origin, vault: ORG_VAULT, record: events.id, kind: "component", id: "events", name: "Events", code } } })).id);
  const h = await home("POST", "notes", { path: "Applets/Home", extension: "tsx", content: fixture("techne/Home.tsx"), tags: ["applet"],
    metadata: { applet: { contract: 2, id: "home", name: "Home", glyph: "⌂", access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read"] }] }] }, embeds: [{ name: "events", record: pointerPath, props: opts.props ?? { days: 30 } }] } });
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
