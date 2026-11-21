// An applet written the way a chat AI with the Parachute MCP writes one: one `create-note` call, with the arguments
// from docs/WRITE-AN-APPLET.md, and nothing else. The app then shows it, asks, transpiles and runs it.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";

const guide = readFileSync(new URL("../docs/WRITE-AN-APPLET.md", import.meta.url), "utf8");
const example = guide.slice(guide.indexOf("## A worked example"));
/** The create-note arguments exactly as the guide gives them. */
const ARGS = JSON.parse(example.match(/```json\n([\s\S]*?)\n```/)![1]) as { path: string; body: string; fields: Record<string, unknown> } & Record<string, unknown>;
const LAID_OUT = example.match(/```tsx\n([\s\S]*?)```/)![1];
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");

test.use({ storageState: "e2e/.signed-in.json" });

async function written(args: Record<string, unknown>, run: (id: string) => Promise<void>) {
  const note = await record(hubState(), "create", args);
  try { await run(note.id as string); } finally { await api(hubState(), "DELETE", `notes/${note.id}`); }
}
const openChip = async (page: Page, name: RegExp) => {
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name }).click();
};

test("the guide's worked example is the code it lays out", () => {
  expect(ARGS.body).toBe(LAID_OUT);
});

test("a TSX applet written with one MCP create-note call shows, asks, and runs after Allow", async ({ page }) => {
  await written(ARGS, async (id) => {
    await openChip(page, /Recipe cards/);
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Read and add notes in Recipes/");
    await expect(card).toContainText("Open recipe notes in Recipes/ when you tap one");
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).getByRole("heading", { name: "Recipe cards" })).toBeVisible();
    // its React state, filled from the vault through the kit
    await expect(frame(page).locator(".pa-row-title")).toHaveCount(2);
    expect((await frame(page).locator(".pa-row-title").allTextContents()).sort()).toEqual(["Rice and beans", "Tomato toast"]);

    // the code changes (one update-note call): the card shows again before the new version runs
    const cur = await api(hubState(), "GET", `notes?id=${id}`);
    await record(hubState(), "update", { id, body: ARGS.body.replace('title="Recipe cards"', 'title="Recipe cards, changed"'), if_updated_at: cur.updatedAt });
    await openChip(page, /Recipe cards/);
    await expect(page.getByText("code changed since you allowed it")).toBeVisible();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await page.getByRole("button", { name: "Allow this version" }).click();
    await expect(frame(page).getByRole("heading", { name: "Recipe cards, changed" })).toBeVisible();
  });
});

