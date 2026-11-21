// An older app opening records written for a newer one (docs/design/VERSIONS.md): install order must not matter. Each
// record here is one a newer Parachute would write; this build is the older app. It says "Update Parachute to open …"
// and runs nothing of them, where it used to ask for and run code it couldn't draw, or hide the applet.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { installApplet, ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const openChip = async (page: Page, name: RegExp) => {
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name }).click();
};
const card = (page: Page) => page.getByRole("region", { name: /asking for access/ });
/** The frame of an applet that used a part this app doesn't have: one short line in the app's look, what is missing in a
 *  quieter line under it, and none of the error (React's own, minified, with a link) that stopped it. */
const expectUpdateLine = async (page: Page, name: string) => {
  const box = frame(page).getByRole("status");
  await expect(box.locator("strong")).toHaveText(`Update Parachute to open ${name}.`);
  await expect(box.locator(".quiet")).toHaveText("It uses Timeline, which this Parachute doesn't have.");
  await expect(frame(page).locator("#root")).not.toContainText(/stopped|React|error|https?:/i);
  // styled on the theme's tokens: the app's sans and its muted colour, not the browser's default serif in black
  const look = await box.evaluate((el) => {
    const q = getComputedStyle(el.querySelector(".quiet")!), root = getComputedStyle(document.documentElement);
    const muted = document.createElement("i"); muted.style.color = root.getPropertyValue("--muted"); el.append(muted);
    const want = getComputedStyle(muted).color; muted.remove();
    return { font: getComputedStyle(el).fontFamily, sans: root.getPropertyValue("--sans"), quiet: q.color, muted: want };
  });
  expect(look.font.replace(/\s/g, "")).toBe(look.sans.replace(/\s/g, ""));
  expect(look.quiet).toBe(look.muted);
};

test("a record that needs a newer app is listed, and says to update instead of asking or running", async ({ page }) => {
  const later = await installApplet("journal", {}, (r) => ({ ...r, path: "Applets/Later journal", fields: { ...r.fields, needs: 99, applet: { ...(r.fields.applet as object), id: "later-journal", name: "Later journal" } } }));
  try {
    await openChip(page, /Later journal/);
    await expect(page.getByText("Update Parachute to open Later journal.")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  } finally { await later.remove(); }
});

test("a manifest with a key this app doesn't know is listed and says to update, not hidden or refused", async ({ page }) => {
  const later = await installApplet("journal", {}, (r) => ({ ...r, path: "Applets/Later notes", fields: { ...r.fields, applet: { ...(r.fields.applet as object), id: "later-notes", name: "Later notes", later: { anything: true } } } }));
  try {
    await openChip(page, /Later notes/);
    await expect(page.getByText("Update Parachute to open Later notes.")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  } finally { await later.remove(); }
});

test("code that uses a part of the kit this app doesn't have says to update in one short line, not that it broke", async ({ page }) => {
  const body = `import { Page, Timeline } from "parachute";\nexport default function App() {\n  return <Page title="Later page"><Timeline /></Page>;\n}\n`;
  const note = await record(hubState(), "create", { path: "Applets/Later page", extension: "tsx", tags: ["applet"], body, fields: { applet: { contract: 2, id: "later-page", name: "Later page" } } });
  try {
    await openChip(page, /Later page/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expectUpdateLine(page, "Later page");
  } finally { await api(hubState(), "DELETE", `notes/${note.id}`); }
  // the same through a namespace import, which the transpiler reads differently
  const ns = `import * as P from "parachute";\nexport default function App() {\n  return <P.Page title="Later too"><P.Timeline /></P.Page>;\n}\n`;
  const two = await record(hubState(), "create", { path: "Applets/Later too", extension: "tsx", tags: ["applet"], body: ns, fields: { applet: { contract: 2, id: "later-too", name: "Later too" } } });
  try {
    await openChip(page, /Later too/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expectUpdateLine(page, "Later too");
  } finally { await api(hubState(), "DELETE", `notes/${two.id}`); }
});

test("any other failure says the first line of its error, never a stack", async ({ page }) => {
  const body = `export default function App() {\n  throw new Error("the shelf is empty\\n    at App (applet.tsx:3:9)");\n}\n`;
  const note = await record(hubState(), "create", { path: "Applets/Empty shelf", extension: "tsx", tags: ["applet"], body, fields: { applet: { contract: 2, id: "empty-shelf", name: "Empty shelf" } } });
  try {
    await openChip(page, /Empty shelf/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).getByRole("alert")).toHaveText("This applet stopped: the shelf is empty");
    await expect(frame(page).locator("#root")).not.toContainText(/Update Parachute|applet\.tsx/);
  } finally { await api(hubState(), "DELETE", `notes/${note.id}`); }
});

test("an applet that imports a component made for a newer app says to update, and runs nothing", async ({ page }) => {
  const part = await record(hubState(), "create", { path: "Components/Later card", extension: "tsx", tags: ["component"],
    body: `export default function LaterCard() { return <p>later</p>; }\n`, fields: { needs: 99, component: { contract: 1, id: "later-card", name: "Later card" } } });
  const note = await record(hubState(), "create", { path: "Applets/Uses later", extension: "tsx", tags: ["applet"],
    body: `import LaterCard from "component:later-card";\nexport default function App() { return <LaterCard />; }\n`, fields: { applet: { contract: 2, id: "uses-later", name: "Uses later" } } });
  try {
    await openChip(page, /Uses later/);
    await expect(page.getByText("Update Parachute to open Uses later.")).toBeVisible();
    await expect(page.getByText(/Later card.*newer Parachute/)).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  } finally {
    await api(hubState(), "DELETE", `notes/${note.id}`);
    await api(hubState(), "DELETE", `notes/${part.id}`);
  }
});
