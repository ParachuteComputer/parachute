// docs/OTHER-PARACHUTES.md's worked example, followed through every layer on two real hubs: Techne's Events component,
// written with the doc's own create-record call, put on Aaron's home by Add to home in the launcher (and, the second
// time, by an agent's MCP calls as the doc gives them); then importing instead, refused until Techne is trusted.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, ORG_VAULT, record, techneState, VAULT } from "./hub";
import { signInWithKey, ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const doc = readFileSync(new URL("../docs/OTHER-PARACHUTES.md", import.meta.url), "utf8");
const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]));
const COMPONENT = blocks.find((b) => b.tags?.includes("component"));
const POINTER = blocks.find((b) => b.tags?.includes("parachute-pointer"));
const EMBEDS = blocks.find((b) => b.embeds);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const org = (method: string, path: string, body?: unknown) => api(techneState(), method, path, body, ORG_VAULT);
const home = (method: string, path: string, body?: unknown) => api(hubState(), method, path, body, VAULT);
const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const host = (page: Page) => page.frameLocator("iframe.applet-frame");
const embed = (page: Page, name: string) => page.frameLocator(`iframe.embed-frame[title="${name}"]`);
const hostOf = (origin: string) => new URL(origin).host;
const pathHost = () => hostOf(techneState().origin).replace(/[^A-Za-z0-9.-]/g, "-");