test("the guide's example on the parts: a recipe drawn richly by Note, its links kept inside the applet, and Field adding one", async ({ page }) => {
  const linked = await api(hubState(), "POST", "notes", { path: "Recipes/Linked", tags: ["recipe"], content: "# Linked\n\nGood with [[Rice and beans]]. More on [the web](https://example.com/soup).\n" });
  await written(ARGS, async () => {
    await openChip(page, /Recipe cards/);
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    // the parts, in the app's look: the tally, the field, the list
    await expect(app.getByRole("img", { name: /changed, the last four weeks/ })).toBeVisible();
    await expect(app.locator(".pa-row-title")).toHaveCount(3);
    expect(await app.locator(".pa-row-title").first().evaluate((e) => getComputedStyle(e).fontFamily)).toContain("Iowan Old Style");
    // Note draws a recipe as the note view does: rich, with its servings
    await app.getByRole("button", { name: /^Tomato toast/ }).click();
    await expect(app.getByRole("region", { name: "Recipe" }).getByRole("heading", { name: "Tomato toast" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Start cooking" })).toBeVisible();
    // a wikilink goes to onLink (here: that recipe); a web link goes nowhere, and the applet stays
    const here = page.url();
    await app.getByRole("button", { name: /^Linked/ }).click();
    await app.getByRole("link", { name: "Rice and beans" }).click();
    await expect(app.getByRole("region", { name: "Recipe" }).getByRole("heading", { name: "Rice and beans" })).toBeVisible();
    await app.getByRole("button", { name: /^Linked/ }).click();
    await app.getByRole("link", { name: "the web" }).click();
    await page.waitForTimeout(300);
    expect(page.url()).toBe(here);
    await expect(page.getByText("tried to leave its sandbox")).toHaveCount(0);
    await expect(app.getByRole("heading", { name: "Recipe cards" })).toBeVisible();
    // Field adds one, through createRecord, and it opens
    await app.getByLabel("New recipe").fill("Barley stew");
    await app.getByRole("button", { name: "Add" }).click();
    await expect(app.getByRole("region", { name: "Recipe" }).getByRole("heading", { name: "Barley stew" })).toBeVisible();
    const made = await api(hubState(), "GET", `notes?id=${encodeURIComponent("Recipes/Barley stew")}`);
    expect(made.tags).toContain("recipe");
    await api(hubState(), "DELETE", `notes/${made.id}`);
  }).finally(() => api(hubState(), "DELETE", `notes/${linked.id}`));
});

test("Note keeps a plain note's links inside the applet: a wikilink and a web link go to onLink, and the frame never moves", async ({ page }) => {
  const body = 'import { Note } from "parachute";\nexport default () => <main><Note path="Notes/Plan v1.2" body={"# Plain\\n\\nSee [[Rice and beans]] and [the web](https://example.com/x)."} onLink={(t) => { document.body.dataset.link = t; }} /></main>;';
  const args = { ...ARGS, path: "Applets/Plain note", fields: { applet: { ...(ARGS.fields.applet as object), id: "plain-note", name: "Plain note" } }, body };
  await written(args, async () => {
    await openChip(page, /Plain note/);
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await expect(app.getByRole("heading", { name: "Plain" })).toBeVisible();
    const here = page.url();
    await app.getByRole("link", { name: "Rice and beans" }).click();
    await expect(app.locator("body")).toHaveAttribute("data-link", "Rice and beans");
    await app.getByRole("link", { name: "the web" }).click();
    await expect(app.locator("body")).toHaveAttribute("data-link", "https://example.com/x");
    expect(page.url()).toBe(here);
    await expect(page.getByText("tried to leave its sandbox")).toHaveCount(0);
    await expect(app.getByRole("heading", { name: "Plain" })).toBeVisible();
  });
});

test("TSX that doesn't compile is refused with the reason, and nothing runs", async ({ page }) => {
  const args = { ...ARGS, path: "Applets/Broken", fields: { applet: { ...(ARGS.fields.applet as object), id: "broken", name: "Broken" } }, body: "export default function App() { return <p>; }" };
  await written(args, async () => {
    await openChip(page, /Broken/);
    await expect(page.getByRole("alert")).toContainText("its code doesn't compile");
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  });
});

test("an import the app doesn't provide stops the applet with one line saying so", async ({ page }) => {
  const args = { ...ARGS, path: "Applets/Imports", fields: { applet: { ...(ARGS.fields.applet as object), id: "imports", name: "Imports" } }, body: 'import _ from "lodash";\nexport default () => <p>{_.now()}</p>;' };
  await written(args, async () => {
    await openChip(page, /Imports/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator(".parachute-error")).toHaveText(/it imports lodash, and an applet can import only react, .*parachute/);
  });
});

test("the same code run another way is new code: an extension changed alone shows the card again", async ({ page }) => {
  // as TSX the <script> below is text; as HTML it would run
  const content = 'export default function App() { return <p id="kind">tsx {"<script>document.body.append(Object.assign(document.createElement(\'b\'),{id:\'ran\'}))</script>"}</p>; }';
  const args = { ...ARGS, path: "Applets/Poly", fields: { applet: { ...(ARGS.fields.applet as object), id: "poly", name: "Poly" } }, body: content };
  await written(args, async (id) => {
    await openChip(page, /Poly/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator("#kind")).toContainText("tsx");
    const cur = await api(hubState(), "GET", `notes?id=${id}`);
    await record(hubState(), "update", { id, extension: "html", if_updated_at: cur.updatedAt });
    await openChip(page, /Poly/);
    await expect(page.getByText("code changed since you allowed it")).toBeVisible();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  });
});

test("a module may await at its top, and one the browser can't parse still says why", async ({ page }) => {
  const awaits = { ...ARGS, path: "Applets/Awaits", fields: { applet: { ...(ARGS.fields.applet as object), id: "awaits", name: "Awaits" } },
    body: 'import { ready } from "parachute";\nconst ctx = await ready();\nexport default () => <h1>{ctx.applet.name} is ready</h1>;' };
  await written(awaits, async () => {
    await openChip(page, /Awaits/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).getByRole("heading", { name: "Awaits is ready" })).toBeVisible();
  });
  // sucrase passes a repeated declaration through; the browser refuses to parse it
  const twice = { ...ARGS, path: "Applets/Twice", fields: { applet: { ...(ARGS.fields.applet as object), id: "twice", name: "Twice" } }, body: "let a = 1; let a = 2;\nexport default () => <p>{a}</p>;" };
  await written(twice, async () => {
    await openChip(page, /Twice/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator(".parachute-error")).toContainText("This applet stopped");
  });
});