type Made = { org: string[]; home: string[] };
/** Techne's events, the doc's component (written as an agent writes it), and Aaron's home applet as his start. */
async function world(made: Made) {
  for (const [title, when] of [["Seed swap", "2026-11-20"], ["Barn raising", "2026-11-28"]]) made.org.push((await org("POST", "notes", { path: `Events/${title}`, content: title, metadata: { when } })).id);
  const events = await record(techneState(), "create", COMPONENT, ORG_VAULT);
  made.org.push(events.id as string);
  const h = await home("POST", "notes", { path: "Applets/Home", extension: "tsx", content: fixture("techne/Home.tsx"), tags: ["applet"],
    metadata: { applet: { contract: 2, id: "home", name: "Home", glyph: "⌂", access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read"] }] }] } } });
  made.home.push(h.id);
  // one settings note: a sign-in in an earlier test may have left one (it lists the person's Parachutes)
  for (const n of await home("GET", "notes?tag=parachute-settings")) await home("DELETE", `notes/${n.id}`);
  made.home.push((await home("POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { start: { vault: VAULT, applet: "Applets/Home" }, bar: [] } } })).id);
  return { events: events.id as string, home: h.id as string };
}
async function tearDown(made: Made) {
  for (const p of await home("GET", "notes?tag=parachute-pointer")) await home("DELETE", `notes/${p.id}`).catch(() => {});
  for (const id of made.home.reverse()) await home("DELETE", `notes/${id}`).catch(() => {});
  for (const id of made.org.reverse()) await org("DELETE", `notes/${id}`).catch(() => {});
}
/** The launcher: the app opens on the home applet (the settings name it), and the bar leads there. */
async function launcher(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Launcher" }).click();
  await expect(ui(page).getByRole("region", { name: ORG_VAULT })).toBeVisible();
}
/** Allow the home, then Events on its sheet; Techne's events show under the home's own content. */
async function allowBoth(page: Page, id: string) {
  await page.goto(`/v/${VAULT}/a/${id}`);
  await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Shows things from techne (someone else's) on its page. What it reads here could reach techne.");
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(host(page).getByRole("heading", { name: "Home" })).toBeVisible();
  await page.locator('.embed-place[data-embed="events"]').getByRole("button", { name: "Review" }).click();
  const sheet = page.getByRole("dialog", { name: /is asking for access/ });
  await expect(sheet).toContainText("Read notes outside its own folder, in Events/");
  await page.waitForTimeout(800);
  await sheet.getByRole("button", { name: "Allow" }).click();
  await expect(embed(page, "Events").getByText("Seed swap")).toBeVisible();
  await expect(page.locator('.embed-place[data-embed="events"] .embed-line')).toContainText("Events · techne's");
}

test("the worked example: Techne's Events, written as the doc says, put on the home by Add to home in the launcher", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  const made: Made = { org: [], home: [] };
  try {
    const ids = await world(made);
    await launcher(page);
    const techne = ui(page).getByRole("region", { name: ORG_VAULT });
    await techne.getByRole("list", { name: `Components in ${ORG_VAULT}` }).getByRole("button", { name: /Events/ }).click();
    const sheet = ui(page).getByRole("dialog", { name: "Events" });
    await sheet.getByRole("button", { name: "Add to home" }).click();
    await expect(sheet.getByRole("status")).toContainText("Added to your home.");
    // what it wrote: the doc's pointer, pinned to the code read, and the doc's embed in the home applet
    const pointer = one(await home("GET", `notes?tag=parachute-pointer&include_metadata=true`));
    expect(pointer.path).toBe(POINTER.path.replace("techne.example", pathHost()));
    expect(pointer.metadata.pointer).toEqual({ ...POINTER.fields.pointer, hub: techneState().origin, record: ids.events, code: `tsx:${createHash("sha256").update(COMPONENT.body).digest("hex")}` });
    const h = one(await home("GET", `notes?id=${ids.home}&include_metadata=true`));
    expect(h.metadata.embeds).toEqual([{ name: "events", record: pointer.path }]);
    expect(h.metadata.applet.id).toBe("home");
    await allowBoth(page, ids.home);
  } finally { await tearDown(made); }
});

test("the worked example by an agent: the pointer and the embed written with the doc's calls", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  const made: Made = { org: [], home: [] };
  try {
    const ids = await world(made);
    // as the doc says: the pointer, its code the SHA-256 of the body as read; then the home applet's fields, kept, with the embed
    const read = one(await org("GET", `notes/${ids.events}`));
    const path = POINTER.path.replace("techne.example", pathHost());
    await record(hubState(), "create", { ...POINTER, path, fields: { pointer: { ...POINTER.fields.pointer, hub: techneState().origin, record: ids.events, code: `tsx:${createHash("sha256").update(read.content).digest("hex")}` } } });
    const h = one(await home("GET", `notes?id=${ids.home}&include_metadata=true`));
    await record(hubState(), "update", { id: ids.home, fields: { ...h.metadata, embeds: EMBEDS.embeds.map((e: Record<string, unknown>) => ({ ...e, record: path })) }, if_updated_at: h.updatedAt });
    await allowBoth(page, ids.home);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // the doc's props reach it as written
    await expect(page.locator('.embed-place[data-embed="events"]').getByRole("button", { name: "Revoke" })).toBeVisible();
  } finally { await tearDown(made); }
});

test("importing instead: refused from Techne until it is trusted on its card, then on the applet's card", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  const made: Made = { org: [], home: [] };
  try {
    const ids = await world(made);
    // bring Events in (a pointer), then an applet of Aaron's that imports it
    await launcher(page);
    await ui(page).getByRole("region", { name: ORG_VAULT }).getByRole("list", { name: `Components in ${ORG_VAULT}` }).getByRole("button", { name: /Events/ }).click();
    await ui(page).getByRole("dialog", { name: "Events" }).getByRole("button", { name: "Bring into my Parachute" }).click();
    await expect.poll(async () => (await home("GET", "notes?tag=parachute-pointer")).length).toBe(1);
    const agenda = await home("POST", "notes", { path: "Applets/Agenda", extension: "tsx", tags: ["applet"],
      content: 'import Events from "component:events";\nexport default function Agenda() { return <main><h1>Agenda</h1><Events days={30} /></main>; }\n',
      metadata: { applet: { contract: 2, id: "agenda", name: "Agenda", access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read"] }] }] } } });
    made.home.push(agenda.id);
    await page.goto(`/v/${VAULT}/a/${agenda.id}`);
    await expect(page.getByRole("alert")).toContainText("it imports «events» from techne, which this device doesn't trust. Embed it instead, or trust techne in Settings");
    // trust techne, on its card in Settings
    await page.goto("/settings");
    await page.getByRole("combobox", { name: `Whose ${ORG_VAULT} is` }).selectOption("trusted");
    const card = page.getByRole("dialog", { name: "Trust techne?" });
    await expect(card).toContainText("Code from techne could then run inside your own applets, with everything they reach: your notes included.");
    await card.getByRole("button", { name: "Trust techne" }).click();
    await expect(page.getByRole("combobox", { name: `Whose ${ORG_VAULT} is` })).toHaveValue("trusted");
    await page.goto(`/v/${VAULT}/a/${agenda.id}`);
    const appletCard = page.getByRole("region", { name: /asking for access/ });
    await expect(appletCard).toContainText("Includes «Events» from techne (trusted): its code runs inside this applet and sees what it sees");
    await page.getByRole("button", { name: "Allow" }).click();
    // Events runs inside Agenda, on Agenda's own grant: it reads Agenda's vault (no Events/ there), not Techne's
    await expect(host(page).getByRole("heading", { name: "Agenda" })).toBeVisible();
    await expect(host(page).getByText("Nothing on at Techne yet.")).toBeVisible();
    // Techne changes Events: the applet's own card comes back
    const cur = one(await org("GET", `notes/${ids.events}`));
    await org("PATCH", `notes/${ids.events}`, { content: String(cur.content).replace("On at Techne", "Soon at Techne"), if_updated_at: cur.updatedAt });
    await page.goto(`/v/${VAULT}/a/${agenda.id}`);
    await expect(page.getByText("This applet's code, or what it imports, changed since you allowed it.")).toBeVisible();
  } finally { await tearDown(made); }
});
